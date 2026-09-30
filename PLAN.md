# Build plan (Prompt 0)

Status: **Phases 1–8 built 2026-09-28.** Outstanding: the two sample decks to tune the prompt (Prompt 6 check), Entra ID app registration, and CREATE rights on the RDS database (see README). Decisions marked **Proposed** are what I'll do unless you say otherwise.

## Phases

| # | Phase | Delivers | Done when |
|---|---|---|---|
| 1 | Foundation | Next.js + TS strict, ESLint, Prettier, Vitest. `docker-compose.yml` (Postgres). Prisma schema + first migration (incl. `CHECK` on priority) + seed (18 sectors, a few TeamMembers, 3 companies, one per status). `env.ts` (zod). Auth.js + Entra ID, domain check, roles, `DEV_LOGIN`. `requireRole()`. Tokens, fonts, header, tabs with live counts | `npm run dev` → sign in with DEV_LOGIN → see the shell with counts 1/1/1 |
| 2 | Table | 11 columns, pinned Company column, sticky header, serial numbers, inline edits (stage, priority, date, sector/sub-sector), chip pickers with fuzzy autofill + "Add X", auto stage rule, Days colours/freeze, Rejected/Invested variants, AuditLog on every write, optimistic updates + rollback toast. Unit tests: dates/days, `rankNames`, Levenshtein | Every cell edit persists, shows in History data, and rolls back on a forced server error |
| 3 | Filters, sort, bars | Search, 8 filter popovers + badges + Clear all, sort dropdown + header sort, Stages bar, PE team bar with cross-filter counts, Manage modal (drag, ↑↓, remove, add, "Last changed by"), state in URL | A shared URL reproduces the view; bar counts match the spec's cross-filter rule |
| 4 | Storage, drawer, exits | `StorageDriver` + local driver, upload/view/download/zip routes, drawer (header, meta, notes, Materials, Comments, History, Summary placeholder), Reject/Invest+Undo/Restore/Delete | Files round-trip; delete removes DB rows and stored files; DeletionLog written |
| 5 | Add company | Modal: Pipeline/Invested switch, drop zone, name-only path, bulk Invested, processing step (AI stubbed), review step, save rules, duplicate detection | All three add paths work; duplicates offer "Add deck to X" / "Open X" |
| 6 | AI summary | `AiProvider` + Gemini, PDF inline/Files API, PPTX path, JSON schema + zod + one retry, prompt rules, markdown builder (unit-tested), DB-backed job worker with cancel, versions + edited protection + banner, field update rules, triggers, Summary tab | Both sample decks pass the Prompt 6 checklist |
| 7 | OneDrive + Excel | OneDrive cell/popover/drawer link + filter; `exceljs` export per §12 | Script-verified export: fonts, fills, headers, freeze C4, autofilter, hyperlinks |
| 8 | Hardening + deploy | Route audit, security pass, Playwright suite, mobile/dark/focus checks, Dockerfile, `docker-compose.prod.yml`, README (setup, env, Entra app registration, backups) | All tests green in CI-like run from a clean checkout |

## Key design decisions (Proposed)

1. **Data loading.** The dashboard loads every company (all three statuses, with people, latest comment, counts) in one server query, and filters, sorts and counts on the client. At a few hundred to a few thousand rows this is instant and makes the cross-filtered bar counts trivial. Revisit only if the pipeline passes ~5,000 companies.
2. **Auth sessions.** JWT sessions, no adapter tables. The `User` row is upserted on sign-in. `requireRole()` reads the role from the DB on every call, so a role change takes effect without re-login.
3. **Summary jobs.** A `SummaryJob` table plus an in-process worker started from `instrumentation.ts` (self-hosted Node, so no serverless limits). Jobs are claimed with `FOR UPDATE SKIP LOCKED`, and a heartbeat lets a restarted server pick up stalled jobs. The UI polls `GET /api/summary-jobs/:id`. Cancel sets `CANCELLED` and aborts the SDK call. A Summary version is only created on success, so failed or cancelled runs don't burn version numbers.
4. **Case-insensitive TeamMember names** via a normalised `nameKey @unique` column instead of the `citext` extension (simpler to move between servers).
5. **Sector is a foreign key** to `Sector`, not free text, so renaming a sector later is one row.
6. **Summary keeps `sourceFileName`** so "Version N, from <file>" still reads after the file is removed.
7. **Styling.** CSS Modules + the prototype's CSS variables ported almost verbatim, rather than Tailwind. The prototype is already fully tokenised and porting it is the fastest route to matching the look.
8. **Timezone.** All "today" logic uses Asia/Kolkata, whatever the server's timezone.

## Ambiguities and risks

Items marked **need your answer** block a phase. The rest have a proposed default.

### Decided (2026-09-28)

- **A1. No Viewer role.** Everyone who signs in on the domain is an Editor; `ADMIN_EMAILS` are Admins. SPEC §3 and the `Role` enum updated.
- **A2. Access for the whole domain stays as specced for the prototype.** Tightening (Entra "assignment required" or an allow-list) is deferred to a later phase.
- **A3. Paid Gemini API key**, not Vertex AI. No extra env vars. Vertex can still be added later behind `AiProvider`.
- **A4. LibreOffice is included** in the prod Docker image. Slide-text extraction stays as the fallback where it's missing (e.g. Windows dev).
- **R5. Renaming.** A company can always be renamed after adding (click the name in the drawer header, SPEC §10.1). A later deck upload never overwrites a name that's already set.

### Proposed defaults (say if you disagree)

- **R1. Restore when dateReceived is blank.** §10.3 says the counter "resumes from … today if it was blank". **Proposed:** Restore sets `dateReceived = today` when it is blank, and logs it.
- **R2. Invest Undo** = a Restore without the toast, logged as "Undid invest". It works while the toast is showing (7s, as in the prototype).
- **R3. Staged uploads.** In Add company the deck is uploaded and summarised *before* the company exists, so `File.companyId` and `SummaryJob.companyId` are nullable. A staged file is attached on save and deleted if the modal is cancelled. An hourly sweep deletes staged files older than 24 h (covers closed tabs). This deviates slightly from §4, where File.companyId is required.
- **R4. Duplicate matches are a warning, not a block.** Levenshtein ≤1 on 5+ characters will sometimes flag different companies (e.g. "Zepto" / "Zepta"), so "Add to pipeline" stays enabled alongside "Add deck to X" / "Open X", as in the prototype.
- **R6. Sorting edge cases.**
  - Companies with no date sort last in both directions for Date and Days.
  - In Rejected/Invested, Stage sort uses the exit stage, with "Added directly" last.
  - Sector sort puts blanks last.
- **R7. Search scope.** Search covers all comments (not only the latest), and the current `rejectReason` (not older rejections from before a restore). Matching is case-insensitive substring.
- **R8. Sector list management.** §3 says admins "manage the sector master list", but only "Add a new sector…" is specified. **Proposed:** add only. No rename, reorder or delete in v1 ("Other" stays last).
- **R9. Removing a PE team member in Manage** only clears `peRank`. The person stays in the TeamMember list and on existing assignments. There is no way to delete a TeamMember in v1.
- **R10. Concurrent edits** are last-write-wins per field. Two people editing the same cell at once is rare in a small team. The audit log shows both changes.
- **R11. Upload size vs body limits.** `MAX_UPLOAD_MB=50` needs uploads to go through a route handler (not a server action, which defaults to a 1 MB body), with the Next.js body limit raised to match. Decks over ~20 MB use the Gemini Files API. Those files are deleted right after the call rather than left for the 48 h default.
- **R12. Entra ID sign-in details.**
  - Use a single-tenant issuer (`…/<tenant-id>/v2.0`) so other tenants can't sign in at all.
  - Check the domain against `email`, falling back to `preferred_username`, since some M365 accounts have no `email` claim.
  - Reject guest (#EXT#) accounts.
- **R13. Word limit.** "Under about 220 words" is a prompt rule, not a validation failure. Over-length output is accepted rather than retried (retry is reserved for schema failures). The Prompt 6 deck check covers it.
- **R14. Markdown rendering.** Edited summaries are user-supplied markdown, so they are rendered with raw HTML disabled (no XSS). The Snapshot key–value grid is recognised from the builder's own format, as in the prototype.
- **R16. Prisma version.** Prisma 7 moves the datasource URL into `prisma.config.ts`. Phase 1 will pin the installed version and adjust the `datasource` block if needed.
