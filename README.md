# Clovis Star Static Rebuild

Static, non-WordPress rebuild for Clovis Star with a cleaned book corpus, side-by-side comparison reader, member research tools, and a production-oriented Node/MySQL runtime.

## Run Locally

```powershell
cd "C:\Users\disru\Documents\Codex\2026-06-16\i-have-a-wordpress-site-at\clovisstar-static"
npm install
npm run ingest
npm run serve
```

Open `http://127.0.0.1:4173`.

`npm run serve` starts the account-backed Node server. Use that for registration, sign-in, admin tools, member preferences, and saved profile highlights.

## Build Data

```powershell
npm run ingest
```

The importer reads from:

`C:\Users\disru\Documents\wordpress plugins\HTML Projects\newJSON\all books combined`

It writes:

- `data/books-index.json`
- `data/books/*.json`
- `data/cleanup-report.json`
- `data/admin-settings.json`
- `data/collections.json`
- `data/review-queue.json`
- `data/site-statistics.json`

To inspect the full import without writing files:

```powershell
node scripts/ingest-books.js --audit
```

Windows one-command import and run:

```powershell
powershell -ExecutionPolicy Bypass -File .\IMPORT_ALL_BOOKS_AND_RUN.ps1
```

## Runtime And Storage

Production should use MySQL storage with server-managed cookie sessions.

For production MySQL storage, create a local `.env` from `.env.example`, fill in the password privately, then run:

```powershell
npm install
npm run db:init
npm run verify
npm run serve
```

Do not commit `.env`.

Verification:

```powershell
npm run audit:content:check
npm run test
npm run verify
```

Linux host operations:

```sh
npm run prod:start
npm run prod:status
npm run prod:stop
npm run prod:install-service
npm run prod:install-schedules
```

Production maintenance:

```sh
npm run db:maintain
npm run db:optimize
npm run logs:maintain
npm run smoke:live
```

`prod:install-service` installs a user-level systemd service named `clovisstar-static.service`.
`prod:install-schedules` installs cron jobs for daily database cleanup, weekly table optimization, log maintenance, and six-hour smoke tests.

Session behavior:

- sessions are server-managed with HttpOnly cookies
- authenticated write routes require a CSRF header backed by the signed session
- production mode requires `CLOVIS_STORAGE=mysql`
- public sign-ups default to `member`; use `CLOVIS_ADMIN_EMAILS` or the promotion script for admin access
- local JSON storage is for development only

Or use the prompt-based starter, which does not save the database password to disk:

```powershell
powershell -ExecutionPolicy Bypass -File .\START_WITH_MYSQL.ps1
```

For local development only, leave `NODE_ENV` unset and `CLOVIS_STORAGE` unset. The runtime will use JSON files under `db/`.

For isolated testing or alternate content roots, the server also accepts:

- `CLOVISSTAR_DATA_DIR`
- `CLOVISSTAR_DB_DIR`

## Migration And Auditing

Move local JSON-backed account data into MySQL:

```powershell
npm run db:init
npm run db:migrate-json
```

Promote an existing account to admin:

```powershell
npm run admin:promote -- user@example.com
```

Run the content integrity audit:

```powershell
npm run audit:content
```

Verification mode without writing files:

```powershell
npm run audit:content:check
```

Development JSON files:

- `db/users.json`
- `db/sessions.json`
- `db/highlights.json`
- `db/global-settings.json`
- `db/member-preferences.json`
- `db/book-overrides.json`
- `db/review-queue.json`
- `db/admin-audit-log.json`

## Third-Party Catalog API

Admins can enable API access for a member from the admin user list. After access is enabled, the member can create or rotate one active token from `/members/`.

Partner requests use a bearer token:

```txt
Authorization: Bearer YOUR_TOKEN
```

Public API routes:

- `GET /api/v1/catalog`
- `GET /api/v1/collections`
- `GET /api/v1/books/{slug}`
- `GET /api/v1/openapi.json`

The browser API supports CORS preflight for approved token-based integrations. Private books are never returned by the public API.

## Notes

- Public/private book status comes from canonical `data/` plus backend overrides.
- Member preferences are stored separately from global admin settings.
- Admin writes are logged in the backend audit log.
- Static hosting by itself cannot support sign-in, highlights, or admin persistence. Use the Node server runtime for production behavior.
- Completion of genuinely incomplete books requires a verified source text. The importer flags incomplete/suspect records but does not fabricate missing sacred or historical text.

