# Niveshaay Deal Pipeline

Internal, login-only deal tracker for Niveshaay's PE team (SEBI Cat II AIF). It replaces the Excel deck tracker. Decks are confidential (NDA).

- **`SPEC.md` is the source of truth.** Where it disagrees with anything else, the spec wins. New features go into SPEC.md first.
- `reference/niveshaay-deal-pipeline-v1.3.html` is the working prototype. Match its look and behaviour unless SPEC.md says otherwise. Its CSS tokens, copy and helper logic (`normCo`, `lev`, `rankNames`, `sorted`, `buildMd`, `exportCols`) are the reference implementation to port.
- `BUILD_PROMPTS.md` is the phase plan (Prompts 1–8). Build one phase at a time and commit at the end of each.

## Stack

| Layer | Choice |
|---|---|
| App | Next.js (App Router), TypeScript `strict`, React Server Components for reads, server actions for mutations, route handlers for files/export/jobs |
| DB | PostgreSQL + Prisma (`prisma/schema.prisma`). Local Postgres via `docker-compose.yml` |
| Auth | Auth.js, Microsoft Entra ID provider, JWT sessions (no adapter tables). Sign-in restricted to `ALLOWED_EMAIL_DOMAIN`. `DEV_LOGIN=true` bypass for local dev only |
| Files | `StorageDriver` interface, `local` disk driver (`STORAGE_DIR`). S3-compatible driver later |
| AI | `@google/genai` with a **paid Gemini API key** (not Vertex), server-only, behind `AiProvider`. Model from `GEMINI_MODEL` |
| PPTX | LibreOffice headless converts PPTX → PDF (installed in the Docker image); slide-text extraction is the fallback when it's missing (e.g. Windows dev) |
| Excel / zip | `exceljs` / `archiver`, in route handlers |
| Validation | `zod` on every input |
| Styling | `src/app/globals.css`: the prototype's stylesheet ported as-is (SPEC §11 tokens as CSS variables, same class names), plus a small "additions" block at the end. IBM Plex Sans + Source Serif 4 via `next/font` |
| Tests | Vitest (unit), Playwright (E2E) |
| Deploy | `Dockerfile` + `docker-compose.prod.yml` (app, Postgres, files volume) |

Package manager: npm.

## Commands

```bash
npm run db:local                # local Postgres on :5433 via embedded-postgres (or: docker compose up -d)
npm install
npx prisma migrate dev          # apply/create migrations (dev)
npm run db:seed                 # sectors + team + 3 sample companies
npm run dev                     # http://localhost:3000 (DEV_LOGIN=true → "Developer login")
npm run lint                    # ESLint
npm run typecheck               # tsc --noEmit
npm test                        # Vitest unit tests
npm run test:e2e                # Playwright (needs dev server, DEV_LOGIN=true and a seeded DB)
npm run verify:export           # checks the Excel export formatting
```

On this Windows machine Node and Git are portable installs in `%LOCALAPPDATA%\Programs\nodejs` and `...\mingit\cmd`; prefix shell commands with `$env:Path="$env:LOCALAPPDATA\Programs\nodejs;$env:LOCALAPPDATA\Programs\mingit\cmd;$env:Path"` if they aren't found.

**Prisma 7:** generator `prisma-client` outputs to `src/generated/prisma` (git-ignored, regenerated on `npm install`); the DB URL lives in `prisma.config.ts`; the client uses the `@prisma/adapter-pg` driver adapter (`src/lib/db.ts`).

**Next 16:** read `node_modules/next/dist/docs/` before using unfamiliar APIs (see `AGENTS.md`). Middleware is now `proxy.ts` (not used here); route `params`/`searchParams` are Promises.

## Folder structure

```
.
├── CLAUDE.md  SPEC.md  BUILD_PROMPTS.md  README.md
├── reference/                      # v1.3 prototype (read only)
├── prisma/                         # schema.prisma, migrations/, seed.ts  (+ prisma.config.ts at root)
├── scripts/                        # dev-db.mjs (local Postgres), verify-export.mjs
├── src/
│   ├── auth.ts                     # Auth.js config: Entra ID + dev login, domain check, User upsert
│   ├── instrumentation.ts          # starts the summary job worker
│   ├── app/
│   │   ├── layout.tsx  page.tsx    # the single dashboard page (server loads everything)
│   │   ├── globals.css             # prototype CSS
│   │   ├── signin/                 # sign-in screen
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
│       ├── storage/                # StorageDriver + LocalDiskDriver (the only fs access)
│       ├── ai/                     # AiProvider (Gemini), prompt, JSON schema, deck prep (PDF/PPTX), DB-backed job worker
│       ├── summary/                # JSON → markdown builder, markdown → safe HTML renderer
│       ├── domain/                 # pure, client-safe: constants, dates, names, view (filter/sort/URL), onedrive, types
│       ├── server/                 # row loading/serialising, audit(), action wrapper, upload sniffing, HTTP errors
│       └── excel/                  # export workbook builder
├── tests/  unit/ e2e/ fixtures/    # fixtures are non-confidential only
├── Dockerfile  docker-compose.yml  docker-compose.prod.yml
└── .env.example
```

## Coding rules

**Security (non-negotiable)**
- Every route handler and server action starts with `requireRole(...)` and parses its input with a zod schema. UI hiding is not enforcement. Roles are Admin (`ADMIN_EMAILS`) and Editor (everyone else on the domain); there is no Viewer role. Admin-only: hard delete, adding sectors.
- `StorageDriver` is the only code that touches the filesystem. No `fs` imports anywhere else (except build/test tooling).
- Uploads: check extension, sniff MIME from bytes, enforce `MAX_UPLOAD_MB`, store under a random key. Serve only through the authorised file routes with `Content-Disposition`.
- OneDrive URLs: only `http:`/`https:`, validated on write and again before rendering. Never render a `javascript:` URL.
- Never log deck text, prompts or AI output. Log ids and error codes only.
- Read env only through `src/lib/env.ts`. Never print, log or commit `.env`.
- AI calls are server-only (`import "server-only"`). Paid Gemini key or Vertex AI, never the free tier.
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
