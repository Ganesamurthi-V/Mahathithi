# MahaAthithi — Maharashtra Tourism Stakeholder Verification Platform

Production-grade Android-first React Native application with Node.js + PostgreSQL backend for Maharashtra Tourism Department field enumerators.

## Architecture

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

## Quick Start

### 1. Prerequisites

- Node.js 20+
- Docker Desktop (for PostgreSQL)
- Android SDK + device/emulator
- AWS S3 bucket (for media storage)

### 2. Start Database

```bash
docker-compose up -d
```

PostgreSQL will be available at `localhost:5432`
- Database: `mahaathithi`
- User: `mahaathithi_admin`
- Password: `MahaAthithi@2024Secure`

### 3. Setup Backend

```bash
cd backend
npm install
cp .env.example .env
# Edit .env with your AWS credentials

# Generate Prisma client & run migrations
npx prisma generate
npx prisma db push

# Seed database (creates admin, districts, sample enumerators)
npm run db:seed

# Import stakeholder CSV (313,604 records)
npm run import:csv -- --file="../MahaAthithi_Master_Database_v3 (1).csv"

# Start development server
npm run dev
```

Backend runs at: `http://localhost:3000`
Health check: `http://localhost:3000/api/health`

### 4. Setup Admin Panel

```bash
cd admin-panel
npm install
npm run dev
```

Admin panel runs at: `http://localhost:5173`
Login: `admin` / `admin@123`

### 5. Setup Mobile App

```bash
cd mobile
npm install

# For Android
npx react-native run-android
```

## API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/auth/login` | Login with loginId + password |
| POST | `/api/auth/refresh` | Refresh JWT token |
| GET | `/api/auth/me` | Get current user profile |
| GET | `/api/stakeholders/search` | Multi-filter search (paginated) |
| GET | `/api/stakeholders/:id` | Stakeholder detail |
| GET | `/api/stakeholders/assigned` | Assigned stakeholders (for sync) |
| PATCH | `/api/stakeholders/:id/lock` | Lock stakeholder on completion |
| POST | `/api/surveys` | Create/update survey |
| POST | `/api/surveys/:id/complete` | Complete survey (validates requirements) |
| POST | `/api/media/upload` | Upload photo/video to S3 |
| POST | `/api/phone-validation` | Record phone verification |
| POST | `/api/sync/upload` | Batch upload offline data |
| GET | `/api/sync/changes` | Get changes since last sync |
| GET | `/api/dashboard/stats` | Dashboard statistics |
| GET | `/api/admin/enumerators` | List enumerators (admin) |
| POST | `/api/admin/enumerators` | Create enumerator (admin) |
| PUT | `/api/admin/enumerators/:id/districts` | Assign districts (admin) |
| GET | `/api/admin/analytics` | System analytics (admin) |

## Default Credentials

| Role | Login ID | Password |
|------|----------|----------|
| Admin | `admin` | `admin@123` |
| Enumerator (Wardha) | `enum_wardha_01` | `enum@123` |
| Enumerator (Nagpur) | `enum_nagpur_01` | `enum@123` |
| Enumerator (Multi) | `enum_multi_01` | `enum@123` |
| Enumerator (Pune) | `enum_pune_01` | `enum@123` |
| Enumerator (Mumbai) | `enum_mumbai_01` | `enum@123` |

## CSV Import Pipeline

```
CSV File (125MB, 313,604 records)
  → Streaming Parser (csv-parse)
  → Row Validation (required fields, data types)
  → Batch Processing (1,000 records per batch)
  → PostgreSQL INSERT (Prisma createMany + skipDuplicates)
  → Trigram Index Creation (pg_trgm for fuzzy search)
  → District Auto-Creation
  → Import Summary Report
```

## Database Schema

10+ tables with optimized indexes for 313K+ records:

- **enumerators** — Field staff accounts
- **districts** — Maharashtra districts (36)
- **enumerator_districts** — District assignments (M:N)
- **sessions** — JWT refresh token management
- **stakeholders** — 313,604 imported records (31 CSV columns + status + locking)
- **surveys** — Enumerator survey data
- **media** — Photo/video metadata (S3 paths)
- **phone_validations** — Call verification records
- **sync_queue** — Offline sync queue
- **audit_logs** — System audit trail

## Production Deployment

### Backend (PM2)

```bash
cd backend
npm run build
pm2 start dist/index.js --name mahaathithi-api -i max
```

### Admin Panel

```bash
cd admin-panel
npm run build
# Serve dist/ with nginx
```

### Mobile (APK)

```bash
cd mobile
cd android
./gradlew assembleRelease
# APK at: android/app/build/outputs/apk/release/
```

## Environment Variables

| Variable | Description | Required |
|----------|-------------|----------|
| `DATABASE_URL` | PostgreSQL connection string | ✅ |
| `JWT_SECRET` | JWT signing secret (min 32 chars) | ✅ |
| `AWS_REGION` | AWS region for S3 | ✅ |
| `AWS_ACCESS_KEY_ID` | AWS access key | ✅ |
| `AWS_SECRET_ACCESS_KEY` | AWS secret key | ✅ |
| `S3_BUCKET_NAME` | S3 bucket for media | ✅ |
| `REDIS_URL` | Redis connection URL | Optional |
| `PORT` | API server port | Default: 3000 |

## License

Maharashtra Tourism Department — Government of Maharashtra
