# Speed Skate Saskatchewan Results

A full-stack web application for publishing speed skating competition results. Admins upload GCPV `.pat` files; the site automatically processes them and makes results searchable by athlete or event.

**Live site:** https://sassa-results.web.app

---

## Architecture

```
Browser
  │
  ├── Firebase Hosting (React SPA)
  │     frontend/dist → https://sassa-results.web.app
  │
  ├── Cloud Run — REST API
  │     functions/api/ → northamerica-northeast1
  │     Reads Cloud SQL via Cloud SQL Connector
  │
  └── GCS upload → Eventarc → Cloud Run — PAT Processor
        Admin uploads .pat file via browser
        → GCS bucket  gs://sassa-odc-assets/uploads/{ST|LT}/
        → Eventarc triggers pat-processor Cloud Run service
        → mdbtools extracts MDB tables
        → results upserted into Cloud SQL
```

**Services used:**

| Service | Purpose |
|---|---|
| Firebase Hosting | Static SPA hosting with SPA rewrites |
| Firebase Auth | Google sign-in for admin access |
| Cloud Run (Gen 2) | REST API + PAT processor |
| Cloud SQL (PostgreSQL 15) | Results database |
| Google Cloud Storage | PAT file staging area |
| Eventarc | GCS finalize → PAT processor trigger |
| Secret Manager | Database password |
| Artifact Registry | Docker images for Cloud Run |

---

## Project Structure

```
.
├── database/
│   ├── schema.sql          # Table definitions, indexes, and views
│   └── grants.sql          # Role grants for the skate_app DB user
│
├── frontend/               # React SPA
│   ├── src/
│   │   ├── App.jsx         # Router, header, layout
│   │   ├── api.js          # Typed fetch helpers for the REST API
│   │   ├── firebase.js     # Firebase SDK init
│   │   ├── contexts/
│   │   │   └── AuthContext.jsx   # Firebase Auth provider
│   │   └── pages/
│   │       ├── Home.jsx               # Events + Athletes tabs
│   │       ├── SkaterProfile.jsx      # Best times + all results
│   │       ├── CompetitionResults.jsx # Full results for one event
│   │       └── Admin.jsx              # Upload, user management, API keys
│   ├── public/
│   │   └── logo.webp       # Speed Skating Sask logo
│   ├── tailwind.config.js  # Brand green colour scale
│   └── index.html
│
├── functions/
│   ├── api/                # REST API (Flask)
│   │   ├── main.py
│   │   ├── requirements.txt
│   │   └── Dockerfile
│   └── pat_processor/      # PAT file ingestion (functions-framework)
│       ├── main.py         # Eventarc entry point
│       ├── extractor.py    # MDB → structured dicts
│       ├── loader.py       # Upsert into Cloud SQL
│       ├── requirements.txt
│       └── Dockerfile
│
├── firebase.json           # Hosting config (SPA rewrites)
└── SSC_SK_Logo_Colour_RGB.webp
```

---

## Local Development

### Prerequisites

- Node.js 20+
- Python 3.11+
- [Google Cloud CLI](https://cloud.google.com/sdk/docs/install) authenticated with the project
- [Firebase CLI](https://firebase.google.com/docs/cli) (`npm install -g firebase-tools`)

### Frontend

```bash
cd frontend
npm install
npm run dev          # http://localhost:5173
```

The dev server proxies nothing — the frontend talks directly to the deployed Cloud Run API. To point at a local API instead, edit `BASE` in `src/api.js`.

### API (local)

```bash
cd functions/api
pip install -r requirements.txt

export GCP_PROJECT=sassa-odc
export CLOUD_SQL_INSTANCE=sassa-odc:northamerica-northeast1:skate-results-db
export DB_NAME=skate_results
export DB_USER=skate_app
export DB_SECRET=skate-db-app-password

python main.py       # http://localhost:8080
```

Requires Application Default Credentials (`gcloud auth application-default login`) with Secret Manager and Cloud SQL access.

### PAT Processor (local)

```bash
cd functions/pat_processor
pip install -r requirements.txt
# Also requires mdbtools installed on the host (see Dockerfile)
```

The processor is designed to run inside a container. For ad-hoc local testing, call `extractor.extract()` and `loader.load()` directly from a Python script.

---

## Deployment

### Frontend

```bash
cd frontend
npm run build
firebase deploy --only hosting
```

### API (Cloud Run)

```bash
cd functions/api

gcloud builds submit --tag northamerica-northeast1-docker.pkg.dev/sassa-odc/skate-functions/skate-api

gcloud run deploy skate-api \
  --image northamerica-northeast1-docker.pkg.dev/sassa-odc/skate-functions/skate-api \
  --region northamerica-northeast1 \
  --set-env-vars GCP_PROJECT=sassa-odc,CLOUD_SQL_INSTANCE=sassa-odc:northamerica-northeast1:skate-results-db \
  --add-cloudsql-instances sassa-odc:northamerica-northeast1:skate-results-db \
  --allow-unauthenticated
```

### PAT Processor (Cloud Run)

```bash
cd functions/pat_processor

gcloud builds submit --tag northamerica-northeast1-docker.pkg.dev/sassa-odc/skate-functions/pat-processor

gcloud run deploy pat-processor \
  --image northamerica-northeast1-docker.pkg.dev/sassa-odc/skate-functions/pat-processor \
  --region northamerica-northeast1 \
  --set-env-vars GCP_PROJECT=sassa-odc,CLOUD_SQL_INSTANCE=sassa-odc:northamerica-northeast1:skate-results-db \
  --add-cloudsql-instances sassa-odc:northamerica-northeast1:skate-results-db \
  --no-allow-unauthenticated
```

The Eventarc trigger (GCS → pat-processor) was created once via:

```bash
gcloud eventarc triggers create pat-upload-trigger \
  --location northamerica-northeast1 \
  --destination-run-service pat-processor \
  --destination-run-region northamerica-northeast1 \
  --event-filters "type=google.cloud.storage.object.v1.finalized" \
  --event-filters "bucket=sassa-odc-assets" \
  --service-account <eventarc-sa>@sassa-odc.iam.gserviceaccount.com
```

### Database

Run `database/schema.sql` then `database/grants.sql` once against a fresh Cloud SQL instance. Re-running is safe (all statements are `CREATE IF NOT EXISTS` / `CREATE OR REPLACE`).

To apply schema changes to an existing instance without an interactive psql session, upload the SQL to GCS and use `gcloud sql import sql`:

```bash
gcloud storage cp migration.sql gs://sassa-odc-assets/migrations/migration.sql
gcloud sql import sql skate-results-db gs://sassa-odc-assets/migrations/migration.sql \
  --database=skate_results --project=sassa-odc
```

---

## PAT File Format

GCPV (the timing software used by Speed Skate Canada) exports results as `.pat` files, which are Microsoft Access MDB databases. Each file contains these relevant tables:

| Table | Contents |
|---|---|
| `TCompetition` | Competition name, date, location |
| `TPatineurs` | Skater master data (name, DOB, gender) |
| `TClubs` | Club names and abbreviations |
| `TCategorie` | Age categories |
| `TPatineur_compe` | Skater registrations for a competition |
| `TVagues` | Individual heats / flights |
| `TProg_Courses` | Distance/event program |
| `TPatVagues` | Result rows (time, place, penalty code) |
| `TCommentaire` | Finish codes (DNF, DNS, P-xxx, etc.) |

**Important quirk:** GCPV seeds each new `.pat` from the previous event's file, carrying forward all prior `TCompetition` rows and skater data. When a file contains multiple competitions, the extractor picks the one with the most recent date (using entry count as a tiebreaker for same-day events).

**Time encoding:** GCPV stores times as a float where the integer part is minutes and `fractional × 100` is seconds with hundredths. For example `1.5357` = 1 min 53.57 sec = 113,570 ms.

**mdbtools** (Linux MDB reader) is used to export tables to CSV inside the Cloud Run container. It is installed in the `pat_processor` Dockerfile.

---

## REST API

Base URL: `https://skate-api-232158332347.northamerica-northeast1.run.app`

All responses are JSON. Two authentication schemes are in use:

- **Firebase ID token** (`Authorization: Bearer <token>`) — required for admin UI endpoints (user management, PAT upload, API key management). Token is obtained via Firebase Auth (Google sign-in).
- **API key** (`Authorization: ApiKey ssk_<key>`) — required for the batch export endpoint. Keys are generated in the Admin UI, valid for 30 days.

### Public endpoints

| Method | Path | Description |
|---|---|---|
| GET | `/api/seasons` | List all seasons (e.g. `["2024-2025", "2023-2024", …]`) |
| GET | `/api/competitions?season=` | List competitions, optionally filtered by season |
| GET | `/api/competitions/<id>/results` | All result rows for a competition |
| GET | `/api/skaters?q=` | Search skaters by name (up to 50 results) |
| GET | `/api/skaters/<code_pat>` | Skater profile + career best times |
| GET | `/api/skaters/<code_pat>/seasons/<season>` | Season best times |
| GET | `/api/skaters/<code_pat>/best-times?from=&to=` | Best times within a custom date range (ISO dates) |
| GET | `/api/skaters/<code_pat>/results` | All individual result rows for a skater |

### Admin endpoints (Firebase ID token)

| Method | Path | Description |
|---|---|---|
| POST | `/api/admin/upload` | Upload a `.pat` file (multipart: `file` + `track_type`) |
| GET | `/api/admin/users` | List admin email addresses |
| POST | `/api/admin/users` | Add an admin (`{"email": "…"}`) |
| DELETE | `/api/admin/users/<email>` | Remove an admin |
| GET | `/api/admin/api-keys` | List active API keys (label, created by, expiry) |
| POST | `/api/admin/api-keys` | Generate a new 30-day API key. Body: `{"label": "optional"}`. Returns `{id, key, expires_at}` — **key is shown once only** |
| DELETE | `/api/admin/api-keys/<id>` | Revoke a key immediately |

### Batch export endpoint (API key)

```
POST /api/batch/best-times?from=YYYY-MM-DD&to=YYYY-MM-DD
Authorization: ApiKey ssk_<key>
Content-Type: text/csv
```

**Request body** — CSV with `ssc_id` and `name` columns:

```
ssc_id,name
SK-AB1234,Jane Smith
SK-CD5678,John Doe
```

**Response** — `text/csv` download, one row per (skater × track type × distance) PB in the date range. Skaters not found in the database, or with no results in the period, return a single row with just the input fields and blank time columns:

```
ssc_id,name,club,track_type,distance,best_time,achieved_at,achieved_on
SK-AB1234,Jane Smith,Saskatoon SC,ST,500m,43.21,Prairie Opener,2024-10-19
SK-AB1234,Jane Smith,Saskatoon SC,LT,500 Olympic Style (400),38.90,RSTM,2025-01-11
SK-CD5678,John Doe,,,,,,
```

The filename is set to `best-times-{from}-to-{to}.csv`.

---

## Database Schema

### Tables

**`competitions`**

| Column | Type | Notes |
|---|---|---|
| `id` | serial PK | |
| `name` | text | Competition name (from GCPV `Lieu`) |
| `date` | date | |
| `season` | varchar(9) | e.g. `2024-2025` |
| `track_type` | char(2) | `ST` or `LT` |
| `imported_at` | timestamptz | |

**`skaters`**

| Column | Type | Notes |
|---|---|---|
| `id` | serial PK | |
| `code_pat` | varchar(30) UNIQUE | GCPV skater ID (e.g. `QC-AB1234`) |
| `first_name` | text | |
| `last_name` | text | |
| `dob` | date | Visible to admins only |
| `gender` | char(1) | `M` / `F`; visible to admins only |
| `club_name` | text | |
| `club_abbrev` | varchar(15) | |

**`results`**

| Column | Type | Notes |
|---|---|---|
| `id` | serial PK | |
| `competition_id` | int FK | |
| `skater_id` | int FK | |
| `distance` | text | e.g. `500m`, `1000m`, `400 (100)` |
| `qual_or_fin` | text | `Qual` or `Fin` |
| `heat` | text | Heat/flight number |
| `lane` | text | Helmet/lane number |
| `time_ms` | int | Milliseconds; NULL for DNS/DNF |
| `time_display` | text | Formatted, e.g. `1:23.45` |
| `place` | int | Finishing position |
| `age_class` | text | Category at competition time |
| `finish_code` | text | NULL = clean finish; else `DNF`, `DNS`, `P-xxx`, etc. |
| `points` | numeric(8,2) | |
| `is_valid_time` | boolean | True when finish_code is NULL and time_ms is not NULL |

**`api_keys`**

| Column | Type | Notes |
|---|---|---|
| `id` | serial PK | |
| `key_hash` | varchar(64) | SHA-256 hex of the raw key — plaintext is never stored |
| `label` | text | Optional human-readable label |
| `created_by` | text | Admin email that generated the key |
| `created_at` | timestamptz | |
| `expires_at` | timestamptz | Always 30 days after creation |

### Views

- **`best_times_career`** — best valid `Fin` time per skater per distance per track type (all time)
- **`best_times_by_season`** — same, partitioned by season

Distance normalization strips round suffixes (`400 (100) Round A` → `400 (100)`) so split-distance rounds are grouped under one distance entry.

---

## Season Calculation

The hockey-style season straddles two calendar years. The rule used throughout the codebase:

- Competition in **October–December** → season starts that calendar year (e.g. Oct 2024 → `2024-2025`)
- Competition in **January–September** → season started the prior year (e.g. Mar 2025 → `2024-2025`)

---

## Adding Historical Data

To load PAT files that pre-date the Eventarc trigger:

```powershell
gcloud storage cp "path\to\file.pat" gs://sassa-odc-assets/uploads/ST/file.pat
```

Replace `ST` with `LT` for long track. The upload triggers the processor automatically. Re-uploading an existing competition merges results rather than replacing them.
