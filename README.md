# Niveshaay Deal Pipeline

Internal, login-only deal tracker for Niveshaay's PE team. It replaces the Excel deck tracker. `SPEC.md` is the source of truth; `reference/` holds the v1.3 prototype.

## Local setup

Requirements: Node.js 22+. Docker is optional.

```bash
npm install
cp .env.example .env          # fill in, see "Environment variables"
npm run db:local              # terminal 1: local Postgres on :5433 (no Docker or admin rights needed)
                              #   or: docker compose up -d
npx prisma migrate deploy     # create tables
npm run db:seed               # sectors, a small team, 3 sample companies
npm run dev                   # terminal 2: http://localhost:3000
```

With `DEV_LOGIN=true` the sign-in page shows **Developer login**, which signs you in as the first address in `ADMIN_EMAILS`. It is ignored in production builds.

### Checks

```bash
npm run typecheck
npm run lint
npm test                      # unit tests (dates, names, markdown, sorting)
npm run test:e2e              # Playwright; needs the dev server, a seeded DB and DEV_LOGIN=true
npm run verify:export         # downloads the Excel export and checks its formatting
```

## Environment variables

| Variable | Notes |
|---|---|
| `DATABASE_URL` | Postgres connection string. Local: `postgresql://postgres:postgres@localhost:5433/pipeline` |
| `AUTH_SECRET` | Random 32+ bytes, e.g. `openssl rand -base64 32` |
| `AUTH_MICROSOFT_ENTRA_ID_ID` | Application (client) ID of the Entra app registration |
| `AUTH_MICROSOFT_ENTRA_ID_SECRET` | Client secret value |
| `AUTH_MICROSOFT_ENTRA_ID_ISSUER` | `https://login.microsoftonline.com/<tenant-id>/v2.0` (single tenant) |
| `ALLOWED_EMAIL_DOMAIN` | `niveshaay.com`. Other domains and guest (#EXT#) accounts are refused |
| `ADMIN_EMAILS` | Comma list. Admins can hard-delete and add sectors; everyone else is an Editor |
| `GEMINI_API_KEY` | **Paid-tier** key only (see below). Leave blank to run without AI summaries |
| `GEMINI_MODEL` | e.g. `gemini-2.5-pro` or `gemini-2.5-flash` (default when blank: `gemini-2.5-flash`) |
| `STORAGE_DRIVER` | `local` |
| `STORAGE_DIR` | Where uploaded files are kept, e.g. `./storage` (Docker: `/data/files`) |
| `MAX_UPLOAD_MB` | Default 50 |
| `DEV_LOGIN` | `true` for local development only |
| `SOFFICE_PATH` | Optional path to LibreOffice `soffice` if it isn't on PATH |

If a value contains `#`, wrap it in quotes (`'...'`), otherwise everything after the `#` is treated as a comment.

## Gemini: paid tier only

Decks are received under NDA. Google's **free tier** allows prompts and files to be used to improve its products. The **paid tier** does not use your data for training. Create the key in a Google Cloud project **with billing enabled** (AI Studio → API keys → a key on a billed project), and confirm it shows "Paid" / "Tier 1" in AI Studio before adding it here.

- Deck text and model output are never logged.
- Decks over ~20 MB go through the Gemini Files API and are deleted right after the call.
- Vertex AI (with India-region processing) can be added later behind `AiProvider` (`src/lib/ai/provider.ts`).

## Microsoft Entra ID app registration (for IT, about 10 minutes)

1. Entra admin centre → **App registrations** → **New registration**.
   - Name: `Niveshaay Deal Pipeline`
   - Supported account types: **Accounts in this organizational directory only** (single tenant)
   - Redirect URI (Web): `https://<your-host>/api/auth/callback/microsoft-entra-id` (add `http://localhost:3000/api/auth/callback/microsoft-entra-id` for testing)
2. Copy **Application (client) ID** → `AUTH_MICROSOFT_ENTRA_ID_ID`, and **Directory (tenant) ID** → use it in `AUTH_MICROSOFT_ENTRA_ID_ISSUER`.
3. **Certificates & secrets** → New client secret → copy the value → `AUTH_MICROSOFT_ENTRA_ID_SECRET`. Note the expiry date.
4. **API permissions**: Microsoft Graph delegated `openid`, `profile`, `email`, `User.Read` (defaults). Grant admin consent.
5. Optional, recommended later: Enterprise applications → the app → Properties → **Assignment required = Yes**, then assign the PE team, so only they can sign in.

## Production (Docker)

```bash
cp .env.example .env.production   # fill in; also set POSTGRES_PASSWORD (and optionally POSTGRES_USER / POSTGRES_DB)
docker compose -f docker-compose.prod.yml --env-file .env.production up -d --build
docker compose -f docker-compose.prod.yml exec app node node_modules/prisma/build/index.js db seed   # first run only, optional
```

- The app runs migrations on start (`prisma migrate deploy`).
- The image includes LibreOffice so PowerPoint decks are converted to PDF before summarising. Without it, only slide text is used.
- Put it behind HTTPS (reverse proxy such as Caddy, nginx or IIS/ARR). Auth cookies are secure in production.
- Uploaded files live in the `files` volume; the database in `pgdata`.

### Using an existing Postgres (e.g. AWS RDS)

Point `DATABASE_URL` at it and remove the `db` service. The database user needs to create tables the first time:

```sql
GRANT USAGE, CREATE ON SCHEMA public TO <app_user>;
-- or create a dedicated schema owned by the app user and add ?schema=<name> to DATABASE_URL
```

For RDS over SSL add `?sslmode=require` to `DATABASE_URL`.

## Backups

- **Database:** `pg_dump -Fc "$DATABASE_URL" > pipeline-$(date +%F).dump` daily; restore with `pg_restore -d "$DATABASE_URL" --clean pipeline-YYYY-MM-DD.dump`.
  In Docker: `docker compose -f docker-compose.prod.yml exec db pg_dump -U pipeline -Fc pipeline > backup.dump`.
- **Files:** back up the `files` volume (or `STORAGE_DIR`) at the same time, e.g. `docker run --rm -v <project>_files:/data -v $PWD:/backup alpine tar czf /backup/files-$(date +%F).tgz -C /data .`
- The two must be restored together: file rows in the DB point at stored files by random key.
- Keep backups encrypted and access-controlled; they contain NDA material.

## Project layout

See `CLAUDE.md`.
