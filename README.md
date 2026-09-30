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
| `OPENROUTER_API_KEY` | Paid OpenRouter key with credits (see below). Leave blank to run without AI summaries |
| `OPENROUTER_MODEL` | Must read PDFs, e.g. `google/gemini-2.5-flash` (default) or `google/gemini-2.5-pro` |
| `STORAGE_DRIVER` | `local` |
| `STORAGE_DIR` | Where uploaded files are kept, e.g. `./storage` (Docker: `/data/files`) |
| `MAX_UPLOAD_MB` | Default 50 |
| `DEV_LOGIN` | `true` for local development only |
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

## Security checklist (production)

What the app enforces:
- **Sign-in:** Microsoft sign-in only from Niveshaay's own Entra tenant. The issuer must be tenant-specific, and the `tid` claim is checked on every sign-in, so other tenants can't get in by setting an @niveshaay.com email ("nOAuth"). The email domain is re-checked on every request. Sessions last 12 hours.
- **Developer login** is off in production builds, and even in development it only works from `localhost`. `npm run dev` binds to `127.0.0.1`, so the dev server isn't reachable from the network.
- **Admin rights** follow `ADMIN_EMAILS` on every request; removing an email takes effect immediately.
- **Every server action and API route** checks the session and role and validates input with zod.
- **Uploads:** extension allow-list, MIME sniffed from the bytes, size limit checked before the body is read, random storage keys, and served only via authorised routes with `Content-Disposition` and `nosniff`. Staged Add company decks are visible only to their uploader.
- **Headers:** a nonce-based Content-Security-Policy (`src/proxy.ts`), HSTS in production, `X-Frame-Options`, `nosniff`, `Referrer-Policy`, `Cross-Origin-Opener-Policy` / `-Resource-Policy`.
- **Summaries** are rendered with all HTML escaped. OneDrive links must be `http(s)`.
- **AI:** OpenRouter with `data_collection: deny`. Deck text is never logged.
- **Dependencies:** `npm audit` is clean. `overrides` in package.json pin patched `mysql2`, `deepmerge-ts` and `uuid`.

What you need to do:
1. Serve over **HTTPS** only, via a reverse proxy. The compose file publishes the app on `127.0.0.1:3000` for that proxy.
2. Set `AUTH_URL=https://<your-host>` and a fresh random `AUTH_SECRET`. Leave `DEV_LOGIN` unset.
3. Set `AUTH_MICROSOFT_ENTRA_ID_ISSUER` to `https://login.microsoftonline.com/<tenant-id>/v2.0`. The app refuses `/common`.
4. Consider Entra **Assignment required = Yes**, so only the PE team can sign in.
5. Encrypt the disk holding the database and the files volume (e.g. BitLocker or LUKS), and encrypt backups.
6. Rotate the OpenRouter and Evolution API keys if they were ever shared in chat or email, and keep `.env` readable only by the service account.
7. Run `npm audit` before each release.

## Backups

- **Database:** `pg_dump -Fc "$DATABASE_URL" > pipeline-$(date +%F).dump` daily; restore with `pg_restore -d "$DATABASE_URL" --clean pipeline-YYYY-MM-DD.dump`.
  In Docker: `docker compose -f docker-compose.prod.yml exec db pg_dump -U pipeline -Fc pipeline > backup.dump`.
- **Files:** back up the `files` volume (or `STORAGE_DIR`) at the same time, e.g. `docker run --rm -v <project>_files:/data -v $PWD:/backup alpine tar czf /backup/files-$(date +%F).tgz -C /data .`
- The two must be restored together: file rows in the DB point at stored files by random key.
- Keep backups encrypted and access-controlled; they contain NDA material.

## Project layout

See `CLAUDE.md`.
