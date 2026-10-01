# Niveshaay Deal Pipeline

Internal, login-only deal tracker for Niveshaay's PE team (SEBI Cat II AIF). It replaces the Excel deck tracker. Decks are confidential (NDA).

- **`SPEC.md` is the source of truth.** Where it disagrees with anything else, the spec wins. New features go into SPEC.md first.
- `reference/niveshaay-deal-pipeline-v1.3.html` is the working prototype. Match its look and behaviour unless SPEC.md says otherwise. Its CSS tokens, copy and helper logic (`normCo`, `lev`, `rankNames`, `sorted`, `buildMd`, `exportCols`) are the reference implementation to port.
- `BUILD_PROMPTS.md` is the phase plan (Prompts 1–8). Build one phase at a time and commit at the end of each.

## Stack

| Layer | Choice |
|---|---|
| App | Next.js (App Router), TypeScript `strict`, React Server Components for reads, server actions for mutations, route handlers for files/export/jobs |
| DB | PostgreSQL on AWS RDS (`DB_*` in `.env`) + Prisma (`prisma/schema.prisma`). Connection settings built in `src/lib/db-config.ts` (shared by the app, `prisma.config.ts` and scripts); TLS verified against `certs/rds-ap-south-1-bundle.pem`. No local database |
| Auth | **None for now (open access).** `src/lib/auth/session.ts` returns one shared "Team" user (Editor) for every request. A future login replaces only that file. `noindex` header + `robots.txt` keep it out of search engines |
| Files | `StorageDriver` backed by an S3-compatible bucket (`AWS_S3_*`), every object AES-256-GCM encrypted client-side with `STORAGE_ENCRYPTION_KEY` (the bucket is publicly readable, so it must only ever hold ciphertext). No local file storage |
| AI | **OpenRouter** chat completions (fetch, no SDK), server-only, behind `AiProvider` (`src/lib/ai/provider.ts`). Model from `OPENROUTER_MODEL` (default `google/gemini-2.5-pro`). Every request sets `provider.data_collection = "deny"`. The PDF's text layer (`unpdf`) goes with the PDF; `src/lib/summary/verify.ts` checks every financial figure against it, with one corrective retry (`src/lib/ai/summarise.ts`) |
| PPTX | LibreOffice headless converts PPTX → PDF (installed in the Docker image); slide-text extraction is the fallback when it's missing (e.g. Windows dev) |
| Excel / zip | `exceljs` / `archiver`, in route handlers |
| Validation | `zod` on every input |
| Styling | `src/app/globals.css`: the prototype's stylesheet ported as-is (SPEC §11 tokens as CSS variables, same class names), plus a small "additions" block at the end. IBM Plex Sans + Source Serif 4 via `next/font` |
| Tests | Vitest (unit), Playwright (E2E) |
| Deploy | `Dockerfile` on Easypanel (from GitHub, container port 3000), or `docker-compose.prod.yml` (app only) |

Package manager: npm.

## Commands

```bash
npm install
npx prisma migrate deploy       # apply migrations to the configured DB (it holds real deals: never `migrate reset`)
npm run dev                     # http://localhost:3000, uses the RDS database
npm run lint                    # ESLint
npm run typecheck               # tsc --noEmit
npm test                        # Vitest unit tests
npm run test:e2e                # Playwright on :3100 against E2E_DATABASE_URL (a disposable *_test DB, wiped each run); never real data
npx tsx scripts/db-data.mts export|import <file.json>   # move rows between databases
npm run verify:export           # checks the Excel export formatting
```

On this Windows machine Node and Git are portable installs in `%LOCALAPPDATA%\Programs\nodejs` and `...\mingit\cmd`; prefix shell commands with `$env:Path="$env:LOCALAPPDATA\Programs\nodejs;$env:LOCALAPPDATA\Programs\mingit\cmd;$env:Path"` if they aren't found.

**Prisma 7:** generator `prisma-client` outputs to `src/generated/prisma` (git-ignored, regenerated on `npm install`); the DB URL lives in `prisma.config.ts`; the client uses the `@prisma/adapter-pg` driver adapter (`src/lib/db.ts`).

**Next 16:** read `node_modules/next/dist/docs/` before using unfamiliar APIs (see `AGENTS.md`). Middleware is now `proxy.ts`: `src/proxy.ts` sets the nonce-based CSP for pages; route `params`/`searchParams` are Promises.

## Folder structure

```
.
├── CLAUDE.md  SPEC.md  BUILD_PROMPTS.md  README.md
├── reference/                      # v1.3 prototype (read only)
├── prisma/                         # schema.prisma, migrations/, seed.ts  (+ prisma.config.ts at root)
├── certs/                          # public AWS RDS CA bundle (DB_SSL=verify-full)
├── scripts/                        # db-data.mts (export/import rows), check-storage.mts, verify-export.mjs, try-summary.mts
├── src/
│   ├── instrumentation.ts          # starts the summary job worker
│   ├── app/
│   │   ├── layout.tsx  page.tsx    # the single dashboard page (server loads everything)
│   │   ├── globals.css             # prototype CSS
│   │   └── api/
│   │       ├── auth/[...nextauth]/
│   │       ├── files/              # POST upload (staged or attached); [id] GET view/download
│   │       ├── companies/[id]/download-all/  # zip grouped Deck/ Model/ Other/
│   │       └── export/             # Excel
│   ├── actions/                    # server actions: companies.ts, files.ts (files + summaries), misc.ts (comments, team, sectors), auth.ts
│   ├── components/
│   │   ├── Dashboard.tsx store.tsx # client state, optimistic mutate() with rollback, URL sync
│   │   ├── shell/ bars/ toolbar/ table/ cells/ drawer/ add/ ui/
│   ├── generated/prisma/           # Prisma client (generated, git-ignored)
│   └── lib/
│       ├── auth/session.ts         # currentUser(), requireRole()
│       ├── db.ts  env.ts           # Prisma client; zod-validated env (the only reader of process.env)
│       ├── db-config.ts            # DB_* → connection URL + SSL/CA + schema (pure; also used by prisma.config.ts)
│       ├── storage/                # StorageDriver (S3 + encryption), crypto.ts, tmp.ts (OS temp dir for LibreOffice only)
│       ├── ai/                     # AiProvider (OpenRouter), prompt, JSON schema, deck prep (PDF/PPTX), DB-backed job worker
│       ├── summary/                # JSON → markdown builder, markdown → safe HTML renderer
│       ├── whatsapp/               # Evolution API client + intake poller (SPEC §14); pure matching in domain/whatsapp.ts
│       ├── domain/                 # pure, client-safe: constants, dates, names, view (filter/sort/URL), onedrive, types
│       ├── server/                 # row loading/serialising, audit(), action wrapper, upload sniffing, HTTP errors
│       └── excel/                  # export workbook builder
├── tests/  unit/ e2e/ fixtures/    # fixtures are non-confidential only
├── Dockerfile  docker-compose.prod.yml
└── .env.example
```

## Coding rules

**Security (non-negotiable)**
- Every route handler and server action starts with `requireRole(...)` and parses its input with a zod schema. UI hiding is not enforcement. Roles are Admin and Editor; there is no Viewer role. Admin-only: adding sectors. Permanent delete is open to Editors (logged in `DeletionLog`). With no login yet, every visitor is the shared Editor "Team" user; keep the `requireRole()` calls so a login can be added in one place.
- `StorageDriver` (`src/lib/storage`) is the only code that stores or reads files, and the only `fs` use (a temp dir for LibreOffice). Never upload unencrypted bytes, never link to bucket URLs; serve files only via the authorised routes.
- Uploads: check extension, sniff MIME from bytes, enforce `MAX_UPLOAD_MB`, store under a random key. Serve only through the authorised file routes with `Content-Disposition`.
- OneDrive URLs: only `http:`/`https:`, validated on write and again before rendering. Never render a `javascript:` URL.
- Never log deck text, prompts or AI output. Log ids and error codes only.
- Read env only through `src/lib/env.ts`. Never print, log or commit `.env`.
- AI calls are server-only (`import "server-only"`). Paid OpenRouter key, `data_collection: "deny"`, never `:free` models. Try the prompt on a local deck with `npx tsx --conditions=react-server scripts/try-summary.mts <deck>`.
- Rendered markdown (summaries) goes through a renderer with raw HTML disabled.

**Data**
- Every field change, status change, file upload/remove and summary generate/edit writes an `AuditLog` row in the same transaction (`audit()` in `src/lib/server/company.ts`).
- Server actions return `ActionResult` via `run()` (`src/lib/server/action.ts`); throw `UserError` for messages the user should see. The client applies changes through `store.mutate()` so failures roll back with a toast.
- "Today" and day counts use the Asia/Kolkata calendar date, not the server's timezone. Date maths lives in `src/lib/domain/dates.ts` and is unit-tested.
- Days = today − dateReceived, frozen at exitAt for Rejected/Invested, "–" when no date.
- Auto stage rule (SPEC §7.5) is applied server-side whenever PE/Research changes.

**TypeScript**
- `strict: true`, no `any`, no non-null `!` without a comment saying why.
- Share types from Prisma and zod (`z.infer`); don't hand-write duplicates.
- Pure domain logic in `src/lib/domain` with no React or Prisma imports, so it can be unit-tested.

**UI**
- Sentence case everywhere. No em dashes in UI copy (use a comma, colon or en dash in ranges like "FY24–26").
- Colours only via the CSS variables from SPEC §11. Light and dark via `prefers-color-scheme`.
- Tabular numerals for figures. 16px gutters on phones. Respect `prefers-reduced-motion`. Visible keyboard focus.
- Optimistic updates with rollback and a toast on failure.
- Copy for messages and empty states: reuse the prototype's wording where it exists.

**Process**
- One phase per prompt, commit at the end of each phase. Don't start the next phase unasked.
- If the spec is ambiguous, check the prototype. If still unclear, ask rather than guess.
