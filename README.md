# Niveshaay Deal Pipeline

Internal deal tracker for Niveshaay's PE team. It replaces the Excel deck tracker. `SPEC.md` is the source of truth; `reference/` holds the v1.3 prototype.

> **No login yet.** For now anyone with the URL can open and edit the dashboard (everyone acts as a shared "Team" user; admin actions such as permanent delete are off). Search engines are told not to index it. Don't share the URL outside the team until a login is added (see `src/lib/auth/session.ts`).

## Local setup

Requirements: Node.js 22+. There is no local database: the app uses the Postgres server in `DB_*` (AWS RDS).

```bash
npm install
cp .env.example .env          # fill in, see "Environment variables"
npx prisma migrate deploy     # create/update tables on the configured database (the app's Docker image does this on start)
npm run dev                   # http://localhost:3000
```

Your IP must be allowed in the RDS security group to connect from your machine.

### Checks

```bash
npm run typecheck
npm run lint
npm test                      # unit tests (dates, names, markdown, sorting)
npm run test:e2e              # Playwright on :3100; needs E2E_DATABASE_URL = an empty, disposable DB named *_test (wiped every run; refuses the real DB)
npm run verify:export         # downloads the Excel export from the running dev server and checks its formatting (read-only)
```

## Environment variables

| Variable | Notes |
|---|---|
| `DB_HOST`, `DB_PORT`, `DB_USER`, `DB_PASS`, `DB_NAME` | Postgres server (AWS RDS). `DB_PORT` defaults to 5432. A single `DATABASE_URL` also works when `DB_HOST` is unset |
| `DB_SSL` | `verify-full` (default: TLS, certificate checked against `DB_SSL_CA`), `require` (TLS, no certificate check) or `disable` |
| `DB_SSL_CA` | CA bundle for `verify-full`. Default `certs/rds-ap-south-1-bundle.pem` (public AWS RDS Mumbai CA, shipped in the repo and image) |
| `DB_SCHEMA` | Optional Postgres schema (default `public`) |
| `OPENROUTER_API_KEY` | Paid OpenRouter key with credits (see below). Leave blank to run without AI summaries |
| `OPENROUTER_MODEL` | Must read PDFs, e.g. `google/gemini-2.5-flash` (default) or `google/gemini-2.5-pro` |
| `AWS_S3_ENDPOINT_URL`, `AWS_S3_BUCKET_NAME`, `AWS_S3_FOLDER`, `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY` | S3-compatible bucket for uploaded files (`AWS_REGION` optional, default `us-east-1`) |
| `STORAGE_ENCRYPTION_KEY` | 32 random bytes, base64 (`openssl rand -base64 32`). Every file is encrypted with it before upload. **Back it up**: without it, stored decks can't be read |
| `STORAGE_NAMESPACE` | Optional sub-folder inside `AWS_S3_FOLDER` (default `files`; E2E tests use `e2e-tests`) |
| `MAX_UPLOAD_MB` | Default 50 |
| `SOFFICE_PATH` | Optional path to LibreOffice `soffice` if it isn't on PATH |
| `EVOLUTION_API_URL`, `EVOLUTION_API_KEY`, `EVOLUTION_INSTANCE` | Evolution API v2 instance used for WhatsApp deck intake (SPEC §14). Blank = off |
| `EVOLUTION_Receiver` | The WhatsApp group JID (`…@g.us`) to watch and reply in |
| `WHATSAPP_POLL_SECONDS` | How often to check the group (default 60) |

**WhatsApp intake:** the app polls the group while it's running (it does not change the instance's existing webhook). A PDF/PPTX shared in the group becomes a Pipeline company dated the day it was sent, with Via = the sender or the person named after "from"/"via" in the caption or a nearby message, and the bot replies in the group. Senders are matched to team members by first name the first time, then by phone number.

If a value contains `#`, wrap it in quotes (`'...'`), otherwise everything after the `#` is treated as a comment.

## AI summaries: OpenRouter

Decks are received under NDA, so:

- Use a **paid** OpenRouter key with credits, and never a `:free` model (free models may log or train on prompts).
- Every request sets `provider.data_collection = "deny"`, so OpenRouter only routes to providers that don't store or train on data. `require_parameters` keeps it on providers that support the strict JSON schema.
- In the OpenRouter account's **Settings → Privacy**, turn off prompt logging / "allow training" as well.
- PDFs are sent natively (the `file-parser` plugin, `native` engine), so charts and scanned pages are read.
- Deck text and model output are never logged.
- Try the prompt on a local deck without storing anything: `npx tsx --conditions=react-server scripts/try-summary.mts path/to/deck.pdf`.
- Watch the key's spending limit on openrouter.ai; when credits run out, summaries fail with a "top up" message and decks are still saved.

## Production (Docker)

```bash
cp .env.example .env.production   # fill in (DB_*, AWS_S3_*, STORAGE_ENCRYPTION_KEY, ...)
docker compose -f docker-compose.prod.yml --env-file .env.production up -d --build
curl -fsS http://127.0.0.1:3000/api/health   # {"ok":true} once it is up
```

- **The app listens on port 3000** inside the container.
- The app applies migrations on start (`prisma migrate deploy`) and adds the sector list if it's missing. No seed step, and no sample data. If migrations fail (e.g. the DB user can't create tables), the container exits and the proxy shows **502**: check the logs.
- `GET /api/health` is a public up/down probe for the host (the Docker image's HEALTHCHECK uses it).
- Run a single replica: summary jobs and WhatsApp polling are safe with more, but there's no need.
- The image includes LibreOffice so PowerPoint decks are converted to PDF before summarising. Without it, only slide text is used.
- Put it behind HTTPS (reverse proxy such as Caddy, nginx or IIS/ARR).
- Uploaded files live in the S3 bucket (encrypted); the data in the RDS database. No volumes are needed.

### Easypanel (deploy from GitHub)

1. The repository holds no secrets; all of them go in Easypanel's environment settings.
2. Create an **App** service:
   - Source: GitHub → this repo, branch `main`. Build: **Dockerfile** (path `Dockerfile`).
   - **Environment:** every variable in `.env.example`: `DB_*`, `AWS_S3_*`, `STORAGE_ENCRYPTION_KEY` (the **same** value as before, or existing files can't be read), `OPENROUTER_API_KEY`, and the `EVOLUTION_*` values. No Postgres service is needed.
   - **Mounts:** none.
   - **Domains:** add your domain, **port 3000**, HTTPS on (Easypanel issues the certificate). Ports 80/8000 give 502: nothing listens there.
   - Replicas: 1.
3. In AWS, allow the Easypanel server's IP in the RDS security group (port 5432).
4. Deploy. The container applies database migrations and adds the sector list on start. Check `https://<your-domain>/api/health` shows `{"ok":true}`.

### Database user rights (AWS RDS)

The first deploy creates the tables, so the `DB_USER` needs to be able to create them. As the RDS master user:

```sql
GRANT USAGE, CREATE ON SCHEMA public TO <DB_USER>;
-- or a dedicated schema: CREATE SCHEMA pipeline AUTHORIZATION <DB_USER>;  then set DB_SCHEMA=pipeline
```

To move existing rows from another database: `npx tsx scripts/db-data.mts export data.json --from <old-url>`, then (after `npx prisma migrate deploy` on the new one) `npx tsx scripts/db-data.mts import data.json`. The import refuses a database that already has companies. Delete the JSON afterwards.

## Security checklist (production)

What the app enforces:
- **No login (temporary, by decision).** Anyone with the URL can view and edit. Everyone acts as the shared Editor "Team" user, so permanent delete and adding sectors are unavailable. `X-Robots-Tag: noindex` and `robots.txt` keep the site out of search engines. `npm run dev` binds to `127.0.0.1`.
- **Every server action and API route** calls `requireRole()` and validates input with zod, so a login can be added in `src/lib/auth/session.ts` without touching the routes.
- **Uploads:** extension allow-list, MIME sniffed from the bytes, size limit checked before the body is read, random storage keys, and served only via the app's routes with `Content-Disposition` and `nosniff`.
- **Headers:** a nonce-based Content-Security-Policy (`src/proxy.ts`), HSTS in production, `X-Frame-Options`, `nosniff`, `Referrer-Policy`, `Cross-Origin-Opener-Policy` / `-Resource-Policy`.
- **Summaries** are rendered with all HTML escaped. OneDrive links must be `http(s)`.
- **AI:** OpenRouter with `data_collection: deny`. Deck text is never logged.
- **Dependencies:** `npm audit` is clean. `overrides` in package.json pin patched `mysql2`, `deepmerge-ts` and `uuid`.

What you need to do:
1. Serve over **HTTPS** only, via a reverse proxy. The compose file publishes the app on `127.0.0.1:3000` for that proxy.
2. **Add a login before sharing the URL widely.** Until then, share it only inside the team. Optionally restrict access at the proxy (Easypanel → Domains → Basic auth, or an IP allow-list).
3. Keep RDS storage encryption on, keep `DB_SSL=verify-full`, restrict the RDS security group to the app server's IP, and encrypt backups. **Make the S3 bucket (or at least `AWS_S3_FOLDER`) private.** Files are encrypted, but a public bucket still reveals how many files exist and when.
4. Rotate the OpenRouter and Evolution API keys if they were ever shared in chat or email, and keep `.env` readable only by the service account.
5. Run `npm audit` before each release.

## Backups

- **Database:** turn on RDS automated backups (and snapshots before big changes). For a manual copy: `pg_dump -Fc "host=$DB_HOST user=$DB_USER dbname=$DB_NAME sslmode=require" > pipeline-$(date +%F).dump`.
- **Files:** they live in the S3 bucket under `AWS_S3_FOLDER/files/`. Use the bucket provider's versioning or replication, and keep `STORAGE_ENCRYPTION_KEY` safe (a password manager or vault): the files are useless without it.
- The two must be restored together: file rows in the DB point at stored files by random key.
- Keep backups encrypted and access-controlled; they contain NDA material.

## Project layout

See `CLAUDE.md`.
