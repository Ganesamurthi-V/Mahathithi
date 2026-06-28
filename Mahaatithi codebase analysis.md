# MahaAtithi — Complete Codebase Analysis

**Maharashtra Tourism Stakeholder Verification Platform**

This document is a full walkthrough of the `Mahathithi-feature-sqlite` codebase: what the system does, how each layer (mobile app, backend API, database, admin panel) is built, and what the UI/UX looks and feels like on every screen.

---

## 1. What the System Is For

Maharashtra's Tourism Department has a master list of **313,604 potential tourism-related business stakeholders** (hotels, guides, shops, transport operators, etc.) imported from a government CSV. The department needs **field enumerators** to physically visit each business, confirm it's real, collect contact details, GPS-tag it, photograph it, and record a short walkthrough video as proof of visit.

MahaAtithi is the platform that makes this possible:

- A **React Native Android app** the field staff carry, which works **fully offline** (since many of these locations have poor connectivity) and syncs in the background.
- A **Node.js/Express + PostgreSQL backend** that stores the master data, enforces who can see what, and receives the survey results.
- A **React admin panel** for department officials to manage enumerators, assign districts, and review/verify submitted surveys (including photo/video galleries).

---

## 2. High-Level Architecture

```
┌─────────────────────────┐      ┌────────────────────┐      ┌──────────────┐
│   React Native App      │◄────►│   Express.js API    │◄────►│  PostgreSQL  │
│   (Android, offline-first)│     │   (Node.js + Prisma)│      │  (313K+ rows)│
│   - SQLite local mirror │      │   - JWT auth         │      └──────────────┘
│   - Camera / GPS         │      │   - District guard   │            ▲
│   - Redux sync engine    │      │   - Rate limiting    │      ┌─────┴──────┐
└───────────────────────────┘      └──────────┬──────────┘      │   AWS S3    │
                                                │                 │  (photos/   │
                                       ┌────────┴─────────┐       │   videos)   │
                                       │  Admin Web Panel  │      └─────────────┘
                                       │  (React + Vite)    │
                                       └────────────────────┘
```

Three independent codebases share one backend API:

| Folder | Tech | Purpose |
|---|---|---|
| `mobile/` | React Native 0.75, Redux Toolkit, SQLite | Field enumerator's offline-first survey app |
| `backend/` | Node.js, Express, Prisma, PostgreSQL | Central API, auth, business rules, S3 uploads |
| `admin-panel/` | React 18 + Vite | Web dashboard for department admins |

---

## 3. Database Design (PostgreSQL via Prisma)

The schema (`backend/prisma/schema.prisma`) has 10 models. This is the source of truth — the mobile SQLite database is a *local mirror* of a subset of it.

### Core tables

| Table | Purpose |
|---|---|
| **`enumerators`** | Field staff + admin accounts. Has `loginId`, hashed password, `isAdmin` flag. |
| **`districts`** | The 36 districts of Maharashtra. |
| **`enumerator_districts`** | Many-to-many: which districts each enumerator is allowed to work in. |
| **`sessions`** | Refresh-token records for JWT session management (one row per login, 7-day expiry). |
| **`stakeholders`** | The big one — 313,604 imported records, 31 original CSV columns (company name, GST, address, NIC code, capital, etc.) plus app-level `status` (`OPEN`/`CLOSED`) and `lockedById`/`lockedAt` for the locking mechanism. Has 9 single-column + 6 composite indexes to keep search fast at this scale. |
| **`surveys`** | One row per (stakeholder, enumerator) pair — the actual field-collected data: contact person, mobile, GPS lat/lng/accuracy, nearest police station/healthcare center, draft/completed/synced flags. |
| **`media`** | Photo/video metadata — S3 key, GPS at capture time, category (`BUILDING_FRONT`, `SIGNBOARD`, `INTERIOR`, `STAKEHOLDER`, `ADDITIONAL`), duration for videos. |
| **`phone_validations`** | Records of phone-call verification attempts (`PENDING_VERIFICATION` / `VERIFIED` / `FAILED`). |
| **`sync_queue`** | Generic queue for offline writes that need to reach the server (used for stakeholder edits). |
| **`audit_logs`** | Every sensitive action (logins, locks, edits, enumerator creation) is logged with actor, entity, and JSON details. |
| **`facilities`** | Police stations & healthcare centers (lat/lng) used to auto-suggest "nearest facility" during a survey — downloaded once to the device for offline lookup. |

### The "lock" mechanism (core business rule)

A stakeholder starts as `OPEN`. The **first enumerator to fully complete a survey** for it gets it `CLOSED` and `lockedById` set to them. After that:
- No other enumerator can edit or survey that stakeholder (`ConflictError` thrown server-side).
- It's removed from other enumerators' devices on their next sync (`lockedStakeholderIds` returned by `/api/sync/changes`).

This prevents duplicate work across a large distributed field team without needing a live lock server — it's a "first-to-sync-wins" model that tolerates offline conflicts gracefully.

### District-level data partitioning

Every enumerator is assigned one or more districts. Almost every query (`stakeholderGuard`, `getDistrictFilter`, the stakeholder service's `search`) silently filters results to only the enumerator's assigned districts — admins bypass this. This is enforced **both** in middleware (`district-guard.ts`) and again at the service layer (defense in depth).

### Mobile's local SQLite schema

`mobile/src/database/index.ts` defines a near-mirror schema in SQLite (snake_case columns) with its own indexes (`idx_sh_district`, `idx_sh_status`, etc.) so the phone can search 300K+ rows instantly without a network call. There's a DAO (Data Access Object) layer with `stakeholderDao`, `surveyDao`, `mediaDao`, `facilityDao`, `syncQueueDao`, and `appStateDao` — clean separation, each with `upsertMany`, `search`, `getById`, etc.

---

## 4. Backend (Node.js / Express / Prisma)

### Module structure

```
backend/src/modules/
├── auth/          login, refresh token, logout, profile
├── stakeholder/   search, detail, lock, status update, edit
├── survey/        create/update, complete (with validation), list mine
├── media/         S3 upload, fetch by survey, delete
├── sync/          batch upload from offline devices, get changes
├── phone-validation/  record/verify phone calls
├── facilities/    serve police/healthcare list for offline caching
├── dashboard/     per-user stats (completed/open/total)
└── admin/         enumerator CRUD, district assignment, analytics, audit logs
```

### Authentication flow

- `POST /api/auth/login` — `loginId` + `password` → bcrypt-compared → JWT access token (15 min) + a UUID refresh token stored in the `sessions` table (7-day expiry).
- Every protected route runs `authMiddleware`, which verifies the JWT and re-fetches the enumerator (so deactivated accounts are blocked immediately even with a valid token still in hand).
- `adminOnly` middleware gates admin-only routes.
- Login attempts are rate-limited (`loginLimiter`: 5/min) separately from general API calls (`generalLimiter`: 100/min) and uploads (`uploadLimiter`: 30/min).
- Every login success/failure and stakeholder lock/edit is written to `audit_logs`.

### Stakeholder search — the core query

`StakeholderService.search()` builds a dynamic Prisma `WHERE` clause supporting: name (fuzzy, `companyNameStandardized` OR `companyNameOriginal`), org, state, district, PIN (prefix match), category, NIC code, GST, taluka, city/village, and status — combined with the mandatory district restriction for non-admins. Results are paginated and a "**virtual status**" `PARTIAL_COMPLETED` is computed on the fly (an `OPEN` stakeholder that already has at least one survey attached is shown as partially done, even though the DB enum itself only has `OPEN`/`CLOSED`).

### Survey completion — strict validation gate

`SurveyService.completeSurvey()` is where the rules of "what counts as a finished visit" live:

1. Contact person name — required
2. Mobile number — required
3. GPS coordinates — required
4. At least 1 photo (the README says minimum 4 but the code comment notes it was *relaxed to 1 for testing*)
5. At least 1 verification video — required
6. Phone verification — present in the schema but **currently commented out / bypassed** (the mobile UI for live phone verification was never built)

If all checks pass → survey marked complete, stakeholder transitions to `CLOSED` and gets locked to that enumerator, all inside one Prisma `$transaction`. If checks fail, the survey is saved as a non-draft but the stakeholder stays `OPEN`, and the response includes a `missingRequirements` array the mobile UI surfaces back to the user.

### Media upload — S3 + resilient survey resolution

`MediaService.upload()` is built to tolerate the offline-first mobile flow: if the `surveyId` sent doesn't exist yet on the server (because the survey hasn't synced, or the client used a `draft_<stakeholderId>` placeholder ID), it tries to resolve or **auto-create** a draft survey row to attach the media to, rather than failing outright. Files go to S3 under `{photo|video}s/{date}/{surveyId}/{filename}`, and a 1-hour presigned URL is generated and stored for client display.

### Sync engine (server side)

`POST /api/sync/upload` accepts a batch of `{ surveys, phoneValidations, mediaMetadata }` from a device that's just regained connectivity. Each survey is checked against the lock state before being upserted (so a device that's been offline for days can't accidentally overwrite a now-locked stakeholder). `GET /api/sync/changes?since=...` returns which stakeholders in the enumerator's districts have changed since their last sync, plus which IDs are now locked by someone else (so the device can purge them locally).

### Admin routes

Enumerator CRUD (create with bcrypt-hashed password + district assignment in one call), soft-delete (deactivate + force-logout by deleting sessions + auto-unlock anything they had locked + remove district assignments), district list with live stakeholder counts, paginated audit log viewer, and a system-wide analytics endpoint (status breakdown, top 20 districts by volume, per-enumerator survey counts).

### Security middleware stack

`helmet` (security headers) → CORS (env-aware origin allowlist) → `compression` → JSON/url-encoded body parsing (50MB limit, for media-adjacent payloads) → general rate limiter → routes → centralized `errorHandler` (maps Prisma errors like P2002/unique-violation and P2025/not-found to clean JSON responses, hides internal error messages in production).

---

## 5. Mobile App (React Native) — Architecture

### Stack

- **Navigation**: `@react-navigation` — a Stack Navigator wrapping a Bottom Tab Navigator (Home / Search / List / Sync), plus modal-style stack screens for Stakeholder Detail and the Survey Form.
- **State**: Redux Toolkit with 5 slices — `auth`, `stakeholder`, `survey`, `sync`, `dashboard`.
- **Local persistence**: `react-native-sqlite-storage` for bulk data (stakeholders, surveys, media, facilities, sync queue) + `react-native-encrypted-storage` for JWT tokens.
- **Server communication**: `axios` with interceptors for token attach + silent refresh-on-401.
- **Forms**: `react-hook-form` for the survey form.
- **Media/Location**: `react-native-image-picker` (camera), `react-native-geolocation-service` (GPS), `react-native-compressor` (video compression before upload), `react-native-video` (playback preview).

### The offline-first principle, end to end

This is the defining design decision of the whole app: **every screen reads from local SQLite first**, never blocking on the network. Network calls happen only to (a) pull fresh data into SQLite, or (b) push local changes up. If the device is offline, the user experience is unaffected for browsing/searching/filling forms — only the final "synced" confirmation is deferred.

### Redux slices

- **`authSlice`** — `checkSession` (auto-login from encrypted storage on app boot), `login`, `logout` (which also wipes the entire local SQLite database for security — `clearAllData()` — so a lost/stolen device retains nothing after logout).
- **`stakeholderSlice`** — search results + pagination + active filters.
- **`surveySlice`** — in-progress survey draft, captured photos array, video, GPS, dirty flag.
- **`syncSlice`** — two parallel state machines: regular background sync (`isSyncing`, `syncProgress`, `pendingCount`, `failedCount`) and a separate **initial sync** state (`isInitialSyncing`, `initialSyncProgress`, `initialSyncMessage`, `initialSyncError`) used only on first login.
- **`dashboardSlice`** — cached stats shown on the home screen.

### Initial Sync (first login experience)

On first successful login, `runInitialSync()` fires automatically (triggered from `AppNavigator`'s effect once `isAuthenticated` flips true). It:
1. Checks an `app_state` flag (`initial_sync_done`) — skips if already run.
2. Requires connectivity (fails fast with a clear message if offline).
3. Downloads **all assigned stakeholders** (`GET /api/stakeholders/assigned`) and bulk-inserts them into SQLite with live progress (10% → 40% of the bar).
4. Downloads **all facilities** (police/healthcare, used for nearest-facility lookups) and inserts them (60% → 90%).
5. Marks `initial_sync_done = true`.

This entire flow is rendered by `InitialSyncModal` — a full-screen blocking modal with a progress bar, "Please don't close the app" warning, and a Retry button if it fails (the error state intentionally does *not* clear `isInitialSyncing`, keeping the modal pinned open until the user retries or the download succeeds).

### Background Auto-Sync

Two triggers: (1) the `NetInfo` listener in `AppNavigator` fires `runAutoSync()` the instant the device regains connectivity, and (2) the user can pull-to-sync manually from the Sync tab. `runAutoSync()` (in `syncThunks.ts`) is the most intricate piece of logic in the app:

1. Drains the generic `sync_queue` table (currently used for stakeholder field edits).
2. Builds a set of all locally unsynced **survey IDs** (from both unsynced surveys and unsynced media linked to surveys).
3. For each survey, sequentially: upload the text payload → resolve the *real* server-side survey ID → upload each pending photo/video as multipart form-data → call `complete()` to trigger server-side validation/locking.
4. **Crucially, a failure on any one survey (e.g., one bad photo) does not abort the whole sync** — it's caught, logged, and the loop moves to the next survey. This means a single corrupt file can't block dozens of other surveys from syncing.
5. After all local data is pushed, it pulls `GET /api/sync/changes` to learn which stakeholders have been locked by other enumerators meanwhile, and deletes those from local SQLite (so the enumerator stops seeing stakeholders someone else already closed).
6. Refreshes the local facilities table.
7. Updates `last_sync_time` and pending/failed counters shown on the Dashboard and Sync screens.

---

## 6. Mobile App — Screen-by-Screen UI/UX

### Visual design language

Dark-mode-only theme (`theme/index.ts`) built around Maharashtra's saffron/orange (`#FF6B35`) as the primary accent against deep navy backgrounds (`#0B0F1A` / `#1A2035`), with a secondary deep blue and gold accent. Consistent design tokens for spacing, border radius, typography scale (h1/h2/h3/body/caption/stat), and three shadow presets (`card`, `elevated`, `glow` — the glow uses the orange color itself for a soft halo on focused/active elements). All sizes run through a `moderateScale`/`verticalScale` responsive scaling helper so the layout adapts across phone screen sizes.

### 1. Login Screen
- Centered single-column form: animated logo (fade + slide-in on mount, with a subtle continuous pulse), app title "MahaAtithi", subtitle "Maharashtra Tourism Department", tagline "Stakeholder Verification Portal".
- Login ID + Password fields with **focus-state styling** (border and label change to orange + a soft glow shadow when focused) and a show/hide password eye icon.
- Error banner (red, with an alert icon) appears inline above the form on failed login.
- Sign-in button has a press-in scale animation (spring) and shows a spinner while the `login` thunk is in flight.
- Footer: "Contact your administrator for login credentials" (no self-signup — accounts are admin-provisioned only).

### 2. Dashboard (Home tab)
- Personalized greeting that changes by time of day ("Good morning/afternoon/evening,") + the user's name, with a circular avatar (first letter of name) and a logout button (confirms via a native Alert before logging out).
- **Assigned Districts** — a horizontally scrollable row of pill-shaped tags showing every district the enumerator can work in.
- **Overview** stat cards (Completed / Open Tasks) that fade and spring-scale into place with a staggered delay per card.
- **Sync Status card** — last sync timestamp, pending upload count (badge turns green when zero, amber when >0), and a failed-upload row that only appears when failures exist (and turns red).
- **Quick Actions** — two large buttons: "Search" and "Sync Now", each jumping straight to that tab.
- Pull-to-refresh re-fetches stats from the server (falls back silently to cached stats if offline).

### 3. Search tab
- A **cascading filter** UI: District → City/Village → PIN Code, where each subsequent filter is disabled until the one before it is chosen, and selecting a District auto-populates the City picker (and City auto-populates PIN) by querying *distinct* values already present in local SQLite — so the dropdown options are always realistic, never empty guesses.
- District/City/PIN selectors open as a bottom-sheet-style modal (spring slide-up animation) listing tappable options.
- Search itself always reads from local SQLite (never the network) and is debounced 500ms after the last filter change.
- Each result renders as a card with a colored left-border strip keyed to status (`OPEN` = gray, `PARTIAL_COMPLETED` = amber, `CLOSED` = green), organization name, a status badge pill, and a meta row with map-marker/city/mailbox icons for district/city/PIN.
- Empty state: a pulsing search icon + "Find Stakeholders" + helper copy, shown only when no filters are active and not currently searching.
- Infinite scroll (`onEndReached`) with a loading spinner footer.

### 4. Stakeholders (List tab)
- Same card design as Search, but lists everything in SQLite with no filters — essentially "my full local dataset, paginated".
- **Skeleton loading state**: five pulsing placeholder cards shown while the first page loads, before any real data is available — avoids a jarring blank screen.
- Cards animate in with a staggered fade+slide on first render (capped at a 500ms max delay so long lists don't feel sluggish).
- Header shows a live count badge ("N items").

### 5. Stakeholder Detail screen
- **Hero header** — a colored panel (color tied to status: amber for OPEN, green for CLOSED) showing a status dot+label, the organization's full name, and a monospaced UIN badge.
- Three **collapsible accordion sections** (Basic Information, Location Details, Registration Info) — each animates open/closed with native `LayoutAnimation`, has its own icon, and only renders rows whose value is actually present (no "—" clutter for missing CSV fields). "Basic Information" is expanded by default.
- A fourth **Survey Data** section appears (also expanded by default) once a survey exists — showing the field-collected contact person, designation, mobile, email, website, and formatted GPS coordinates.
- Data loading is itself offline-first: stakeholder and survey are read from SQLite immediately; if the device is online, the survey is silently re-fetched from the server in the background and swapped in if newer — the user never sees a loading flicker for this refresh.
- A **fixed bottom action bar** (hidden once the stakeholder is `CLOSED`) with two buttons: "Edit Details" (secondary, outlined) and "Survey" (primary, filled, orange) which navigates into the Survey Form.
- **Edit modal** — a full-screen sheet (`presentationStyle="pageSheet"`) with text inputs for the editable stakeholder fields (name, address lines, city, taluka, village, district, state, PIN, category). Saving writes to local SQLite *immediately* (instant UI feedback), queues the change in `sync_queue`, and kicks off a background sync — so edits feel instant even offline.
- A loading-state **skeleton screen** (animated gray blocks mimicking the hero + sections) is shown while data loads, matching the real layout's proportions.

### 6. Survey Form screen — the most complex screen in the app
A guided **3-step wizard** with a top progress bar (percentage-based, computed live from filled fields + GPS + media) and a breadcrumb strip (1. Details → 2. Media → 3. Review) that's also directly tappable to jump between steps.

**Step 1 — Details**
- A **GPS card** at the top: shows a pulsing crosshair icon while acquiring location, a green checkmark + the actual lat/lng (6 decimal places) and accuracy radius once captured, or a Retry button on failure. GPS capture fires automatically on screen mount.
- Standard animated text inputs (focus-glow style, matching Login screen) for Contact Person*, Designation, Mobile*, Email.
- Two **autocomplete inputs** — Nearest Police Station / Nearest Healthcare Center — which are *auto-filled* the moment GPS resolves, by querying the locally-cached `facilities` table for the closest match (Haversine-style distance calc) and showing it pre-filled with the distance in km (e.g. "Wardha Police Station (2.3 km)"). The user can still type to search/override via a live dropdown of suggestions.
- GST Number, Organization Type, Website, Remarks fields below.

**Step 2 — Media**
- Five **photo capture slots**: Building Front, Signboard, Interior, Stakeholder, Additional (first four required, last optional) — each rendered as a card with an icon, label, required/optional tag, and either an "empty" capture button or, once shot, a preview image with Retake/Remove actions.
- Capturing a photo requires camera + location permission, opens the native camera, and stamps the photo with GPS at time of capture.
- A **Verification Video slot** (required, max 60 seconds) — same camera-permission flow, then runs the captured video through `react-native-compressor` (showing a "Compressing Video…" state) before it's stored, to keep upload sizes manageable on poor connections. Captured video plays back inline with native controls.

**Step 3 — Review**
- A summary card showing overall completion %, with a live bulleted list of everything still missing (GPS, any required field, any required photo, the video) — each as a red warning line — so the enumerator knows exactly what's blocking submission before they even try.
- The **Save Survey** button is disabled while saving and shows a spinner with live status text ("Saving survey data…" → "Uploading Photo 2/5…" → "Finalizing survey…") so long-running uploads never feel frozen.

**Submission logic** (triggered from Step 3, but actually guarded by `react-hook-form` validation across the whole form):
1. Hard client-side gate: GPS, all 4 required photos, and the video must all be present, or an `Alert` blocks submission with a specific message.
2. Saves the survey + media **to local SQLite first**, unconditionally — this is the safety net.
3. If online: tries to push to the server (create/update survey → upload each photo/video sequentially with live progress text → call `complete()`). On any upload failure mid-way, it falls back gracefully — the data stays safely local and gets queued for the background sync engine to retry later, with a clear "Saved Locally" message instead of an error.
4. If offline: skips straight to queuing for background sync, with a "Saved Offline" message.
5. Either way, navigates back to the Stakeholders list — the enumerator is never blocked waiting for a network round-trip.

A bottom **Back/Next bar** lets the user move between the three steps without losing entered data (the form state is held in one `react-hook-form` instance for the whole screen).

### 7. Sync tab (Sync Center)
- An "Online"/"Offline" pill badge (live, from `NetInfo`) at the top.
- "Last Successful Sync" card with a human-readable timestamp.
- Two stat cards: Pending Uploads (amber) and Failed Uploads (red).
- A progress bar that appears only while a sync is actively running, animated smoothly to the live percentage from the sync thunk.
- A large "Sync Now" button — disabled while offline or already syncing, shows a spinning sync icon + "Syncing Data…" while active.
- An **"How Sync Works" info card** at the bottom, plainly explaining the offline-first model to the enumerator in four bullet points (saved locally when offline, auto-syncs when online, failed uploads retry automatically, completed stakeholders disappear from your list) — a nice piece of UX that demystifies the background behavior for non-technical field staff.

### 8. Initial Sync Modal (global overlay)
Not a tab — a full-screen blocking modal that can appear over any screen right after first login. Cloud-download icon, "Initial Setup" title, live message + percentage progress bar, and an explicit "Please do not close the app. This might take 3–5 minutes" warning. On failure, the icon and title switch to an error state with a "Retry Download" button, and the modal *stays open* — the app is unusable until this completes successfully, by design, since without the local stakeholder/facility data nothing else in the app would have anything to show.

---

## 7. Admin Web Panel (React + Vite)

A single-page app (`admin-panel/src/App.tsx`, ~1,275 lines) — everything lives in one file as named function components, switched by a simple `activePage` string in local state (no router needed for the internal pages; `react-router-dom` is present but lightly used).

### Login Page
Same loginId/password concept as mobile, posts to the same `/api/auth/login`, stores the JWT in `localStorage` under `admin_token`. The Axios interceptor in `api.ts` automatically force-redirects to `/login` on any 401, anywhere in the app.

### Shell / Navigation
A persistent left sidebar with five nav items — **Dashboard, Stakeholders, Enumerators, Districts, Audit Logs** — each a clickable `nav-item` that swaps the active page in the main content area. Data for enumerators, districts, analytics, and (conditionally) audit logs is fetched once on mount / when the relevant tab is opened.

### Dashboard Page
- A 5-card stat grid: Total Stakeholders, Closed, Pending, In Review, Enumerators — each with an emoji icon and a colored accent (orange/green/blue/purple/red).
- A "Top Districts by Stakeholder Count" table (top 10 of the top-20 the API returns), sorted descending.

### Stakeholders Page
- A filter bar (Organization Name, District, PIN Code, Status dropdown) with **live debounced search** (300ms) — typing instantly re-queries, no need to click Search (a submit button exists too, for explicit triggering).
- A data table: Organization, District, City/Taluka, PIN (monospaced code chip), Category, Status badge, and a "📸 View Gallery" action button per row. Clicking anywhere on a row also opens the gallery.
- Simple Previous/Next pagination (20 per page), with the Next button disabled once a page returns fewer than 20 rows.

### Verification Gallery Modal
Opens when an admin clicks a stakeholder row — fetches that stakeholder's survey and media in the background, shows:
- The submitted contact/survey details.
- A photo/video gallery grid with a **lightbox** (click to enlarge) for reviewing field-captured evidence.
- Editing capability for the admin to correct/update stakeholder info directly from the review screen, which calls back up to update the parent table's row in place (`onStakeholderUpdated`) without needing a full page refresh.

### Enumerators Page
Table of all enumerators (active/inactive, admin or not, assigned districts, survey count, created date) with actions to:
- **Create** a new enumerator (modal: loginId, password, name, phone, email, isAdmin checkbox, multi-select district assignment) — all in one API call.
- **Toggle active/inactive** status.
- **Assign Districts** (separate modal — a multi-select list synced via `PUT /admin/enumerators/:id/districts`).
- **Delete** (soft-delete — deactivates, force-logs-out by clearing sessions, unlocks anything they had locked, and clears their district assignments so they stop counting toward metrics).

### Districts Page
Read-only table of all 36 Maharashtra districts with live enumerator count and stakeholder count per district (sourced from a `groupBy` query on the backend) — useful for admins to spot under-staffed districts with large stakeholder backlogs.

### Audit Logs Page
Paginated, filterable (by action type / enumerator) log viewer surfacing every `audit_logs` row — logins, lock events, edits, enumerator management — giving the department a full accountability trail.

---

## 8. CSV Import Pipeline (one-time data load)

`backend/scripts/import-csv.ts` is the tool that loaded the original 313,604-row government dataset into PostgreSQL:

```
CSV (≈125MB) → streaming csv-parse → row validation → dedup/resume support
  → batched (configurable, default ~1,000–2,000 rows) → Prisma createMany (skipDuplicates)
  → pg_trgm / unaccent extensions enabled for fuzzy text search
  → district auto-creation for any district found in the CSV but not yet seeded
  → import summary report
```

Supports `--dry-run`, `--upsert` (update existing rows instead of skip), `--resume` (continue an interrupted import without re-inserting completed rows), and `--concurrency` (parallel batch inserts) — this was clearly engineered for a large one-shot production import that needed to be safely re-runnable.

`prisma/seed.ts` separately seeds the 36 Maharashtra districts, the admin account (`admin` / `admin@123`), and five sample enumerator accounts pre-assigned to specific districts (Wardha, Nagpur, multi-district, Pune, Mumbai) for testing.

`backend/src/scripts/seedFacilities.ts` / `backend/scripts/seed-facilities.ts` populate the `facilities` table (police stations & healthcare centers) used for the mobile app's "nearest facility" auto-fill feature.

---

## 9. Default Accounts (from README)

| Role | Login ID | Password |
|---|---|---|
| Admin | `admin` | `admin@123` |
| Enumerator (Wardha) | `enum_wardha_01` | `enum@123` |
| Enumerator (Nagpur) | `enum_nagpur_01` | `enum@123` |
| Enumerator (Multi-district) | `enum_multi_01` | `enum@123` |
| Enumerator (Pune) | `enum_pune_01` | `enum@123` |
| Enumerator (Mumbai) | `enum_mumbai_01` | `enum@123` |

---

## 10. Notable Engineering Decisions Worth Knowing About

1. **Offline-first is not a fallback — it's the primary mode.** Every mobile screen reads from SQLite first; the network is purely for keeping SQLite in sync. This is the right call for field staff working in rural/low-signal areas.
2. **Survey completion validation is currently relaxed** for testing: the README and original spec mention "minimum 4 photos," but the live code requires only 1, and phone verification is explicitly commented out since the mobile UI for it doesn't exist yet. Anyone picking this codebase back up should treat these as known TODOs, not bugs.
3. **Locking is optimistic, not pessimistic** — there's no live distributed lock; it's "first device to successfully sync a completed survey wins," with everyone else's stale local copies getting cleaned up on their next sync. This trades a small chance of wasted field work (two enumerators visiting the same place) for massive simplification of the offline architecture.
4. **Defense-in-depth district restriction** — enforced in middleware *and* the service layer, so even a future code change that adds a new endpoint without the middleware will still fail safe in the query logic.
5. **Sync resilience by design** — a single bad photo upload doesn't take down an entire batch sync; failures are isolated per-survey and logged, letting everything else proceed.
6. **Security-conscious logout** — logging out wipes the entire local SQLite database, not just the auth tokens, so a lost or shared device doesn't leak the 313K-row dataset or any unsynced survey data.