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
