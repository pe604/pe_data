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
| Styling | CSS variables for the SPEC §11 tokens (`src/styles/tokens.css`), CSS Modules. IBM Plex Sans + Source Serif 4 via `next/font` |
| Tests | Vitest (unit), Playwright (E2E) |
| Deploy | `Dockerfile` + `docker-compose.prod.yml` (app, Postgres, files volume) |

Package manager: npm.

## Commands

```bash
docker compose up -d            # local Postgres
npm install
npx prisma migrate dev          # apply migrations (dev)
npx prisma db seed              # sectors + sample companies
npm run dev                     # http://localhost:3000
npm run lint                    # ESLint
npm run format                  # Prettier
npm run typecheck               # tsc --noEmit
npm test                        # Vitest unit tests
npm run test:e2e                # Playwright (needs DEV_LOGIN=true and a seeded DB)
```

(Scripts are created in Phase 1. Update this section if they change.)

## Folder structure

```
.
├── CLAUDE.md  SPEC.md  BUILD_PROMPTS.md  README.md
├── reference/                      # v1.3 prototype (read only)
├── prisma/
│   ├── schema.prisma
│   ├── migrations/
│   └── seed.ts
├── src/
│   ├── app/
│   │   ├── layout.tsx  page.tsx    # the single dashboard page
│   │   ├── signin/                 # sign-in screen
│   │   └── api/
│   │       ├── auth/[...nextauth]/
│   │       ├── files/              # upload, [id] view/download
│   │       ├── companies/[id]/files.zip/
│   │       ├── summary-jobs/[id]/  # poll status, cancel
│   │       └── export/             # Excel
│   ├── actions/                    # server actions, one file per area (companies, people, comments, files, summaries, team, sectors, exits)
│   ├── components/
│   │   ├── shell/                  # header, tabs
│   │   ├── bars/                   # stages bar, PE team bar, manage modal
│   │   ├── toolbar/                # search, filters, sort
│   │   ├── table/                  # grid + cells
│   │   ├── drawer/                 # company file drawer + tabs
│   │   ├── add-company/            # modal steps
│   │   └── ui/                     # button, popover, modal, toast, chip picker
│   ├── lib/
│   │   ├── auth/                   # auth config, session, requireRole()
│   │   ├── db.ts                   # Prisma client singleton
│   │   ├── env.ts                  # zod-validated env, the only reader of process.env
│   │   ├── storage/                # StorageDriver, local driver, factory
│   │   ├── ai/                     # AiProvider, Gemini provider, prompt, schema, pptx, job runner
│   │   ├── summary/                # JSON → markdown builder
│   │   ├── domain/                 # stages, labels, dates/days, names (normalise, Levenshtein, rankNames), duplicate check, sort, filters, onedrive URL check
│   │   ├── audit.ts                # audit log writer
│   │   ├── upload.ts               # extension + MIME sniff + size checks
│   │   └── excel/                  # export workbook builder
│   ├── styles/                     # tokens.css, globals.css
│   └── instrumentation.ts          # starts the summary job worker
├── tests/
│   ├── unit/                       # Vitest
│   ├── e2e/                        # Playwright
│   └── fixtures/                   # non-confidential sample files only
├── docker-compose.yml  docker-compose.prod.yml  Dockerfile
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
- Every field change, status change, file upload/remove and summary generate/edit writes an `AuditLog` row in the same transaction (`src/lib/audit.ts`).
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
