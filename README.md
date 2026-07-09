# MahaAtithi — Project Deep Dive

**What it is:** a field data-collection platform built for the Maharashtra Tourism Department. Government field staff ("enumerators") use an Android app to physically visit businesses across the state, verify their details, photograph them, and record GPS-tagged survey data — even when there's no internet connection at the visit site. Everything syncs to a central database once the device is back online, and government admins review and manage all of it through a web dashboard.

This document explains what the system does, how its three applications fit together, and how data flows through it end to end.

---

## 1. The Problem It Solves

Maharashtra's Tourism Department has a master list of **313,604 stakeholders** (businesses, hotels, tour operators, and similar tourism-related entities) imported from a 125MB CSV of government records. Each entry needs to be physically verified by a field enumerator: confirm the business actually exists, take photos, record GPS coordinates, validate contact numbers, and note nearby infrastructure (police stations, healthcare). Enumerators work across **36 districts** in the state, often in areas with poor or no mobile network coverage — so the app has to function fully offline and reconcile data automatically once connectivity returns.

---

## 2. The Three Applications

The codebase is a monorepo containing three separate, deployable applications that share a common PostgreSQL backend.

```
┌────────────────────┐     ┌──────────────────┐     ┌────────────┐
│  React Native App  │◄───►│  Express.js API   │◄───►│ PostgreSQL │
│  (Android)         │     │  (Node.js)        │     │ (313K+ rec)│
│  - SQLite offline  │     │  - JWT Auth       │     └────────────┘
│  - Camera/GPS      │     │  - Prisma ORM     │          ▲
│  - Sync Engine     │     │  - Rate Limiting  │     ┌────┴───────┐
└────────────────────┘     └──────────────────┘     │  AWS S3     │
                                ▲                   │  (Media)    │
                           ┌────┴──────────────┐    └────────────┘
                           │  Admin Web Panel   │
                           │  (React + Vite)    │
                           └───────────────────┘
```

### 2.1 Mobile App (`/mobile`)
**React Native 0.75, Android-first.** This is what enumerators carry in the field. It's built offline-first: every action (saving a survey, taking a photo, validating a phone number) is written to a local SQLite database immediately, regardless of network state, and a background sync engine pushes queued data to the server whenever a connection is available.

Key tech: Redux Toolkit for state, React Navigation for screens, `react-native-sqlite-storage` for the local DB, `react-native-geolocation-service` for GPS, `react-native-image-picker` + `react-native-compressor` for camera capture and file size reduction, `react-native-encrypted-storage` for secure token storage, and Zod for client-side validation matching the backend's schemas.

Screens are organized by feature: `auth/` (login), `dashboard/` (enumerator's home view, likely showing assignment counts), `search/` (searching the 313K stakeholder records), `stakeholder/` (list and detail views of assigned businesses), `survey/` (the core data-entry form), and `sync/` (sync status and an initial bulk-download modal for first-time setup).

### 2.2 Backend API (`/backend`)
**Node.js + Express + TypeScript, with Prisma ORM over PostgreSQL.** This is the single source of truth. It exposes a REST API consumed by both the mobile app and the admin panel, handles authentication, enforces district-based access control, validates every incoming payload with Zod, and brokers file uploads to AWS S3.

Modules are organized by domain: `auth` (login/refresh/session management), `stakeholder` (the master 313K-record dataset, searchable and filterable), `survey` (enumerator-collected data per stakeholder), `media` (photo/video upload and S3 management), `phone-validation` (call-verification records), `sync` (the batch endpoint mobile devices use to push offline-queued data), `dashboard` (aggregate stats), `admin` (enumerator and district management, restricted to admin accounts), and `facilities` (a reference dataset of police stations and healthcare centers used to auto-suggest "nearest facility" during a survey).

### 2.3 Admin Panel (`/admin-panel`)
**React + Vite, deployed to Vercel.** The web dashboard government staff use to oversee the whole operation — without needing to be in the field. Pages include a Dashboard (system-wide stats), Stakeholders (browse/search the full dataset), Enumerators (create accounts, assign districts), Districts (manage the 36-district reference list), and Audit Logs (a trail of every significant action taken in the system, for accountability).

---

## 3. How Data Is Modeled

The PostgreSQL schema (managed via Prisma) has 10+ tables, but the core relationships are straightforward:

- **`Stakeholder`** — the 313,604 imported businesses. Each one has ~30 fields from the original CSV (company name, address, GST number, registration details, a fuzzy-match dedup score, etc.) plus application-level fields: `status` (`OPEN` or `CLOSED`) and a `lockedById` referencing the enumerator currently working on it.
- **`Survey`** — one per stakeholder *per enumerator* (enforced by a unique constraint on `[stakeholderId, enumeratorId]`). This holds everything the enumerator records during a visit: contact details, GPS coordinates and accuracy, business category, nearest police station / healthcare center, and draft/completion/sync status flags.
- **`Media`** — photos and videos attached to a survey. Each photo is tagged with a `PhotoCategory` enum (`BUILDING_FRONT`, `SIGNBOARD`, `INTERIOR`, `STAKEHOLDER`, `ADDITIONAL`) and stores its S3 key, not the file itself. Soft-deleted via a `deletedAt` timestamp rather than hard-deleted, so a failed S3 cleanup never leaves an inconsistent state.
- **`PhoneValidation`** — a record of an enumerator calling a stakeholder's listed phone number to confirm it's live, with a `PENDING_VERIFICATION` / `VERIFIED` / `FAILED` status.
- **`Enumerator`** — field staff accounts, each assigned to one or more `District`s via the `EnumeratorDistrict` join table. This assignment is the backbone of the system's access control (see §5).
- **`SyncQueue`** — a server-side mirror of what's been processed from offline batches, used for retry tracking and dashboard "pending sync" counts.
- **`AuditLog`** — an append-only trail of actions (`login_success`, `survey_saved`, `stakeholder_locked`, etc.) for accountability, since this is a government system handling potentially sensitive business data.
- **`Facility`** — a reference table of police stations and healthcare centers with coordinates, used to compute "nearest facility" suggestions shown to the enumerator while filling out a survey.

The `Stakeholder` table alone carries 15+ indexes (including composite ones like `[district, category]` and `[status, district]`) because every query against it has to stay fast across 313K rows for both the mobile search screen and the admin dashboard.

---

## 4. The Offline-First Sync Model

This is the most architecturally important part of the system, since enumerators frequently work in areas with no signal.

**Local-first writes.** Every survey, photo, and phone validation is saved to the device's SQLite database the moment it's created — never blocked on a network call. The mobile SQLite schema (`mobile/src/database/index.ts`) mirrors the server's tables closely: `stakeholders`, `surveys`, `media`, `phone_validations`, plus a `sync_queue` table and an `app_state` table for tracking sync progress and timestamps.

**Two upload paths exist, on purpose:**
1. **Online-save path** (`SurveyFormScreen.tsx`): when an enumerator finishes a survey *and* has connectivity at that moment, the app tries to upload immediately via `POST /api/surveys` and `POST /api/media/upload`, so the data reaches the server without waiting for a separate sync pass.
2. **Background sync-queue path** (`syncThunks.ts` + `POST /api/sync/upload`): anything that couldn't be uploaded immediately (no connection, or the immediate attempt failed) sits in the local `sync_queue` table and gets retried in batches whenever the app detects connectivity, via a dedicated batch endpoint that accepts arrays of surveys, phone validations, and media metadata in one request.

**ID reconciliation.** Since records are created offline, they're given a temporary `local_xxxxx` ID on the device. When synced, the server creates the real record and returns its UUID; the mobile app then resolves and stores that mapping (`localId` columns exist on `Survey`, `Media`, and `PhoneValidation` on both the client and server) so that, for example, photos captured against a not-yet-synced survey can later be correctly attached to that survey's real server-side ID once it exists.

**Initial bulk sync.** On first login (`InitialSyncModal.tsx`), the app pulls down the enumerator's assigned stakeholder records from the server so the device has a working local copy to search and survey against before any uploads happen — essential since the full dataset is 313K rows and a single enumerator only needs the subset relevant to their assigned districts.

---

## 5. Access Control: District-Based Data Isolation

Because enumerators are each assigned to specific districts, the system enforces a strict rule everywhere stakeholder-linked data is read or written: **an enumerator can only touch data for stakeholders in their assigned district(s), unless they're an admin.**

This is centralized in a single shared utility, `assertStakeholderAccess()` (`backend/src/utils/access-control.ts`), which every module — surveys, media, phone validations, sync — calls before any read or write that touches a specific stakeholder. It throws a `ForbiddenError` (403) if the caller isn't an admin and the stakeholder's district isn't in the caller's assigned list. This single source of truth means the access rule can't drift out of sync between modules, since they all defer to the same function rather than each reimplementing the district check independently.

Admins (`isAdmin: true` on the `Enumerator` model) bypass this check entirely and can see/edit data across all districts — used for oversight and data correction from the admin panel.

**Locking.** To prevent two enumerators from working the same stakeholder simultaneously, `Stakeholder.lockedById` is set once a survey is marked complete, after which other enumerators are blocked from further edits unless they're an admin.

---

## 6. Authentication & Security

- **JWT-based auth** with short-lived access tokens and longer-lived refresh tokens. Refresh tokens are stored server-side as **SHA-256 hashes**, not raw values, in the `Session` table — so a database leak doesn't directly expose usable tokens.
- **Brute-force lockout** via Upstash Redis: 5 failed login attempts locks the account for 15 minutes. This is deliberately Redis-backed rather than an in-memory counter, because the backend can run multiple instances (e.g. under PM2 cluster mode or multiple Railway replicas), and an in-memory counter wouldn't be shared across them. If Redis itself is unreachable, the system "fails open" (allows login) rather than locking everyone out — a deliberate availability tradeoff for a system field staff depend on.
- **Magic-byte file verification** on media uploads: rather than trusting the client-declared `Content-Type` header, the server inspects the actual binary signature of uploaded files (JPEG/PNG/HEIC/MP4 magic bytes) before accepting them, preventing disguised file-type attacks.
- **Server-generated storage filenames**: uploaded files get a fresh UUID-based filename for their S3 key, rather than using the client-supplied filename directly — closing off path traversal or filename-injection risks.
- **Rate limiting** via `express-rate-limit` on general traffic, login attempts specifically, and uploads, each with separate thresholds.
- **Zod validation** on every mutating endpoint, generating clean, field-level 400 responses instead of letting malformed input reach the database layer.

---

## 7. Media Handling

Photos and videos never touch the application server's disk for long-term storage — they go to **AWS S3**. The flow: a file arrives via `multer` (in-memory buffering), gets its magic bytes verified, is assigned a UUID-based S3 key (organized as `{photos|videos}/{date}/{surveyId}/{filename}`), uploaded to S3, and then a **presigned URL** is generated so the client can fetch it back without the bucket needing to be public.

A survey requires a defined set of categorized photos (building front, signboard, interior, stakeholder photo, and an optional "additional" category) plus a walkthrough verification video before it can be marked complete — this is enforced both in the mobile UI (blocking submission until required photos/video are captured) and validated again server-side during the `complete` step, so a tampered or buggy client can't bypass the requirement.

---

## 8. CSV Import Pipeline

The initial 313,604-record dataset doesn't get typed in by hand — it's imported once via a streaming pipeline (`backend/scripts/import-csv.ts`): the 125MB CSV is parsed with `csv-parse` in a streaming fashion (so the whole file is never loaded into memory at once), validated row by row, and inserted in batches of 1,000 using Prisma's `createMany` with `skipDuplicates`. After import, a PostgreSQL trigram index (`pg_trgm` extension) is created to support fuzzy text search on company names, and districts referenced in the data are auto-created if they don't already exist as reference rows.

---

## 9. What "Production-Grade" Means Here

A few details in the codebase reflect that this was hardened past a first draft, likely through a security/correctness audit (visible in code comments referencing fix IDs like `H7 FIX`, `C2 FIX`, `M5 FIX`, `L6 FIX` scattered throughout — shorthand for High/Critical/Medium/Low severity items from a prior review):

- District isolation is enforced consistently rather than per-module, closing a class of bug where one fix wouldn't cover every endpoint.
- Soft-deletes with tombstone records for media, so a partial failure during deletion (DB succeeds, S3 fails, or vice versa) never leaves the system in a state where a reference points to a file that doesn't exist, or a file remains in S3 with no record of it.
- Sessions track device info and IP address per login, supporting later audit or investigation if an account is compromised.
- Every significant mutation writes an `AuditLog` row — logins, survey saves, stakeholder locks — appropriate for a government system where accountability matters.
- Environment variables for critical secrets (`DATABASE_URL`, `JWT_SECRET`, AWS credentials, Redis credentials) are validated at server startup and the process refuses to boot if any are missing or too short, rather than silently running with broken or default configuration.

---

## 10. Deployment Model

- **Backend**: deployed on **Railway**, running the compiled TypeScript output (`dist/index.js`) under Node, with environment variables managed through Railway's dashboard. The README also documents a PM2 cluster-mode deployment option (`pm2 start dist/index.js -i max`) for traditional VM hosting.
- **Admin Panel**: deployed on **Vercel** as a static SPA build, talking to the Railway backend over HTTPS.
- **Mobile App**: built as a release APK via Gradle (`./gradlew assembleRelease`) and distributed to enumerators' Android devices directly (not through the Play Store, typical for an internal government tool).
- **Database**: PostgreSQL, with a local Docker Compose setup for development and a managed instance in production.
- **Object Storage**: AWS S3 for all photo/video media.
- **Redis**: Upstash (serverless Redis over REST) for brute-force lockout tracking — chosen specifically because it works well in a multi-instance/serverless deployment context without needing a persistent TCP connection pool.

---

## 11. Default / Seed Credentials (Development Only)

For local development, the seed script creates one admin and five district-specific enumerator accounts:

| Role | Login ID | Password |
|---|---|---|
| Admin | `admin` | `admin@123` |
| Enumerator (Wardha) | `enum_wardha_01` | `enum@123` |
| Enumerator (Nagpur) | `enum_nagpur_01` | `enum@123` |
| Enumerator (Multi-district) | `enum_multi_01` | `enum@123` |
| Enumerator (Pune) | `enum_pune_01` | `enum@123` |
| Enumerator (Mumbai) | `enum_mumbai_01` | `enum@123` |

These are seed-script defaults for local development and should never be the live credentials on a deployed production instance.

---

## 12. Quick Mental Model Summary

If you only remember one thing about this project: **it's a three-app system (offline-capable Android field app, Express/Postgres backend, React admin dashboard) built to let government field staff verify 313K+ tourism-related businesses across Maharashtra, where every piece of collected data — survey answers, GPS coordinates, photos, phone verifications — flows from an offline-first SQLite cache on the enumerator's phone, through a batched sync API, into a PostgreSQL database with strict district-based access control, with media files living in S3 and the whole operation overseen through a web admin panel.**



## How to run 

Prerequisites:
Node.js (v18 or higher)
PostgreSQL running locally (or via Docker)
Android Studio (for the Android emulator and SDKs)

1. Backend Setup (/backend)
The backend is the central API and database manager.

Open a terminal in the backend/ folder and run npm install.
Copy the .env.example file to a new file named .env and configure your local DATABASE_URL (e.g., postgresql://user:pass@localhost:5432/mahaatithi) and a random string for JWT_SECRET.
Push the database schema: npm run db:push
Seed the database with default accounts and districts: npm run db:seed
This creates the default admin (admin / admin@123) and enumerators (e.g., enum_wardha_01 / enum@123).
Start the backend server: npm run dev (it usually runs on http://localhost:3000).

2. Admin Panel Setup (/admin-panel)
The web dashboard for managing the system.

Open a new terminal in the admin-panel/ folder and run npm install.
Create a .env file here if needed, and point it to the backend (e.g., VITE_API_BASE_URL=http://localhost:3000/api).
Start the dev server: npm run dev.
Open the displayed URL in your browser and log in with the admin credentials.

3. Mobile App Setup (/mobile)
The React Native Android app for field enumerators.

Open a new terminal in the mobile/ folder and run npm install.
Create a mobile/.env file and set the API URL:
For Android Emulator: API_BASE_URL=http://10.0.2.2:3000/api (The emulator uses 10.0.2.2 to point to your computer's localhost).
For Physical Device: API_BASE_URL=http://<YOUR_LAPTOP_WIFI_IP>:3000/api
Launch your Android Emulator via Android Studio (or plug in a physical Android device with USB debugging enabled).
Run the app: npm run android (or npm start followed by pressing a for Android).
Once the app launches on the device, log in with an enumerator account (e.g., test / enum@123).

cd "c:\test file\Manasa project\mobile\android"
.\gradlew clean
.\gradlew assembleRelease

npx tsx scripts/import-excel.ts
npx tsx scripts/truncate.ts

