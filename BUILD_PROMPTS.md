# Claude Code prompts: Niveshaay Deal Pipeline rebuild

Setup:
1. Create an empty project folder.
2. Put `SPEC.md` in its root.
3. Create a `reference/` folder and put `niveshaay-deal-pipeline-v1.3.html` in it.
4. Open the folder in Antigravity and start Claude Code there.

Run the prompts in order. Paste one, let it finish, test it, then move on. Each phase ends with a commit, so a bad phase can be rolled back.

---

## Prompt 0: Plan (no code)

```
Read SPEC.md end to end and open reference/niveshaay-deal-pipeline-v1.3.html to see the working prototype we are replacing. SPEC.md is the source of truth; the HTML shows the intended look and behaviour.

Do not write code yet. Produce:
1. A CLAUDE.md for this repo: stack, folder structure, commands, coding rules (TypeScript strict, zod on every route, role checks server-side, StorageDriver is the only thing that touches files, no em dashes in UI copy, sentence case).
2. The folder structure you'll use.
3. The full Prisma schema.
4. A phase plan matching Prompts 1–8 below, with anything in the spec you think is ambiguous or risky.

Stop and wait for my approval.
```

---

## Prompt 1: Foundation

```
Build Phase 1 from SPEC.md:
- Next.js (App Router, TypeScript strict) project, ESLint, Prettier.
- docker-compose.yml with Postgres for local dev; .env.example with every env var in SPEC §2.
- Prisma schema from SPEC §4 (as approved), first migration, and a seed script: the sector list from SPEC §8 and 3 sample companies (one per status) so the UI has data.
- Auth.js with the Microsoft Entra ID provider, sign-in restricted to ALLOWED_EMAIL_DOMAIN, roles from SPEC §3 (ADMIN_EMAILS → Admin, others → Editor). Add a DEV_LOGIN=true bypass for local dev only that signs in as a fake admin.
- A requireRole() helper used by every server action / route handler.
- The design tokens from SPEC §11 as CSS variables with light and dark themes, IBM Plex Sans + Source Serif 4.
- The page shell: header with wordmark, "Export to Excel" and "Add company" buttons (not wired yet), and the three tabs with live counts.

Run the app, confirm sign-in works with DEV_LOGIN, then commit.
```

---

## Prompt 2: The table

```
Build Phase 2: the main table exactly as SPEC §6.1, reading from the database.
- All 11 columns in order, Company column pinned left, sticky header, horizontal scroll.
- Serial number in front of the company name that follows the current view (renumbers after sort/filter).
- Inline editing: Stage dropdown (any stage, skipping allowed), Priority dropdown with the P1–P5 styling, Date popover, Sector & sub-sector popover (sector from master list).
- Assigned PE / Research / Via chip pickers with the fuzzy autofill in SPEC §6.3, including "Add 'X' as a new team member".
- Auto stage rule from SPEC §7.5.
- Days column with the colour thresholds, frozen at exitAt, "–" when no date.
- Rejected tab shows reason + date in the Comment column; exited companies show "Stage at exit" (or "Added directly").
- Every field change writes an AuditLog row. Optimistic updates with rollback + toast on failure.

Match the look in the reference HTML. Commit.
```

---

## Prompt 3: Filters, sort, Stages bar, PE team bar

```
Build Phase 3 from SPEC §5 and §6.2:
- Toolbar: search, the filter popovers (Date with presets, Priority, Stage, Sector, PE, Research, Via, OneDrive), active-count badges, Clear all.
- Sort dropdown with every option in §6.2, default Priority 1→5; clickable column headers toggle sort.
- Stages bar: six segments, colour rising with stage, click toggles the stage filter.
- PE team bar directly under it (always visible, no toggle): cards in TeamMember.peRank order with pipeline counts, click toggles the PE filter. Cross-filtering exactly as §5.4.
- Manage modal (all Editors): drag to reorder, ↑ ↓, remove, add with autofill, save updates peRank for everyone and shows "Last changed by X, <time>".
- Filters and sort live in the URL query string so a filtered view can be shared.

Commit.
```

---

## Prompt 4: Storage, Company File drawer, exits

```
Build Phase 4:
- StorageDriver interface with a LocalDiskDriver (STORAGE_DIR). Upload, stream, delete. Nothing else touches the filesystem.
- Authorised file routes: upload (extension + MIME sniff + MAX_UPLOAD_MB), view inline, download with Content-Disposition, download-all as a zip grouped Deck/Model/Other.
- The Company File drawer from SPEC §10: header with rename, meta row, status notes; tabs Summary (placeholder for now), Materials, Comments, History.
- Materials: multi-file upload with kind selector, list with View (PDF.js or native viewer for PDFs, images inline), Download, change Type, Remove with confirm.
- Comments: add, list newest first, edit.
- History: human-readable AuditLog.
- Exits from §10.3: Reject (required reason), Invest (one click + Undo toast), Restore, admin Delete (required reason → DeletionLog, removes stored files).

Commit.
```

---

## Prompt 5: Add company flow

```
Build Phase 5 from SPEC §7 (without AI for now; stub the summary step so it returns null):
- Add company modal with the Add to Pipeline / Add to Invested switch (defaults to Invested from the Invested tab).
- Choose step: deck drop zone (PDF/PPTX), "No deck yet?" name field, and for Invested the bulk textarea (one name per line, strip bullets/numbers, skip duplicates, report what was skipped).
- Processing step with the three-line progress list and "Skip summary and fill in by hand".
- Review step with all fields; Date defaults to today for Pipeline and blank for Invested; save rules from §7.3.
- Duplicate detection from §7.4, with "Add deck to X" / "Open X".

Commit.
```

---

## Prompt 6: AI summary

```
Build Phase 6: the AI summary from SPEC §9.
- Server-only module using the Google Gen AI SDK (@google/genai), model from GEMINI_MODEL, behind an AiProvider interface so we can swap models later.
- PDFs sent natively as application/pdf (inline base64 up to ~20 MB, Files API above that). PPTX: convert to PDF with LibreOffice headless if available, else extract slide text.
- Force structured output with responseMimeType "application/json" and a responseSchema matching §9.2; validate with zod and retry once on failure.
- System prompt must enforce every rule in §9.3 (no "not in deck", ₹ Cr conversion, no ratings/risks/headwinds, ~220 words).
- Build the markdown server-side (§9.4), omitting empty sections.
- Run as a background job with status, so closing the tab doesn't lose work; the UI shows progress and can cancel.
- Versioning + edited-version protection + the "newer summary" banner from §9.5; field auto-update rules for sector/sub-sector/name.
- Triggers from §9.6. Summary tab: version dropdown, Edit (markdown textarea), Regenerate / Generate from…

Write unit tests for the markdown builder, then test against a real deck. I'll give you two sample decks in the next message.
```

After it finishes, attach `FreshBus_IM_May_26.pdf` and `Mobigarage_-_Deck.pdf` and send:

```
Run the summarizer on both attached decks and show me the rendered markdown for each. Check: financials in ₹ Cr (FreshBus reports in INR Mn), projected years keep E/P, no "not in deck" text, no risks/headwinds, under ~220 words. Fix the prompt until both pass, then commit.
```

---

## Prompt 7: OneDrive and Excel export

```
Build Phase 7:
- OneDrive column and drawer link from SPEC §6.4: solid green cloud when saved (opens in new tab), grey outline when missing (paste popover), hover ✎ to edit, Save / Remove / Copy link, protocol validation, "Save anyway" warning for non-OneDrive hosts. Add the OneDrive filter (Link saved / Link missing).
- Export to Excel from SPEC §12 as a server route using exceljs: three sheets, exact columns, formatting, freeze panes, autofilter, hyperlinks, sort order, empty-sheet message. Always exports everything regardless of filters.

Generate a sample export from the seed data and open it with a script to verify the fonts, fills, column headers and hyperlinks. Commit.
```

---

## Prompt 8: Hardening and deploy

```
Phase 8, hardening:
- Audit every route/server action for session + role checks and zod validation. List any gaps and fix them.
- Security pass per SPEC §13 (upload validation, random storage keys, no javascript: URLs, no deck text in logs). Confirm the Gemini key is a paid-tier key and note it in the README.
- Playwright E2E: add company with deck → review → appears in Pipeline; change stage/priority; assign PE (auto stage rule); reject with reason → Rejected tab, days frozen; restore; invest + undo; bulk add to Invested with a duplicate; OneDrive link save; Excel export downloads.
- Mobile check at 390px width, dark mode check, keyboard focus visible.
- Dockerfile + docker-compose.prod.yml (app, Postgres, volume for STORAGE_DIR) and a README with setup, env vars, Entra ID app registration steps, and backup notes (pg_dump + files volume).

Run all tests, fix failures, commit.
```

---

## Tips for the session

- **If Claude drifts,** say: "Re-read SPEC.md §X and match it exactly."
- **Visual mismatches:** screenshot the prototype and the new build side by side and paste both in.
- **Adding features later:** add them to SPEC.md first, then prompt "Implement the new SPEC.md section X". The spec stays the single source of truth.
- **Entra ID sign-in** needs an app registration in your Microsoft 365 admin centre. Your IT admin will need 10 minutes for it. DEV_LOGIN lets you build everything before that's ready.

---

# Claude Code prompts: thesis and fit rating (Prompts 9 to 12)

Continues `BUILD_PROMPTS.md`. Same rules: paste one prompt, let it finish, test it, then move on. Each phase ends with a commit.

Before you start:
1. The folder `thesis/` in the repo root holds three files: `SPEC_17_THESIS_FIT.md`, `BUILD_PROMPTS_THESIS.md` (this file) and `thesis-seed.json`.
2. `thesis-seed.json` names holdings and rejected companies. It must never be committed. Prompt 9 git-ignores the folder first.
3. The database holds real deals. Prompt 9 takes a backup before it touches the schema.

What each prompt gives you:

| Prompt | You get | AI cost |
|---|---|---|
| 9 | Spec updated, tables created, thesis version 1.2 loaded | None |
| 10 | Every company has a theme; Thesis tab and theme pages live | A few cents, once |
| 11 | The rating engine, tested on real decks from the command line | A few deals' worth |
| 12 | Fit and Promise in the table and the company file; all pipeline deals rated | One run over the pipeline |

---

## Prompt 9: Spec, data model, thesis import (no UI, no AI)

```
Read thesis/SPEC_17_THESIS_FIT.md end to end. It is a new SPEC section written against this repo.

1. First, add `thesis/` to .gitignore and confirm `git status` does not list anything under thesis/. thesis-seed.json is confidential and must never be committed.
2. Paste the section into SPEC.md as "## 17. Thesis and fit rating" after §16, and apply every row of its "Edits to existing sections" table to SPEC.md, CLAUDE.md and .env.example. Append thesis/BUILD_PROMPTS_THESIS.md to BUILD_PROMPTS.md. Leave out the "Prisma models" appendix from SPEC.md; it goes into the schema.
3. Take a backup: `npx tsx scripts/db-data.mts export backup/before-thesis.json`.
4. Add the Prisma models and the Company and User fields from the appendix to prisma/schema.prisma under a "Thesis and fit rating (SPEC §17)" banner, following the file's conventions.
5. Create the migration with `npx prisma migrate dev --create-only --name thesis_fit`. If Prisma says it needs to reset the database or reports drift, STOP and tell me; do not accept. Open the SQL and confirm it contains only CREATE TABLE, CREATE INDEX, ALTER TABLE ADD COLUMN and ADD CONSTRAINT. Then `npx prisma migrate deploy`. Never `migrate reset`.
6. src/lib/domain/thesis.ts (pure, no React or Prisma imports): zod schemas for each row kind (`thesisRowZ` as a discriminated union on kind) and for the seed file; types via z.infer; helpers `currentRows`, `rowsAt(version)`, `themeByCode`, `anchorsFor(param)`, `themeScore(status)` (SPEC §17.5 LOOKUP values), `dealsForTheme`, `eventsForTheme`, `isStale(latestEvidence, today)`.
7. scripts/thesis-import.mts <file.json>: SPEC §17.1 Import. One transaction. Compare by kind + code + deep-equal data/evidence/decision. Idempotent. Prints counts only (added, changed, closed, unchanged), never row text.
8. Vitest unit tests for the domain helpers and for the import's diff logic (as a pure function over old rows and new rows).

Run `npx tsx scripts/thesis-import.mts thesis/thesis-seed.json`. Expect version 1 with label "1.2" and 146 rows: 21 principles, 24 themes, 12 parameters, 69 anchors, 18 flags, 2 highlights. Run it a second time and confirm nothing changes. Run lint, typecheck and tests. Commit (the commit must contain nothing from thesis/).
```

Check by hand: `git log -1 --stat` shows no file under `thesis/`.

---

## Prompt 10: Themes on companies, Thesis tab, theme pages

```
Build SPEC §17.2, §17.3 and §17.4.

1. Theme on a company: `themeCode` and `themeEdited` in the row loader (src/lib/server/company.ts `toRow`, `CompanyRow`), a server action to set or clear it (requireRole, zod, audit() in the same transaction, sets themeEdited), and a theme picker in the company file header beside sector (themes grouped by status, plus "No theme"). Cross-sector themes are not offered.
2. scripts/theme-backfill.mts (SPEC §17.2, step 3): first apply `holdingThemes` from thesis/thesis-seed.json to Invested companies by exact name (skip names that do not match and print how many). Then, for every company with no theme and themeEdited false, ask the cheap check model that src/lib/ai/news.ts uses, in batches of 60, sending only name, sector and sub-sector plus the list of theme codes, names and keywords. Strict JSON schema; the answer must be a current non-cross-sector theme code or null. `--dry-run` prints counts per theme without writing. Log counts and cost only.
3. Thesis tab (SPEC §17.3): a third side view after Funding, URL `?view=thesis`, loaded by a server component or action that reads current rows once. Sub-views as chips. Version picker reads older versions with rowsAt(). Hidden and refused in the funding-only deployment.
4. Theme page (SPEC §17.4) at `?view=thesis&theme=T06`: the six blocks, all joins on existing data. Company names open the company file. Reuse the Funding tab's "ours" marks and the Events tab's row styling.
5. Toolbar: a Theme filter on all three tabs (SPEC §17.10), wired through domain/view.ts (Filters, SET_KEYS, filtersForTab, applyFilters, URL sync).
6. Styling: status badges from existing CSS variables only; add to the "additions" block in globals.css. Sentence case, no em dashes, light and dark.
7. Unit tests for the view.ts changes and for the theme list sort. One Playwright test: open Thesis, open a theme, see the blocks.

Run the backfill with --dry-run and show me the counts per theme before writing anything. After I confirm, run it for real. Commit.
```

Check by hand: open Thesis, then the defence theme. Holdings should list the defence holdings named in the seed file; the pipeline block should include the defence deals in the pipeline.

---

## Prompt 11: The fit engine (no UI yet)

```
Build SPEC §17.5 to §17.8 and §17.11 as server code, with no UI.

1. src/lib/domain/fit.ts (pure): zod for `facts`, score rows, flags and highlights; `checkQuotes(facts, deckText)` and `checkNumbers` (reuse the matching in src/lib/summary/verify.ts); `agree(a, b)` (SPEC §17.7 agreement rule); `hasBannedWord(text)`; `means(scores, inputs, parameters)` with the minimums and coverage from §17.5; every CODE and STAGE flag calculator from §17.8; `highlightsFor(facts, theme)` with SMALL_REVENUE_CR = 100.
2. src/lib/fit/read.ts (server-only): SPEC §17.6. One call with the deck from prepareDeck(), model aiModel, strict JSON schema built from the current DECK parameters and themes, zod-validate, one retry, then checkQuotes and checkNumbers.
3. src/lib/fit/score.ts (server-only): SPEC §17.7. Two calls per DECK parameter that has quotes, model fitModel (add OPENROUTER_FIT_MODEL to env.ts, default anthropic/claude-opus-5.5; respect rejectsTemperature). Apply agree() and the banned-word retry.
4. src/lib/fit/jobs.ts: FitJob worker modelled on src/lib/ai/jobs.ts (claim with FOR UPDATE SKIP LOCKED, heartbeat, 3 attempts, 2 in parallel), started from src/instrumentation.ts after the summary worker and never when fundingOnly. processJob: load company, active summary and deck; read (or reuse stored facts when reason is THESIS); score; flags; highlights; write FitRating and set Company.activeFitId in one transaction with an audit() note "Rated fit, thesis version 1.2". Set Company.themeCode from facts.theme only when themeEdited is false.
5. Triggers (SPEC §17.11): queue a DECK job where writeSummary() in src/lib/ai/jobs.ts creates a version for a PIPELINE company; a `rateAgain` server action (MANUAL); thesis-import queues THESIS jobs for every Pipeline company with a deck when it writes a new version (by inserting FitJob rows directly, so the script needs no server-only import). One open job per company.
6. scripts/try-fit.mts <deck> [--theme T06]: runs read and score on a local deck without touching the database and prints, per parameter, the number of quotes kept and dropped, the two scores and the final one, plus flags, highlights and the cost from aiUsage. It may print quotes to the terminal; nothing in src/ may log them.
7. scripts/fit-backfill.mts [--limit N]: queues Pipeline companies that have a deck and no rating.
8. Vitest for everything in domain/fit.ts, including: a paraphrased quote is dropped; scores 4 and 3 give 3; 5 and 2 give blank; a null with a 4 gives blank; a `why` with "recommend" is rejected; blank is excluded from the mean and from the coverage numerator; three scored Fit parameters give "Not enough in the deck".

Then stop. I will give you two decks to try in the next message.
```

After it finishes, send (with one industrial deck and one consumer deck from the Decks folder, for example a defence information memorandum and a consumer brand):

```
Run scripts/try-fit.mts on both decks and show me the output. Check: every kept quote really is in the deck; no score above 3 rests on a claim with no number, name or date; no banned words; the defence deck gets theme T06, F4 = 5 and the sweet spot highlight; total cost per deck. Fix the prompts until both pass, record the cost per deal in the README, then commit.
```

---

## Prompt 12: Fit in the table and the company file, then the first run

```
Build SPEC §17.9 and §17.10.

1. Row data: add fit, promise, coverage, highlights and job state to CompanyRow (src/lib/domain/types.ts, toRow, rowInclude) from Company.activeFit and any open FitJob.
2. Table (Pipeline and Rejected): Fit and Promise columns after Priority, as SPEC §17.10. Highlight chips under the company name. Sorts "Fit, highest first" and "Promise, highest first" in domain/view.ts (SORTS, sortsForTab, sortRows; unrated last). Highlights filter on Pipeline.
3. Company file: FitTab.tsx after Summary for Pipeline and Rejected companies (store.tsx DrawerTab, normaliseTab, Drawer.tsx tabs). Layout and copy exactly as SPEC §17.10, including the fixed line "Ranks fit with the thesis. It is not a recommendation." Poll while a job is open, as the Summary tab does.
4. People's inputs (SPEC §17.9): actions `setFitInput` and `removeFitInput` (requireRole, zod, reason at least 10 characters, audit() in the same transaction), a small form for Change score and for the founder meeting parameters, and "Mark as checked" with a required note on the sweet spot chip. Recompute fit and promise on the active rating when an input changes (pure means(), no AI call). Optimistic through store.mutate() with rollback.
5. Search the whole UI for the words invest, pass, reject, recommend, buy, avoid inside anything the rating renders, and confirm none appears (the existing Invest and Reject buttons are unrelated and stay).
6. Playwright: a seeded company with a rating shows Fit in the table; open the Fit tab; change a score with a reason, the mean updates and History shows the change; sort by Fit; filter by Sweet spot. Mobile check at 390px, dark mode, keyboard focus.

Run `npx tsx --conditions=react-server scripts/fit-backfill.mts --limit 5`, wait for the jobs, and show me the five ratings and the total cost. After I confirm, run it without the limit. Commit.
```

Check by hand: sort the pipeline by Fit, highest first. Then send the top ten and bottom ten to the IC for the calibration in `decisions.md` D7.

---

## Prompt 13: The analyst read replaces the fit rating

Version 1 (Prompts 11 and 12) scored 1 to 5 from the deck alone and placed deals on ladders of past deals; the team found it unresearched. It is withdrawn and replaced by an analyst read: researched outside the dashboard (by Claude in a chat, with web search), scored out of 10, with sources. The dashboard checks, stores and shows a read. This phase makes no AI call.

```
Read CLAUDE.md, then SPEC.md §17 in full (rewritten 23 Nov 2026, uncommitted in the tree: the source of truth; do not rewrite it).
Reads waiting in thesis/reads/ are confidential: never commit, print or use them as fixtures.

Rules: only `prisma migrate deploy` (never reset or db push); the migration is additive (AnalystRead, Company.activeReadId,
FitInput.score widened to Decimal(3,1)); back up first with scripts/db-data.mts export; never log a read's body; made-up
fixtures only; E2E only on the *_test database.

1. Docs: this prompt here; CLAUDE.md (AI row, folder notes, "Reads carry deck figures" rule).
2. Data model (§17.13): AnalystRead, Company.activeReadId, FitInput.score widened; migration <timestamp>_analyst_read; db-data.mts.
3. Domain (src/lib/domain/read.ts, pure): readZ with the limits of §17.5; checkRead (§17.6, §17.7: half points, the five keys
   in order, overall inside the range, an outside source behind any score above 6 except THESIS, source ids that resolve,
   http(s) URLs, non-empty notChecked, no banned word in judgement text, no em dash); readStale; the canonical JSON for the
   hash; labels; the score questions. Unit tests: one passing and one failing fixture per rule.
4. Loading (§17.11): loadRead in src/lib/server/read.ts, one transaction with the audit row; POST /api/reads (requireRole,
   JSON only, same-origin Origin, 512 KB, one result per read); scripts/read-import.mts (one line per file: name, company
   id, ok or reason codes).
5. Withdraw version 1: no fit worker, no queueFitJob calls; delete src/lib/fit/, fit-backfill.mts, try-fit.mts,
   OPENROUTER_FIT_MODEL and the version 1 actions. FitRating and FitJob tables and rows stay.
6. Team scores (§17.9): setReadInput, removeReadInput, checkSweetSpot; ignore FitInput rows with version 1 codes.
7. Table (§17.10): one Read column replaces Fit and Promise; "Read, highest first"; CompanyRow.read.
8. Read tab (§17.10) in the spec's order; every read string rendered as text; source links validated, new tab, noopener.
9. Thesis tab: "How deals are scored" replaces Parameters; "Waiting for a read" with its count; theme page shows Read.
10. Checks: lint, typecheck, unit, E2E (Read column and sort, Read tab, each code check refused through POST /api/reads,
    a team score changing the table, the waiting list, 390 px). Verdict words only in the fixed line.
11. Real database: migrate deploy, then read-import.mts thesis/reads. A name that does not match is reported, not guessed.
12. Report in thesis/REPORT_13.md. Commit and push only if every check passed.
```

---

## Not in these prompts

These wait until the first version has been used for a couple of weeks (SPEC §17.13): the inbox of proposed thesis changes, watchers for new interviews and notes, web research to check claims, the IC calibration view and weights, "waiting on" and round deadline fields.
