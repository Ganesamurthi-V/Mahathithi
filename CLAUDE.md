# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

MahaAtithi — a stakeholder-verification platform for Maharashtra Tourism field enumerators. Three deployables in one repo plus a shared Postgres database:

- `backend/` — Express + TypeScript REST API, Prisma ORM over PostgreSQL, S3 for media.
- `mobile/` — React Native 0.75 (Android-first) offline-first enumerator app with a local SQLite mirror.
- `admin-panel/` — React + Vite SPA for enumerator/district management.

The domain centers on **stakeholders** (313K+ company records imported from a 125MB CSV) that enumerators **survey** in the field, attaching photos/videos and phone verifications, then **sync** back to the server.

## Commands

All three packages are independent npm projects — `cd` into each. There is no root-level workspace.

```bash
# Database (required before backend)
docker-compose up -d                  # Postgres on localhost:5432

# Backend (cd backend)
npm run dev                           # tsx watch, serves http://localhost:3000
npm run build && npm start            # tsc → dist/, then node
npm run lint                          # eslint src/
npm test                              # jest
npm run db:push                       # prisma db push (schema → DB, no migration files)
npm run db:generate                   # regenerate Prisma client after schema edits
npm run db:seed                       # admin, districts, sample enumerators
npm run db:studio                     # Prisma Studio
npm run import:csv -- --file="../MahaAtithi_Master_Database_v3 (1).csv"   # 313K stakeholders, batched 1000/insert

# Mobile (cd mobile)
npm run android                       # run-android (needs emulator/device)
npm start                             # Metro bundler
npm run lint
npm test

# Admin panel (cd admin-panel)
npm run dev                           # vite, http://localhost:5173
npm run build                         # tsc && vite build
```

Run a single backend test: `cd backend && npx jest path/to/file.test.ts -t "test name"`.

## Architecture essentials

### District-scoped access control is the core security invariant
Every enumerator is assigned a set of districts (`EnumeratorDistrict` M:N). A non-admin may only read or write stakeholder-scoped data (surveys, media, phone validations, sync) for stakeholders in their assigned districts. This is enforced through one function — `backend/src/utils/access-control.ts:assertStakeholderAccess(stakeholder, callerDistricts, isAdmin)`. **Call it from every module that touches stakeholder-scoped data.** The sync upload path re-implements the same check inline (`sync.service.ts`) because it processes batches. `authMiddleware` attaches `req.enumerator.districts` (an array of district *names*); district comparison is case-insensitive via `.toUpperCase()`.

### Auth
JWT access token (15m) + refresh token (7d, stored in `sessions` table). `authMiddleware` verifies the access token *and* re-fetches the enumerator on every request (so deactivating an account takes effect immediately). `adminOnly` gates admin routes. Admins (`isAdmin`) bypass district scoping entirely.

### Offline-first sync model (the trickiest part)
The mobile app holds a **SQLite mirror** (`mobile/src/database/index.ts`) of the stakeholders in the enumerator's districts, plus locally-created surveys/media/phone-validations. Schema evolution there is done with idempotent `ALTER TABLE ... ADD COLUMN` wrapped in try/catch (no migration framework).

- Surveys/media/phone-validations carry a `localId` (SQLite id) so the server can map offline-created rows to server rows on upload.
- Upload: `POST /api/sync/upload` → `SyncService.processUpload`. **First-to-sync-wins** conflict resolution: a stakeholder gets `lockedById`/`status=CLOSED` on survey completion; once locked by another enumerator, later uploads for it fail with a per-item error (the batch does not abort). Arrays are capped at `MAX_BATCH_ITEMS = 200` and the route allows a 50MB body (global limit is 1MB — see below).
- Download: `GET /api/sync/changes?since=<iso>` returns stakeholders updated since the timestamp plus the ids now locked by others, so the device can grey them out.
- Mobile sync orchestration lives in `mobile/src/store/slices/syncThunks.ts` (Redux Toolkit); state in `syncSlice.ts`.

### Backend module convention
Each feature under `backend/src/modules/<name>/` is a triplet: `*.routes.ts` (Express router + Zod validation + middleware wiring) → `*.controller.ts` (HTTP glue) → `*.service.ts` (Prisma/business logic). Modules: `auth`, `stakeholder`, `survey`, `media`, `facilities`, `dashboard`, `sync`, `phone-validation`, `admin`. Routes are mounted under `/api/*` in `backend/src/index.ts`.

### Config fails fast
`backend/src/config/index.ts` calls `requireEnv()` at boot — the server **crashes immediately** if `DATABASE_URL` is missing or `JWT_SECRET` is shorter than 32 chars. There are intentionally no hardcoded fallbacks for secrets. Add new required env vars through `requireEnv` so misconfiguration fails loudly.

### Stakeholder search relies on Postgres indexes
`stakeholders` has many B-tree and composite indexes (district, category, pinCode, status, etc.) tuned for the 313K-row dataset; the README references `pg_trgm` trigram indexes for fuzzy company-name search. Prefer filtering on indexed columns/combinations when adding search features.

## Conventions worth matching

- **Prisma field mapping:** camelCase in TS, `@map("snake_case")` columns, `@@map("snake_case")` tables. Keep this consistent.
- **`db:push`, not migrations:** the schema is applied with `prisma db push` (no `migrations/` directory). `npx prisma db push --force-reset` wipes everything.
- **Fix markers:** inline comments like `// M1 FIX`, `// H1 FIX`, `// C1 FIX`, `// BUG 3 FIX` reference findings in `Security audit report.md`. Preserve the rationale comments when editing that code. The global JSON body limit is intentionally 1MB (`index.ts`) with 50MB applied *only* on the sync upload route.
- **Errors:** throw the typed errors from `backend/src/utils/errors.ts` (`ForbiddenError`, `UnauthorizedError`, `ValidationError`, …); the central `errorHandler` middleware formats the `{ success, error: { code, message } }` response shape.
- **Validation:** Zod schemas in route files for the backend; `react-hook-form` + Zod in mobile forms.
- **Logging:** Winston via `backend/src/utils/logger.ts` (→ `backend/logs/`), never `console.log` in backend.

## Current branch context

Active branch `feature/sqlite` is building out the mobile offline SQLite layer and hardening sync. The DB provider in `docker-compose.yml`/Prisma is PostgreSQL on the server; "SQLite" refers to the **mobile on-device** store, not the backend.
