# Niveshaay PE Desk: Product Spec

Source of truth for the rebuild. A working prototype (v1.3) is in `reference/niveshaay-deal-pipeline-v1.3.html`. Match its behaviour and look unless this spec says otherwise. Where they disagree, this spec wins.

---

## 1. Purpose

Internal tool for Niveshaay's private equity team (a SEBI-registered Category II AIF) to replace the Excel deck tracker:

- Upload a company's pitch deck.
- Auto-fill the key fields and generate a short AI summary.
- Track the company through the pipeline.
- Record every rejection with a reason.
- Keep portfolio companies in an Invested list.

Decks are confidential (received under NDA), so everything is private and login-only.

## 2. Tech stack

The app must be portable to Niveshaay's own servers later.

| Layer | Choice |
|---|---|
| App | Next.js (App Router), TypeScript, React Server Components where useful |
| DB | PostgreSQL (the firm's AWS RDS server, `DB_*` credentials) + Prisma. TLS with certificate verification against the bundled RDS CA by default. No local database |
| Auth | **None for now (open access, the firm's decision on 2026-09-30).** Every visitor acts as one shared "Team" user with Editor rights. The site sends `X-Robots-Tag: noindex` and `robots.txt` disallows crawling. A login will be designed later; it plugs into `currentUser()` / `requireRole()` |
| File storage | A `StorageDriver` interface backed by an **S3-compatible bucket** (no local file storage). Every file is **encrypted client-side (AES-256-GCM) before upload** with `STORAGE_ENCRYPTION_KEY`, so bucket access alone never exposes a deck. Files are only ever served through the app's authorised routes, never via public bucket URLs. Nothing outside the driver may touch storage or the filesystem |
| AI | **OpenRouter** (OpenAI-compatible chat completions API), server-side only, behind an `AiProvider` interface so the model can be swapped later. Model from env `OPENROUTER_MODEL` (default `google/gemini-2.5-pro`, which reads PDFs natively; Flash put correct figures under the wrong years in testing). Requests set `provider.data_collection = "deny"` (see §13). The PDF's text layer is sent with the PDF so figures are copied exactly, and every figure in the financials table is checked against the deck text: if any is missing, the model gets one corrective pass, and figures still not found are listed under the table as "Check against the deck". The table holds **only the company's own figures**: rows must be metrics (rows named after companies are dropped), and a second, independent check confirms the figures are the company's own (not peers, comparables, market sizes, budgets, order or contract values, or funding); otherwise the financials are removed. A deck without its own financials gets no table |
| Excel | `exceljs` (server route) |
| Zip | `archiver` or `jszip` (server route) |
| Styling | CSS variables for design tokens (section 11). Tailwind is fine if tokens map to CSS variables |
| Tests | Playwright end-to-end for the main flows; unit tests for summary markdown building and date/day maths |
| Deploy | Dockerfile (Easypanel from GitHub), or `docker-compose.prod.yml` (app only; DB and files are external) |

Env vars:

- `DB_HOST`, `DB_PORT`, `DB_USER`, `DB_PASS`, `DB_NAME` (or a single `DATABASE_URL`)
- `DB_SSL` (`verify-full` default, `require`, `disable`), `DB_SSL_CA`, `DB_SCHEMA` (optional)
- `OPENROUTER_API_KEY`
- `OPENROUTER_MODEL`
- `AWS_S3_ENDPOINT_URL`, `AWS_S3_BUCKET_NAME`, `AWS_S3_FOLDER`, `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY` (optional `AWS_REGION`, default `us-east-1`)
- `STORAGE_ENCRYPTION_KEY` (32 random bytes, base64; losing it makes stored files unreadable)
- `STORAGE_NAMESPACE` (optional sub-folder, default `files`; tests use their own)
- `MAX_UPLOAD_MB` (default 50)

## 3. Roles

| Role | Can |
|---|---|
| Admin | Everything, plus manage the sector master list |
| Editor | Add and edit companies, upload files, comment, reject, invest, restore, permanently delete, manage the PE team list |

- There is no read-only Viewer role for now.
- **While there is no login, everyone is an Editor** (the shared "Team" user). Adding sectors is unavailable until a login exists.
- **Invested tab columns** (2026-10-15): no Priority, Stage at exit or Via (hidden in the table, filter buttons, sort list and the Excel Invested sheet; switching to Invested clears those filters). Amount invested by fund, quarterly tracker, contacts and meetings: see section 15.
- **Bulk add to Rejected** (2026-10-15): Add company (Pipeline target, opened automatically from the Rejected tab) → "Add several rejected companies at once": one name per line, one shared reason (required) and a "Rejected on" date (default today, not in the future). Names already on the dashboard are skipped; stage at exit is Not Assigned; each company gets a Rejection row and a History note.
- **Permanent delete is open to Editors** (decision of 2026-10-01): drawer → Delete → reason → "Delete permanently". It removes the company, its files (from storage too), summaries, comments and history; a `DeletionLog` row keeps the name and reason.

- Enforce roles on **every** API route and server action, not just in the UI.

## 4. Data model (Prisma)

- **User**: id, name, email, role, createdAt
- **TeamMember**: id, name (unique, case-insensitive), peRank (int, nullable; non-null = shown in the PE team bar, ordered ascending)
- **Company**:
  - Core: id, name, sector, subSector, stage (enum), priority (1–5, nullable)
  - Status and dates: status (enum `PIPELINE | REJECTED | INVESTED`), dateReceived (date, nullable), exitAt (date, nullable), exitStage (nullable), directInvested (bool)
  - Other fields: rejectReason (nullable), oneDriveUrl (nullable), activeSummaryId (nullable)
  - Edit flags: nameEdited, sectorEdited, subSectorEdited (bool)
  - Audit: createdAt, createdById
- **CompanyPerson**: companyId, teamMemberId, role enum `PE | RESEARCH | VIA` (many-to-many; order preserved by `position`)
- **Comment**: id, companyId, text, authorId, createdAt, editedAt
- **File**: id, companyId, originalName, kind enum `DECK | MODEL | OTHER`, mime, sizeBytes, storageKey, uploadedById, uploadedAt
- **Summary**: id, companyId, version (int), sourceFileId (nullable), json (raw AI output), markdown, edited (bool), editedById, editedAt, createdById, createdAt
- **Rejection**: id, companyId, reason, stageAtRejection, byId, at. Keeps history across restores.
- **AuditLog**: id, companyId (nullable), actorId, field (nullable), fromValue, toValue, note, at
- **Sector**: id, name, sortOrder. Seed list (section 8).
- **DeletionLog**: id, companyName, reason, byId, at
- **Thesis and analyst read** (§17): `ThesisRow`, `ThesisVersion`, `AnalystRead`, `FitInput` (team scores); on **Company**: `themeCode`, `themeEdited`, `activeReadId`. `FitRating`, `FitJob` and `activeFitId` are left from version 1 and unused (§17.13).

Stages enum, in order:

1. Not Assigned
2. Call Pending
3. Internal Discussion
4. Scuttlebutt
5. Allocation
6. Due Diligence

## 5. Page layout (single page)

1. **Header.**
   - Left: the wordmark "Niveshaay" and the product label "PE Desk" (see §11).
   - Right: **Export to Excel** (secondary) and **Add company** (primary).
2. **Tabs**: Pipeline · Rejected · Invested, each with a count, then the side views Events · Funding · **Thesis** (§17.3; Thesis after Funding).
3. **Stages bar** (Pipeline tab only).
   - Six segments in stage order, each showing its name and count.
   - Colour intensity rises with stage (grey → light green → deep green).
   - Clicking a segment toggles a stage filter.
4. **PE team bar** (Pipeline tab only), directly under the Stages bar and always visible.
   - Left label: "PE team", with a **Manage** link.
   - One card per PE member in `peRank` order, each showing the name and a count of **pipeline** companies where that person is in Assigned PE. A company with two PE people counts for both.
   - Clicking a card toggles the PE filter.
   - The two bars cross-filter:
     - Stage counts apply every active filter except the stage filter.
     - PE counts apply every active filter except the PE filter.
   - **Manage** is available to every Editor. It opens a modal where you:
     - see the ordered list (drag handle, ↑ ↓, remove ✕)
     - add a name with autofill (section 6.3)
     - save, which updates `peRank` for everyone and records who changed it (shown as "Last changed by X").
   - **Automatic:** a name newly assigned as PE on a company (table, drawer, Add company) joins the end of the bar if it isn't there. Names already on that company aren't re-added, so a name removed via Manage stays removed until it's newly assigned somewhere.
5. **Toolbar**.
   - Search across company name, sector, sub-sector, comment text and rejection reason.
   - Filter buttons, each showing an active-count badge: Date (from/to plus presets for the last 7, 30 and 90 days), Priority (P1–P5, Unset), Stage, Sector, PE, Research, Via, OneDrive (Link saved / Link missing).
   - Clear all.
   - Sort dropdown (right).
6. **Table**, with sticky header, the Company column pinned left, and horizontal scroll.

## 6. Table

### 6.1 Columns (in order)

| Column | Behaviour |
|---|---|
| Company | Serial number in front of the name (**follows the current view**: renumbers 1…n after any sort or filter). Clicking the name opens the Company File drawer. Shows "N files" underneath when files exist, and highlight chips (§17.8). |
| OneDrive | A **solid green cloud** when a link is saved: click opens it in a new tab (`target=_blank rel=noopener`), and hovering shows ✎ to edit. A **grey outline cloud** when missing: click opens a popover to paste the link. See 6.4. |
| Sector & sub-sector | Two lines. Click to edit: the sector comes from the master list, with "Add a new sector…" as an option (admin only); the sub-sector is free text. |
| Stage | A thin 6-segment progress rail above an inline dropdown. Any stage can be chosen (skipping is allowed). The Rejected and Invested tabs show "Stage at exit" read-only, or "Added directly" for direct-invested companies. |
| Priority | Inline dropdown: Set / P1…P5. P1 is solid gold, P2 gold outline, P3 neutral outline, P4–P5 muted, and unset uses a dashed outline. |
| Read | Pipeline and Rejected tabs only (§17.10): the overall score out of 10 with its confidence beneath, an "Out of date" mark when it applies, "–" when there is no read. Clicking opens the company file on the Read tab. Not editable in the cell. |
| Assigned PE | People chips. Click to edit with the chip picker. |
| Assigned Research | Same as Assigned PE, with its own name list (6.3). |
| Comment | The latest comment (2-line clamp) with author and date, plus "· N comments". Click opens the drawer on Comments. In the Rejected tab this column shows the rejection reason and date instead. |
| Via | People chips (internal person who brought the deal). |
| Date | Date received. Click to edit. |
| Days | Today minus Date received, right-aligned, colour-coded: ≤30 normal, 31–60 amber, >60 brick. **Freezes at exitAt** for Rejected and Invested companies. Shows "–" when there's no date. |

- Every field is editable, including the AI-filled ones. Exceptions:
  - the serial number (view-derived)
  - Days (computed from Date)
- Column headers for Company, Sector, Stage, Priority, Date and Days toggle sort.

### 6.2 Sort options

| Option | Order |
|---|---|
| Priority 1 → 5 (**default**) | Unset last, then newest received |
| Priority 5 → 1 | Unset last |
| Newest received / Oldest received | By Date received |
| Most days / Fewest days waiting | By Days |
| Stage | Pipeline order, or reverse |
| Company | A–Z / Z–A |
| Sector | A–Z / Z–A |
| Read, highest first | Pipeline and Rejected (§17.10). Unread last |

### 6.3 Name autofill (PE, Research, Via, Manage)

- **Separate name lists** (decision of 2026-10-02): each TeamMember is in one or more of the PE, Research and Via lists (`inPe`, `inResearch`, `inVia`).
  - Assigned PE suggests PE names only; Assigned Research suggests Research names only; Via suggests PE names plus Via names. Manage (PE team) suggests PE names.
  - A name typed into a field is added to that field's list (a new Via name goes to the Via list, not PE).
  - Existing names were sorted by how they had been used; names used nowhere went to PE and Via.
- Suggestions within a list:
  - ranked by prefix match (including first name), then substring, then small Levenshtein distance (≤1, or ≤2 for inputs of 4+ characters)
  - "keyurr" → Keyur
  - "ar" → Arjun, Arvind Sir
- Keyboard:
  - ↑/↓ moves through suggestions
  - Enter picks the top match
  - Backspace on an empty input removes the last chip
- A name not in the list shows the option **Add "X" as a new team member**. Choosing it creates the TeamMember (Title Case).

### 6.4 OneDrive link

- Only `http`/`https` URLs are accepted. Anything else is rejected with a message.
- If the host isn't `*.sharepoint.com`, `onedrive.live.com`, `1drv.ms` or `onedrive.com`, a warning reads "does not look like a OneDrive or SharePoint link", and the button becomes **Save anyway**.
- The popover has Save, Remove and Copy link.
- The link is also editable from the drawer header.
- The link only navigates. It does not grant OneDrive access.

## 7. Adding companies

**Add company** opens a modal with an **Add to Pipeline / Add to Invested** switch. It defaults to Invested when opened from the Invested tab.

### 7.1 Choose step

- **Drop zone:** a PDF or PPTX deck.
- **"No deck yet?":** a company name field and Continue.
- **Invested only:** an expandable **"Add several portfolio companies at once"** textarea, one name per line.
  - Leading bullets and numbers are stripped.
  - Names already on the dashboard (fuzzy match, 7.4) are skipped, and the result is reported as "Added N. Skipped M already on the dashboard: …".

### 7.2 Processing step (deck uploaded)

Progress list: Uploading the deck → Reading the deck → Writing the summary. There's a **Skip summary and fill in by hand** button, which cancels the AI call only.

### 7.3 Review step

- **Fields:**
  - Company, Sector (from the master list), Sub-sector
  - Date received: defaults to today for Pipeline, blank for Invested
  - Priority, Assigned PE, Assigned Research, Via, Comment
- **Collapsible "Preview the AI summary"**.
- **Save rules:**
  - For **Pipeline**, the stage is `Not Assigned`, or `Call Pending` if anyone is in PE or Research.
  - For **Invested**: status `INVESTED`, `directInvested = true`, no exit stage.
  - Each of name, sector and sub-sector is flagged as edited if the user changed it from the AI value.

### 7.4 Duplicate detection

- **Name normalisation:** lower-case, strip `private|pvt|limited|ltd|llp|inc|india|the` and non-alphanumerics.
- **Match rule:** equal after normalisation, or Levenshtein ≤1 when the name is 5+ characters.
- **On match:**
  - the review screen shows "'X' is already in <tab>."
  - with a deck: the button **Add deck to X** appends the file and a new summary version to the existing company
  - without a deck: the button **Open X** opens the existing company.

### 7.5 Automatic stage rule

When a pipeline company in `Not Assigned` gets its first PE or Research assignee, it moves to `Call Pending`. Nothing ever moves it back automatically.

## 8. Sector master list (seed)

Agri & Food, AI & Deep Tech, Automotive Component, Building Materials, Business Services & Staffing, Chemicals & Materials, Consumer, Consumer Internet & E-commerce, Defence, Aerospace & Drones, Education, Electronics & Semiconductors, Energy Transition, EV & Charging, Financial Services & Fintech, Healthcare & Pharma, Industrial Products, Infrastructure & EPC, IT Services & BPM, Logistics & Supply Chain, Manufacturing, Media & Entertainment, MedTech & Diagnostics, Metals & Mining, Packaging, Real Estate & Hospitality, Recycling, Space Tech, Technology & SaaS, Telecom & Data Centres, Water Infrastructure, Other (always last).

No two sectors may overlap; the firm's portfolio names win. Oct 2026 merges: Renewables & Climate and Power & T&D → Energy Transition; EV & Battery Tech → EV & Charging; Consumer & Retail and Textiles & Apparel → Consumer; Aerospace & Defence → Defence, Aerospace & Drones; Auto & Auto Components → Automotive Component; Electronics & EMS → Electronics & Semiconductors; Mobility & Logistics → Logistics & Supply Chain; Industrials & Manufacturing → Industrial Products; Water & Waste Management → Water Infrastructure. Where a company's business didn't fit the sector-level merge it was placed by what it does (waste-to-energy → Recycling; EV charging and EV makers → EV & Charging; auto ancillaries → Automotive Component; shipyards → Industrial Products).

## 9. AI summary

### 9.1 Input

- **PDF:** send natively to the model as an OpenRouter `file` content part (base64 data URL) with the `file-parser` plugin set to the `native` engine, so charts and scanned pages are read too.
- **PPTX:** the models don't read PPTX. Convert to PDF with LibreOffice headless if it's available on the server. Otherwise extract slide text (`ppt/slides/slideN.xml`, `<a:t>` runs, slide order) and send it as text.
- Enforce `MAX_UPLOAD_MB`.
- Run server-side as a background job, recording status on the Summary row or a job table, so a closed tab doesn't lose work. The UI polls for the result or streams progress.

### 9.2 Output

Force structured output with `response_format: { type: "json_schema", strict: true }` (and `provider.require_parameters = true` so only endpoints that honour it are used). Validate the result with zod, and retry once if validation fails:

```
company, sector (one of the master list), subSector (2–5 words),
round, advisor, location, deckDate,
business: string[3–4] (full sentences, 20–35 words each, together explaining the whole business model: what they do,
  for whom, how they make money and deliver, current scale),
revenueMix, financials: { unit: "₹ Cr", columns: string[≤6], rows: [{label, values[]}] (≤3 rows, Revenue first,
  then the most useful of EBITDA %, Gross margin %, PAT), growth: "X% CAGR actual (FYa–FYb) vs Y% projected (FYc–FYd)" },
dealAsk, founders (incl. existing investors), customers, differentiation (as claimed),
sectorPoints: string[2–3], tailwinds: string[2–3]
```

### 9.3 Prompt rules

- Use only what the deck states. **Missing fields are null or empty.** Never write "not in deck" or "not disclosed", and never estimate.
- INR amounts are shown in ₹ Cr (1 Cr = 10 Mn = 100 Lakh). USD amounts stay in USD.
- Keep the deck's E or P suffix on projected years. Losses go in brackets.
- **No** ratings, recommendations, red flags, risks or headwinds.
- Plain, factual wording, under about 320 words in total (raised from 220 on 2026-10-13 so the business model is explained properly); other sections stay short.

### 9.4 Rendering

The server builds markdown from the JSON, omitting empty sections entirely:

1. Snapshot (key–value grid: Round, Advisor, Location, Deck date)
2. Business (3–4 bullets, each a full sentence, together explaining the business model)
3. Revenue mix
4. Financials (₹ Cr) table plus a "Growth:" line
5. Deal ask
6. Founders & cap table
7. Customers
8. Differentiation (claimed)
9. Sector (bullets)
10. Tailwinds (bullets)

### 9.5 Versions

- Every generation creates a new Summary version.
- If the active version was **edited**, it stays active. A banner shows "A newer summary was written from <file>. Your edited version is still showing" with a **Show the new version** button. Otherwise the new version becomes active.
- A new deck also updates sector and sub-sector **only if** the edited flag for that field is false, and the name only if it's empty.
- The summary can be edited as markdown in a textarea. Saving marks it edited, with who and when.

### 9.6 Triggers

A summary is generated:

- on deck upload in Add company
- on uploading a file of kind Deck (PDF/PPTX) in Materials
- manually, with Generate / Regenerate (from a chosen deck file)

## 10. Company File drawer (right side, ~780px, full width on mobile)

### 10.1 Header

- Close button.
- Actions:
  - Pipeline: **Invest** and **Reject**.
  - Rejected or Invested: **Restore to pipeline**.
  - Admin only: **Delete**.
- Company name: large serif, click to rename.
- Meta row:
  - status badge
  - sector and sub-sector (click to edit)
  - OneDrive folder link, or "Add OneDrive link"
  - "Received <date>" and "<N> days"
  - current stage.
- A Rejected company shows a note with the date and reason. An Invested company shows the invest date, or "Portfolio company, added directly to Invested."

### 10.2 Tabs

- **Summary:**
  - version dropdown ("Version N, from <file>, <datetime> (edited)")
  - Edit
  - Regenerate (or a "Generate from…" dropdown when there are several decks)
  - the rendered summary
- **Read** (Pipeline and Rejected companies, after Summary): the analyst read, as §17.10.
- **Materials:**
  - an upload zone with a Deck / Model / Other selector (drag and drop, or pick multiple files)
  - a file list with a type badge, size, uploader and date, and the actions View (PDF or image, inline), Download, Type (change kind) and Remove (with a confirm dialog)
  - **Download all**, as a zip grouped into Deck/, Model/ and Other/ folders
- **Comments:**
  - an add box
  - the list newest first, with author and time
  - an Edit action (marked "(edited)")
- **History:** the AuditLog, newest first: "<name> changed <field> from X to **Y**" and notes like "Uploaded file.pdf (Deck)".

### 10.3 Exits

| Action | Behaviour |
|---|---|
| Reject | Modal with a **required** free-text reason. The Reject button stays disabled while the reason is empty. Sets status REJECTED, rejectReason, exitAt = today, exitStage, and adds a Rejection row. The day counter freezes. |
| Invest | One click, no fields. Sets status INVESTED, exitAt = today, exitStage. Toast "Moved to Invested" with **Undo**. |
| Restore | Back to PIPELINE. Clears exitAt, exitStage, rejectReason and directInvested. The day counter resumes from the original dateReceived (or today if it was blank). The Rejection history is kept. |
| Delete (admin) | Modal with a **required** reason, written to DeletionLog. Removes the company, its rows and its stored files. |

## 11. Design system

**Name:** the tool is **Niveshaay PE Desk** (wordmark "Niveshaay", product label "PE Desk"). The Excel export uses the same name (§12). WhatsApp messages still say "the deal pipeline" in plain words.

**World: Marine Drive deco** (2026-11-25). Taken from Mumbai's Art Deco financial district: a peacock-teal band, a cool white page (never cream), coral for primary actions, brass for P1, and sea-glass stages from pale aqua to deep teal. Light and dark themes (`prefers-color-scheme`); the band stays teal in both. Pass 2 (2026-11-25) carries the world across the company drawer, the Invested views, modals and popovers, Events, Funding and Thesis.

| Token | Light | Dark |
|---|---|---|
| paper (page) | #F2F6F5 | #060E0E |
| surface | #FFFFFF | #0C1818 |
| ink | #0D2121 | #E7F0EE |
| muted | #536B6A | #88A29E |
| rule | #D5E1DE | #1F3433 |
| band (header and tabs) | #0F3B3A, ivory text #F3EFE4 | #0B2E2D (deeper), ivory text #F3EFE4 |
| green (teal: links, focus, selection) | #0F5C58 | #5FD1C1 |
| coral (primary action only: Add company and modal primaries) | #EE7A5B, dark text #2A0E06 | #F28B6E, dark text #2A0E06 |
| gold (P1 and the active tab underline) | #D4AE3A, dark text #211904 | #D6B14A, dark text #1F1903 |
| brick (reject/danger) | #A3341F | #F0937E |
| amber (ageing) | #875900 | #E6B85A |
| stage 0–5 | #E3ECEA, #D2EAE5, #ACDCD4, #6CBFB3, #23877D, #0F5C58 | #172625, #163533, #1B4A46, #22665F, #2F8F84, #5FD1C1 |

The full set (surface-2, hover, faint, soft fills, band tints, shadows, radii) lives at the top of `src/app/globals.css`.

- **Fonts:**
  - Hanken Grotesk for the UI and data, with tabular numerals for figures
  - Jost for the wordmark (uppercase, widely tracked), the stage and PE counts, drawer company name, modal titles and stamps
  - Source Serif 4 for long reading text (Funding letters, analyst reads)
  - Generated documents (Excel, PDF letters, results) keep their own fixed fonts
- **Band:** header and tabs sit on one teal field. The active tab has a brass underline and an ivory count; a brass rule and two faint hairlines close the band.
- **Stage bar (signature):** six segments that step up from left to right like the Marine Drive skyline, standing on a deep teal baseline, with large counts. Stages with no deals are drawn as outlines, so weight follows the count. The selected stage gets an ink ring. On first load the segments rise into place once (skipped with reduced motion). On phones the six stages sit in two rows of three, still rising left to right. Each row's stage rail steps up the same way.
- **PE team bar:** each person shows their initials, name and count.
- **Ornament:** a triple hairline between the bars and the list is the only decoration.
- **Company drawer:** its head is a second teal band: the company name in ivory Jost, ivory meta and badges, and drawer tabs with a brass underline, closed by the same brass rule and hairlines.
- **Everywhere else:** section titles and key figures use Jost; small labels are sentence case (no tracked uppercase); the selected option in a segmented switch (Invested views, Thesis sections, fund switch, Add company target, Funding months) is a solid teal fill; panels share one 12px-radius container. Funding keeps its sector and stage colours as data, on flat tints: no gradients, decorative circles or uppercase labels, and its headline figure card sits on the band colour.
- **Exit stamps:** in Rejected and Invested, the stage column shows a stamp ("Rejected" in brick, "Invested" in brass) above "at <stage>", instead of a plain label.
- **Sentence case everywhere.** No em dashes in UI copy. The wordmark and stamps are set in uppercase by CSS only; the text stays in sentence case.
- **Responsive:** 16px gutters on phones. Below 760px:
  - the page scrolls as a whole; the band stays pinned at the top
  - Export to Excel and Add company show as icon buttons (with labels for screen readers)
  - the PE team bar, filter row and Invested view switcher scroll sideways instead of wrapping
  - the Pipeline, Rejected and Invested lists show as cards instead of the table: company and priority, then the latest comment (or reason or update) as the next step, then sector, highlights, stage (or amount invested), PE and research, date, files, OneDrive and days. Stage and priority are editable on the card; the company name and comment open the company drawer
  - touch targets are at least 40px tall
- **Table:** every Pipeline column fits at 1440px wide. The open row is tinted and outlined in teal; on phones the open card lifts.
- **Motion:** respect reduced-motion settings (stamps lose their tilt, the stage bar does not animate).

## 12. Export to Excel

- **Button:** header. Available to all roles.
- **Scope:** always exports **everything**, ignoring active filters.
- **File:** `Niveshaay PE Desk YYYY-MM-DD.xlsx`.
- **Sheets:**
  - **Pipeline:** Sr. No., Company, Sector, Sub-sector, Stage, Priority, Assigned PE, Assigned Research, Latest comment, Comments (count), Via, Date received, Days, OneDrive, Files (count)
  - **Rejected:** Sr. No., Company, Sector, Sub-sector, Stage at exit, Priority, Assigned PE, Assigned Research, Rejection reason, Rejected on, Via, Date received, Days in pipeline, OneDrive
  - **Invested:** Sr. No., Company, Sector, Sub-sector, Stage at exit (or "Added directly"), Priority, Assigned PE, Assigned Research, Latest comment, Via, Date received, Invested on, Days in pipeline, OneDrive
- **Each sheet:**
  - row 1: title "Niveshaay PE Desk: <Sheet>" in Times New Roman 14 bold, dark green #004800
  - row 2: "N companies. Exported on <datetime>." in italic grey
  - row 3: headers in Times New Roman bold white on blue #1F4E79
  - body: Times New Roman 11, thin light borders, light zebra fill #F4F7F1
  - dates formatted `dd-mmm-yyyy`
  - long text wrapped
  - OneDrive as an "Open folder" hyperlink
  - freeze panes at C4, an autofilter on the header row, set column widths
  - rows sorted Priority 1→5, then newest
  - an empty sheet says "No companies in this list."

## 13. Security and quality bars

- Every route checks the session and role, and validates input with zod.
- Uploads:
  - check the extension and sniff the MIME type
  - size limit
  - store files with random keys; never trust the original filename on disk
  - serve files via an authorised route with `Content-Disposition`
- The OneDrive URL is rendered only after protocol validation. No `javascript:` URLs.
- Deck content is sent to the model only for summarising. The analyst read (§17) is written outside the dashboard and sends no deck text to any search or outside tool. No logging of deck text.
- Reads are never logged. `thesis/` (the confidential thesis seed and the read files) is git-ignored and never reaches the repository or the Docker image.
- **Use a paid OpenRouter key with credits, never free (`:free`) models.** Free models and some providers may log or train on prompts, which is incompatible with NDA decks. Every request sets `provider.data_collection = "deny"`, so OpenRouter only routes to providers that don't store or train on data. Also turn off "prompt logging / training" in the OpenRouter account's privacy settings.
- AuditLog entries for every field change, status change, file upload/remove and summary generate/edit.
- Optimistic UI updates, with rollback and a toast on failure.

## 14. WhatsApp deck intake

Decks shared in the team's WhatsApp group are added to the pipeline automatically, through the firm's Evolution API instance (v2).

- **Env:** `EVOLUTION_API_URL`, `EVOLUTION_API_KEY`, `EVOLUTION_INSTANCE`, `EVOLUTION_Receiver` (the group JID, `…@g.us`). Optional `WHATSAPP_POLL_SECONDS` (default 60).
- **Delivery:** for now the app **polls** Evolution (`/chat/findMessages`, newest first) every `WHATSAPP_POLL_SECONDS`. The instance's existing webhook belongs to another integration and must not be changed. When the app is hosted, a webhook can replace polling.
- **Start point:** the first poll records "now" and only handles messages after it (no back-fill of old group history). Each message is handled once (tracked by its WhatsApp message id).
- **What counts as a deck:** a document message in that group that is a PDF or PPTX (by mimetype or extension). Everything else is ignored. The `MAX_UPLOAD_MB` and MIME-sniff rules apply.
- **For each deck:**
  1. Download it (`/chat/getBase64FromMediaMessage`) and store it like any upload (kind Deck).
  2. If AI is configured, run the summary (§9) first and use its company name, sector and sub-sector. Otherwise the name comes from the file name.
  3. **Duplicate** (§7.4) → the deck and a new summary version are added to the existing company. Otherwise a new **Pipeline** company is created with **Date received = the date the message was sent** (India time) and stage Not Assigned.
  4. **Sender:** the WhatsApp sender is matched to a team member by phone number (`TeamMember.whatsappNumber`), else by display name (first name). A display-name match stores the number for next time. Unknown senders use their display name (Title Case, emojis removed).
  5. **Via:** if the caption, or a text from the same sender within 5 minutes of the deck, says `from`, `via`, `through`, `thru`, `ref`/`referred by`, `sent by`/`shared by`/`forwarded by`, `from/via`, or `by` at the start of a line ("By Raghav", added 2026-10-29) followed by a name (e.g. "from/Via arvind sir"), Via is that person (matched to the team list, else Title Case). Otherwise Via is the sender.
  6. History records "Added from WhatsApp, shared by <sender>" (actor: WhatsApp).
  7. The bot **replies in the group**, e.g. "Added *FreshBus* to the pipeline, via Arvind Sir (shared by Raghav), received 30 Sep 2026." or "Added this deck to *FreshBus*, already in Rejected." If a deck can't be handled it replies with the reason (too large, unreadable).
- Deck contents are never written to logs; the reply never quotes deck contents beyond the company name.

## 15. Portfolio tracking (Invested tab)

All amounts are **₹ Cr**, shown as "₹ 12.5 Cr" with Indian digit grouping. Current value, MOIC and valuation marks were removed on 2026-10-16 (not tracked).

### 15.1 Amount invested, by fund
- **Rounds** (`InvestmentRound`): any number per Invested company. **Fund** (required: **Hedgehogs**, **Sambhav** or **Other**, for money not from either fund, e.g. MecPower, Vaneera Industries), date (not in the future), round name (free text with suggestions), instrument (Equity, CCPS, CCD, Convertible note, Other), amount (> 0, required), pre-money valuation (optional), stake bought % (optional; one-click suggestion amount ÷ (pre-money + amount)). Add, edit, remove (two clicks). A company can have rounds from both funds. Rounds entered before funds existed show **Fund not set** (amber) until edited.
- **Invested table:** one column, **Invested**: the total of all rounds, with the split underneath ("Hedgehogs ₹ 10 Cr · Sambhav ₹ 5 Cr"); clicking opens the company file on **Investment**. Sorts: Invested highest/lowest first (default). A **Total** row with the same split. No Priority, Stage at exit or Via on this tab.
- **Summary line** above the table (respects filters/search): total invested, companies, Hedgehogs and Sambhav (with %; Other too when it has any), and a **Sector allocation** button. Columns on Invested: Company, OneDrive, Sector, Invested, Assigned PE, Assigned Research, Latest update, **First invested** (date of the first round; the Date filter and sorts use it). No Date received / Days, Priority, Stage at exit or Via.
- **Excel** Invested sheet: Invested, Hedgehogs, Sambhav, Other, Rounds.
- **Sector allocation** (button on the summary line): a pie of amount invested **by sector** or **by year of first investment** (switch at the top) for the companies shown, with **All funds / Hedgehogs / Sambhav**. At most 8 slices (largest 7 + **Other**, neutral grey). Click a sector (slice or legend row) → a pie of that sector's companies; click **Other** → a pie of the folded sectors; click a company → opens its company file. Breadcrumb and Back return up. Hover shows amount, % and companies. The legend lists every slice's ₹ and %; colours are a validated colour-blind-safe categorical palette in fixed order, light and dark.

### 15.4 Company updates
- A dated news log per Invested company (fundraise, new plant, key hire, results…): date (not in the future), text; who added it. No categories, attachments or portfolio-wide feed (decision of 2026-10-20). Company file → **Updates** tab: add, edit, remove (two clicks), newest first; History notes.
- Invested table: the Comment column becomes **Latest update** (text, date, author, "N updates"), clicking opens the Updates tab. Update text is searchable. Excel Invested sheet: Latest update, Update date.
- Each update records its source (MANUAL now; WHATSAPP when WhatsApp intake for updates is added).

### 15.2 Quarterly tracker, contacts and meetings
The Invested tab has three views: **Portfolio**, **Quarterly tracker**, **Meetings**.

- **Quarterly tracker** (replaces the "Team Allocation - Results" sheet). Indian FY quarters (Q1 Apr–Jun … Q4 Jan–Mar), keys like `FY27-Q2`; opens on the last ended quarter, picker shows the current quarter and the 8 before it. Columns: Company (opens the company file on Investment), **Handled by** (Assigned PE), **POC** (primary contact), **MIS received**, **Result note**, **Remarks**.
  - **MIS received** and **Result note** are **uploads from the cell**: click → the files for that company and quarter (View for PDF/images, Download), **Upload files** (several at once) and **Upload a folder** (every file in it). Only the column's types are uploaded (MIS: PDF, Excel, CSV; result note: PDF, Word, Excel, PowerPoint, images); hidden/system files and other types are skipped and counted in the toast. Files are stored like any other (encrypted), with type MIS or Result note and the quarter, and also appear in Materials.
  - The tick is the India date of the first upload: MIS shows "✓ 12 Nov" once received, Result note "✓ Made 20 Nov" (plus "· N files" when more than one). Until then the cell shows just an **upload icon**. A result note is marked made **only** by uploading it.
  - **Other files** (2026-10-28): a third upload column for other quarterly files (SHA, SHP, cap tables, BG/CG details, …): any stored type, several at once or a folder; the cell shows how many. Never read by AI. Every quarterly file (tracker pop-up and company file → MIS & results) has **Move to** MIS / Result note / Other files, with a History note: moving out of MIS stops and discards its read; moving into MIS starts one.
  - **No MIS due date** in the tracker (removed 2026-10-27; any saved due dates are kept but not shown). **Show** filter: All companies / MIS not received / MIS received / Result note not made. Order **Needs action first** (MIS not received, then result note not made, then done) or Company A–Z.
  - Header: progress ("MIS received: 14/22", "Result notes made: 9/22").
  - Not included: Result made by, IPO/Exit tracking, Result update, Quarterly calls, Shared with BDO.
- **Contacts** (`CompanyContact`): several per Invested company on the Investment tab: name (required), designation, email (validated), phone; one is **Primary** (the first one automatically; marking another moves it). Used for the tracker's POC column and, later, a mail merge asking for MIS/data.
- **Meetings**: per company, date, type (Plant visit, Management meeting, Quarterly call, Other), status (Planned, Done, Cancelled; Done can't be in the future), who is going, notes / next steps. The Meetings view lists all portfolio meetings in **Needs updating** (planned, date passed), **Upcoming**, **Past**, filterable by person and company; Add, Mark done, Edit, Remove. Each Invested company's file has a **Meetings** tab.
- Every upload, remark, MIS due date change, contact and meeting change writes a History note.
- **Next: reminders** (weekly WhatsApp digest) and a mail merge to POCs requesting data.

### 15.3 Quarterly files and MIS reader (company file → Investment)
- **Quarterly MIS and results**: each quarter with its MIS and Result note files (View, Download), **Upload MIS** for a chosen quarter, and **Read figures** on any MIS file.
- **Read figures** now reads the whole MIS into the company's figures history (§15.11). The earlier quarter-only reader (Revenue / EBITDA / PAT / cash into `MisFigure`) is replaced; its saved rows were carried into the history.

### 15.11 Results generator, phase A: the figures history (2026-10-27)
The goal (phases B–D): generate each portfolio company's quarterly result (image + Excel, in the Niveshaay style, in a format locked per company) from its MIS. Phase A builds the data underneath.
- **Figures history per company:** line items (`MisLine`: label, section, unit, kind, order, other labels seen) and their values by period (`MisValue`: one per line per period, with where it came from: MIS file, result image, manual or import).
  - **Periods:** month `2026-07`, quarter `FY27-Q2`, half-year `FY27-H1`, year `FY27`, year-to-date `YTD-2026-09` (Apr–Sep). Balances are stored at the period they close (Mar-26 balance → `2026-03`).
  - **Units:** money is stored in ₹ Cr (converted from rupees, thousand, lakh, mn, cr, bn); percentages as percent; other numbers as printed with their unit label (e.g. "# lakhs", "INR/meter").
  - **Kind:** flow (adds up over time: revenue, costs, volumes), balance (period-end figure: cash, debt, users, AUM), ratio (recalculated, never added: margins, per-unit figures).
- **Reading an MIS** (any MIS file, Read figures): scope is the P&L and key business metrics (volumes, users, AUM, cash, debt, working capital, capacity, headcount totals); not detailed ageing, loan-facility, customer or order lists. Actuals only: never budget, plan, variance or % of revenue columns.
  - **Excel:** the model maps the structure (which sheet/rows are in scope, which columns are which periods, units, kind); **figures are read straight from the cells** at full precision, never copied by the model.
  - **PDF:** the model maps the structure, then copies each figure as printed in batches; every figure must be found in the file's text, misses are flagged.
  - **Checks:** months that don't add up to a printed quarter (flows), and values that differ from what's already saved, are flagged.
  - **Matching:** rows match existing lines by section and label (or a label seen before); otherwise they're new. The review lets you rename, change unit/kind, merge into an existing line, or leave rows out.
- **Cost and scope** (2026-10-28): reading uses cheap, fast models: `OPENROUTER_MIS_MODEL` (default DeepSeek V4.1 Flash) for Excel and images, `OPENROUTER_MIS_PDF_MODEL` (default Gemini 3 Flash, which reads PDFs; Flash-Lite missed the operating metrics) for PDFs; same `data_collection: "deny"`. Only what a result needs is read: (1) the main P&L at summary level, and (2) the **operating metrics**: every metrics table's total and its first-level breakup, e.g. assets split into fee-based and non-fee-based (AUM, users/investors, orders, inflows, loan book, disbursals, subscriptions, volumes, capacity, cash, debt, …), periods ending in the last 15 months; everything else in the MIS (channel/segment P&L splits, sub-ledgers, metric sub-splits, balance-sheet detail, lists, cap tables, SHA) is skipped. Once a company has a saved result format, only that format's lines are read. Balances are also checked: a quarter's figure must equal its last month's. Measured on real files: an Excel MIS about $0.01–0.03, a PDF about $0.07, a result image about $0.002, 15–75 seconds (was $0.3+ and 2–7 minutes).
- **An MIS is read automatically when it's uploaded** (2026-10-28), from the company file or the Quarterly tracker (several files or a folder too): PDF, Excel and image MIS files of Invested companies, when AI is set up. Result notes are not read automatically (Read figures on one does it). The figures still wait for review before they're saved. The Results view says when a company has MIS files still being read or waiting for review, with a link to the company file.
- **Reading runs in the background** (2026-10-28): a large MIS takes minutes, longer than a web request can wait. Uploading an MIS (or **Read figures**) queues a read job (`MisReadJob`, DB-backed like summaries: survives a closed tab or a restart; a stuck job is retried once). The company file shows each job: "Reading <file>…", **ready to review** (Review, Discard), or **couldn't be read** (Try again, Dismiss); it updates by itself. Results are matched to the saved lines when the review opens. Saving the review closes the job. The model gets three tries at a well-formed answer.
- **Review before saving** (full-screen): every row and period, editable, with flags; **Save** writes the figures (History note per file). Nothing is saved before that.
- **Figures grid** (company file → MIS & results): sections × periods, switchable Months / Quarters / Half-years / Years / YTD; click a cell to edit or clear; add a line or a period by hand; rename, re-unit, re-kind, move or delete a line. Each value shows where it came from.
- **Past results** (2026-10-28): result notes can also be images (PNG, JPG, WebP) in the tracker and the company file. **Read figures** works on result-note files too (image, PDF, Excel); figures read from one are saved with source "result". An image has no text to check against, so the model reads it **twice, independently**: any figure where the two readings differ is flagged with both, and rows found in only one reading are flagged. Growth columns (YoY, QoQ, % change) are never read as figures.
- **Paste from Excel** (2026-10-28): company file → MIS & results → Figures → **Paste from Excel**. Copy a table from Excel (period headers across the top, line names down the first column) and paste it; pick the money unit (default ₹ Cr) and a section (default "P&L"). Headers are recognised as periods: `Q2 FY27`, `Q2FY27`, `2QFY27`, `Q2 FY2027`, `H1 FY27`, `FY26`, `FY 2025-26`, `Sep-26`, `Sep 2026`, `Sep'26`, `2026-09`, `YTD Sep-26`; other columns (growth, notes) are skipped and listed. A row with a name and no figures starts a new section. Labels with "%" or "margin" are percentages (ratio); everything else is money (flow); both can be changed in the review. No AI. Figures go through the same **review** before saving, with source "import".

### 15.12 Results generator, phase B: period calculator, format builder, live preview (2026-10-28)
- **Where:** Invested tab → **Results** view (next to Portfolio, Quarterly tracker, Meetings). Pick a company and the result's **quarter**; the builder sits beside a **live preview** that redraws on every change.
- **Period calculator** (pure, unit-tested): a figure for any period comes from what's saved, else is worked out, and the preview shows how on hover ("Q1 FY27 + Q2 FY27"):
  - **Flows** add up: quarter = its 3 months; half = 2 quarters (or 6 months); year = 2 halves or 4 quarters (or 12 months); year to date = the quarters or months so far. Differences too: Q2 = YTD Sep − YTD Jun (or H1 − Q1), Q4 = FY − YTD Dec (or H2 − Q3), H2 = FY − H1. YTD Jun = Q1, YTD Sep = H1, YTD Mar = FY.
  - **Balances** are the figure at the period's last month (FY27 balance = Mar 2027 = Q4 FY27).
  - **Ratios** are never added up: only a saved value for that exact period, or a ratio row in the format (below).
- **Format** (one per company, `ResultFormat`): a title (company name), **columns** and one or more **tables** of rows, a footnote.
  - **Columns** are relative to the chosen quarter, so a locked format works every quarter: this quarter, previous quarter, same quarter last year, this half-year, previous half-year, same half last year, this year (FY), last year, year to date (shown as "6M FY27"), same YTD last year; and **Change (in %)** between two of them. Labels can be renamed (e.g. "QoQ change (in %)").
  - **Rows:** a **line** from the figures history; a **heading** (e.g. "Expenses", no figures); a **ratio** (one line ÷ another, as %: margins, "as % of Net revenue"); a **formula** (lines added or subtracted, e.g. Gross profit = Revenue − COGS when the MIS doesn't give it). Each row has a label and a style: **key** (dark green label, light green figures: Revenue, Gross profit, EBITDA, PBT, PAT), **normal**, **sub** (italic, indented: "as % of Net revenue"). Rows move up and down.
  - **Tables:** each has its own caption in the header row ("Rs in Cr", "Key operating metrics") and repeats the column headers.
  - **Figures:** money to 2 decimals, percentages to 2 decimals with "%", negatives with a minus (as in past results), no thousands separators. Change = (this − base) ÷ |base|; percent rows have no change. With **NM for losses** (default) a change is "NM" when either figure is negative or the base is zero, and the note "NM = not meaningful (loss in current or base period)." is added under the table.
- **Recommended format** (until one is saved): the P&L section's lines in order, key rows by name (revenue, gross profit/margin, EBITDA, PBT, PAT), a margin ratio under gross profit, EBITDA and PAT when the MIS doesn't have one; columns this quarter, previous quarter, change, same quarter last year, change; for a Q4 also this year, last year, change. (An AI-suggested format from a past result is phase D.)
- **Save format** and **Lock format** (History notes). A locked format can't be edited until it's unlocked; the preview still follows the quarter. Cells with no figure show "–" in the builder preview with a count; output (phase C) leaves them blank.
- **Look:** the Niveshaay result style from past results: light blue title band with the company name and the Niveshaay logo, navy header row, dark green key labels with light green figures, light green normal labels with white figures. These are fixed brand colours for the result (a document), the same in light and dark mode.
- **Phase C, output (2026-10-28):** under the preview, **Download image** (PNG, drawn in the browser at 2× for sharp text, same look as the preview, logo included, no builder marks) and **Download Excel** (built on the server: same colours, fonts and layout, title band with the logo, figures as numbers with number formats so they can be reused; change and margin cells as text like the image). Downloads save nothing.
  - **Save as result note** saves both files as that quarter's **Result note** (the tracker's "Made" tick, Materials, History), **only when clicked**. It needs the format saved first (no unsaved changes), and asks before adding to a quarter that already has a result note. File names: "<Company> result Q2 FY27.png" / ".xlsx".
- **Next:** phase D, AI-suggested format from a past result.

### 15.13 Numbers dashboard (company file → Numbers, 2026-10-29)
- One company's figures, **quarterly**, inside its company file (not portfolio-wide), laid out like a portfolio-monitoring dashboard. Read-only: figures are added and corrected in the figures grid below it or through MIS reads.
- **Which figures:** the rows of the company's saved result format (else the recommended one, §15.12): lines, ratios (margins) and formulas, with the format's labels; headings are skipped. Then **operating metrics**: figures-history lines that aren't in the format and aren't P&L lines (AUM, users, orders, assets with their fee-based / non-fee split, cash, …).
- **Periods:** the last 8 quarters up to the latest quarter with figures; an **Up to** picker looks at an earlier quarter. Values come from the period calculator (§15.12), so worked-out figures count (a quarter from its months, Q4 from FY − 9M); quarters with no figure at all at either end are dropped.
- Top to bottom:
  - **Headline tiles:** revenue, EBITDA, PAT, then other key money rows (up to 4), each with QoQ and YoY change and its margin; **revenue over the last 12 months** (with YoY) when 4 quarters are in; **cash** at quarter end when the figures have a cash line.
  - **Quarterly trend:** one chart per key row: bars per quarter (losses below the line in brick), the row's margin (a ratio to revenue in the format) as a gold line over the bars on its own scale with a legend; percent rows not tied to a figure as a line. Latest figure, QoQ and YoY above each chart.
  - **Splits:** a total whose parts add up to it, found automatically: parts labelled "<total> – <part>", or the 2–8 lines right after (or before) it in the same table that sum to it (within 1.1%) in every quarter where all have figures (one miss allowed). Costs and profits are never parts (Revenue = COGS + Gross profit is not a split). Each split: a **donut** for the latest quarter with a legend (figure, share, YoY per part) and **stacked bars by quarter**. The revenue split comes first, labelled "Revenue split".
  - **Operating metrics:** charts for up to 6 metrics with two quarters or more (not the parts of a split).
  - **All figures:** one table: result rows (a split's parts indented under their total), then operating metrics; a trend sparkline, one column per quarter, then QoQ and YoY (NM rule as the result; percentages in points). Indian grouping, money to 2 decimals, negatives in brackets, tabular numerals; scrolls sideways on phones. **Copy table** copies it tab-separated to paste into Excel.
- Charts are plain SVG in the app's colours (splits in the sector pie's palette), light and dark; each has a text alternative.
- **Make result** opens Invested → Results on this company. With no figures: the empty state says to upload an MIS (read automatically) or paste from Excel below.
- **Overview → Key numbers:** the first 4 headline tiles for the latest quarter with the change vs the same quarter last year, and a link to Numbers.
### 15.5 Company file for Invested companies (2026-10-20)
- Tabs (simplified 2026-10-29, six to four): **Overview** (invested by fund, key numbers of the latest quarter, latest update, contacts, rounds) · **Numbers** (the numbers dashboard, §15.13, then the quarterly MIS / result note / other files with background reads, then the editable figures grid in a collapsed section) · **Updates** (company updates, then meetings) · **Files** (materials, the deck summary in a collapsed section, comments, then the change log). Links to the old tabs land on their new home (MIS & results → Numbers, Meetings → Updates, History → Files). Pipeline and Rejected companies keep Summary · Materials · Comments · History.
- Banner: "First invested <date> · ₹ X Cr in N rounds". "Restore to pipeline" and "Change date received" sit in a **More** menu.

### 15.6 Rejected tab sort
- Sort options include **Date rejected, oldest first** (the default on the Rejected tab) and newest first. Each tab opens on its own default sort (Pipeline: priority; Rejected: date rejected oldest first; Invested: amount invested).

### 15.7 Idle deal reminders on WhatsApp (2026-10-23)
- **Who and what:** Pipeline companies only. Each assigned **PE** (not Research or Via) whose WhatsApp number is saved and whose reminders are on.
- **Last activity** of a company: the newest of any History entry (stage, priority, assignment, field edit, file upload or removal, summary generate or edit), any comment, or when it was added. Dates are Asia/Kolkata.
- **Rule:** the first reminder goes when a deal has had **7 days** with no activity; then **every 3 days** while there is still none (day 7, 10, 13, …). Any activity resets it. A newly assigned PE counts as activity.
- **Sending:** once a day after **10:00 IST** (a per-day lock means one send even across restarts). One message per person listing all their due deals with days idle and stage, most idle first. Each (company, person) reminder is logged in `ReminderLog`; a failed send isn't logged as sent, so it retries the next day. Message contents and numbers are never logged.
- **WhatsApp panel** (PE team bar → **WhatsApp**): every PE-list name with their WhatsApp number (digits with country code; a 10-digit Indian number gets 91), a reminders on/off switch, **Send test**, and their deals idle 7+ days. Shows a notice when WhatsApp isn't connected. The same numbers recognise senders in WhatsApp intake (§14).

### 15.8 Research assignment messages on WhatsApp (2026-10-23)
- When a name is **newly added** to Assigned Research (editing the cell, or adding a company with Research filled in), that person gets a WhatsApp: "Hi Riya, you've been assigned *Zooto* (Consumer) on the deal pipeline. Keyur and Arjun from the PE team are working on it with you. The deck is attached below." Then the company's **latest deck** (decrypted from storage, sent straight to Evolution as a document; never a link). With no PE: "No one from the PE team is assigned yet."; with no deck: "There's no deck on the dashboard yet."
- Names already on the company aren't messaged again; removing someone sends nothing. Any status.
- Sent after the assignment is saved; it never delays or fails the save. The outcome per person goes in the company's **History** ("WhatsApp sent to Riya: assignment message and Deck.pdf", "No WhatsApp sent to Riya: no number saved", "… failed").
- Needs the person's number in the **WhatsApp** panel (PE team bar → WhatsApp), which lists the PE team (idle reminders, §15.7) and the Research team. "Messages on" off = no messages of either kind.
- Each person in the panel has **Rename** (changes the name everywhere: table, PE team bar, suggestions; companies link to the person, not the name; "Renamed A to B" in each of their companies' History; refused if the new name is already someone else's) and **Delete** (confirm shows how many companies they're on; removes them from every company's PE / Research / Via, recorded in each History, then from the list).

### 15.9 Scuttlebutt team (2026-10-24)
- A sub-team within Research: **Rohit (head), Mohit, Diya, Hardik**. No separate column; they're assigned through **Assigned Research**. Stored on the person (`TeamMember.team = "SCUTTLEBUTT"`, `teamHead`); one head per team.
- When a Scuttlebutt member (not the head) is **newly** assigned a company, they get the usual §15.8 message and deck, and the **head** gets: "Hi Rohit, Diya from the Scuttlebutt team has been assigned *Zooto* (Consumer) on the deal pipeline. PE: Keyur, Arjun. The deck is attached below." plus the deck. Several members at once are named together. If the head is also on that company's Research, the alert goes without the deck (they already have it). No alert when the head is the one assigned. Outcome in the company's History.
- **WhatsApp panel:** sections PE team, Research team, Scuttlebutt team (head first, tagged Head). Each person shows once (a team first, then PE, then Research). Research and Scuttlebutt rows have a **Team** choice (Research / Scuttlebutt / Scuttlebutt head; choosing a new head replaces the old one). **Add a person** (name + team) adds someone to the Research list before their first assignment.

### 15.10 Portfolio news agent (2026-10-24)
- **Watched:** Invested companies only. Each has a **news watch** (company file → Overview → News watch): search names (legal and brand names, distinctive enough not to match unrelated news), website, LinkedIn company page URL, on/off. A company without one is searched by its dashboard name until someone fills it in.
- **Sources, checked twice a day, at 09:00 and 18:00 IST (2026-10-29; was four times):** Google News search (India edition) for the search names, last 2 days; LinkedIn company posts via Apify (`harvestapi/linkedin-company-posts`, no cookies), posts since the previous LinkedIn check (first run: 3 days). LinkedIn needs `APIFY_TOKEN`; without it, news only. Every item seen is stored once per company (`NewsItem`, unique by URL), so nothing is checked or sent twice.
- **AI filter** (OpenRouter, cheaper check model, `data_collection: deny`): per company, the new items plus the last 30 days of updates. For each item: is it really about this company; is it **material** (product launch, big order or contract, fundraise / valuation / M&A / IPO, expansion or new capacity, key management change, regulatory or legal action, financial results, negative news such as fraud, default, layoffs, accidents, disputes); is it a repeat of something already recorded; category; importance (high: big order, fundraise, M&A / IPO, negative, regulatory or legal, key exit; else medium or low); a one-line summary. Not material: routine marketing, hiring posts, events, greetings, thought leadership, minor awards.
- **Stored:** material, non-repeat items go straight into the company's **Updates** (source NEWS or LINKEDIN, with the link, category and importance), dated by publication, added by "News agent". Anyone can edit or remove them. They count as the Latest update in the Invested table.
- **Repeats:** the AI compares each item with the company's updates from the last 30 days and with material news found earlier in the same check (any batch), and with earlier items in its batch; a repeat is stored but never added or sent.
- **WhatsApp** only to the group in `NEWS_WHATSAPP_GROUP` (the team's "PE Portfolio Updates"); never the deck-intake group. Unset = no news messages (news still goes into Updates). **one message per material item, no clubbing**, right after the check that found it, high importance first and headed "Big news". Each has the company, category, one-line summary, date and a **short link** `APP_URL/n/<7-character code>` that redirects to the article or post (original link when `APP_URL` isn't set). No message when nothing is found. A failed send is retried after the next check (items up to 3 days old).
- **Check now** on a company's News watch runs that company immediately (same storing and messages).
- Never log article text, posts or AI output; ids and counts only.

### 15.14 Events tracker (2026-11-02)
- **Purpose:** the events worth the team's time: investor and founder networking (PE / VC showcases, investment bankers' conferences, family office forums, our own Dhando Valley) and the top sector expos where Indian VC and PE money is moving (space, defence and drones, batteries and storage, renewables, semiconductors and electronics, robotics and deep tech, water, recycling, mobility, logistics, fintech).
- **Where:** an **Events** tab next to Invested. Upcoming events by month, then **Dates to be confirmed**, then Past (behind a toggle). Filters: type, sector, status, Top events only, search.
- **Each event:** name, type (Investor and founder networking, Investment banker, Family office, Sector expo, Our event), sector, organiser, city, venue, what it is, start and end dates (or "Date to be confirmed" with a hint such as "Last held 10–11 Mar 2026"), link, tier (Top or Worth a look), why it matters, status (New, Interested, Going, Skipped, Attended), who is going, notes. **Check dates** shows until someone confirms the dates against the organiser. Anyone can add, edit or delete.
- **Starting list:** researched events, added once when the app starts. A date is marked confirmed only when official or several independent sources agree. Nothing is invented: when no date is known it stays blank.
- **Scan twice a week, built to stay cheap:** Mondays and Thursdays from 09:00 IST. Google News (free) for targeted searches (investor ones plus one per tracked sector, §15.15), last 4 days, and the latest posts of a fixed list of organisers' LinkedIn pages via Apify (at most 5 posts a page). A keyword check drops anything that doesn't look like an event **before any AI is used**, every URL is judged only once (`EventSeen`), and each run is capped at 40 items, 6 AI batches. Target: under $1 a month.
- **Listing sites (added 2026-11-02):** the same scan reads free listing sites, because expos are announced there more than in the news: EventsEye (India list), TradeIndia (India page and relevant categories) and Eventbrite (venture capital, private equity, family office and angel investor searches, in person only). A free keyword check keeps our sectors, upcoming in the next 15 months, the same event from two sites counted once and events already tracked with dates skipped. At most 40 listings reach the AI each scan, soonest first. A listing's own dates, city and venue are used, never the model's reading of them. The first read happens once, straight after deploy, with up to 250 listings: those events are added to the tab without a message each, and the group gets one summary.
- **AI filter:** cheap check model, `data_collection: deny`. Keeps only real upcoming events in India (or aimed at Indian investors) that fit the scope, with name, type, sector, tier, dates and city as stated in the item. It never guesses dates. Found events are always **Check dates** and status New, and are matched against existing events by name and year: a match only fills in dates that were blank, and never overwrites the team's edits.
- **WhatsApp:** the **PE Events** group (`EVENTS_WHATSAPP_GROUP`) gets one message for each event the scan adds (NEW EVENT or NEW TOP EVENT), and one when the scan finds dates for an event that had none (UPDATED EVENT). Each has date, city, venue, type and sector, what it is, why it matters and a link. Nothing is sent for the starting list, for events the team adds or edits, or for events already over. Messages wait if the group isn't set. Never twice: the scan's AI is given the tracked list and links an item to a tracked event even under another name, and an event is marked as told before its message goes, so a failed send is retried but a restart can't repeat it.
- Never log article text, posts or AI output; ids and counts only.

- **Owner and reminders (2026-11-03):** each event can be assigned to one person in the PE team (Assign… on the row, or Assigned to in the form). The owner gets a WhatsApp reminder 7 days and 2 days before the start date (from 09:00 IST), once each; a missed 7-day reminder goes at the next check, and an event assigned within 2 days gets only the 2-day one. A new owner or a new date starts the reminders afresh. Skipped events and owners without a WhatsApp number get none (the row says so).
- **Tighter focus (2026-11-04):** fewer, better events.
  - **Top priority sectors** (a switch per sector in Sectors we track; to start: data centres and AI infrastructure, AI and software, semiconductors and electronics, defence and aerospace, space, and healthcare with pharma innovation and CDMO): every established national or international show, summit or convention where the sector's leaders and buyers gather, including industry conventions with an awards night (e.g. W.Media's Cloud and Datacenter Conventions). Standalone award ceremonies, city editions of generic trade fairs and dealer shows are dropped.
  - **Every other sector:** only the flagship national event (Top). The code enforces this after the AI, so a "worth a look" expo outside the priority sectors is never added.
  - **Each sector has a focus** telling the AI what counts. Healthcare means pharma innovation, CDMO / CRDMO, APIs, biotech and medtech innovation; not ayurveda, wellness, health tourism, nutraceuticals, hospital supply or pharma packaging fairs.
  - **Networking:** only curated investor and founder events by recognised organisers (IVCA, TiE, VCCircle, funds, banks). Open ticketed mixers, happy hours and pay-to-pitch events are dropped.
  - **Wider net for the priority sectors:** the free keyword check also knows convention, congress and CDC, and the news searches include W.Media's CDC series, pharma CDMO and AI infrastructure.
  - **Clean-up:** events already in the tab that fail these rules are marked Skipped, not deleted (the status filter still shows them). Events from the starting list, events the team added, and events someone has assigned or changed status on are left alone.
- **Only 10 days before, only top events (2026-11-17), replacing the WhatsApp rules above:**
  - The PE Events group gets one message per event: 10 days before it starts, and only when its dates are confirmed. No message when an event is found or its dates are found, and no summary after a listing read. An event confirmed inside the 10 days goes at the next check.
  - Sector expos and networking events are kept only when they are the top events of their category (Top); the code drops the rest after the AI. Investment bank conferences and family office forums are their own category and are kept.
  - Sectors with no VC money behind them (Water, Recycling: nothing in the Funding tab) are switched off once; the team can switch them back on.
- **Confirmed dates only (2026-11-05):** the PE Events group hears only about events whose dates are confirmed. A found event waits in the tab with **Check dates**; clicking it (after checking with the organiser) confirms the dates, and the group gets the message at the next check (within 30 minutes). The 10-day message also needs confirmed dates. Owner reminders (7 and 2 days) still go, since someone took the event on.
- **When the PE Events group hears (2026-11-03):** once when an event is first found (Monday and Thursday scans) or its dates are found, and again 10 days before it starts ("Coming up in 10 days", from 09:00 IST). An event found or dated inside the 10 days gets one message that says both. A new start date starts the 10-day message afresh. Skipped events get no countdown. Messages show the owner when there is one.

### 15.15 Tracked sectors and the funding check (2026-11-02)
- **Purpose:** the events tracker follows where money is going, not a fixed list. Sectors live in the database (`EventSector`), each with its keywords (the free listing check) and news search.
- **Starting list:** the portfolio's sectors plus what 2026 funding shows: AI and software, data centres and digital infrastructure, healthcare and life sciences. Climate tech sits under Renewables. Real estate and roads are left out even though money goes there: they are asset classes, not what this fund backs.
- **Monthly check:** once a month from 10:00 IST, up to 150 funding headlines from the last 30 days (Google News, free) and our deck counts by sector for the last 90 days (counts only, no company names) go to one cheap AI call. It groups deals by sector, writes a two-sentence summary and may suggest a new sector.
- **Adding a sector is checked by code, not left to the AI:** at least 4 real headlines behind it, not an excluded field, no overlap with any listed sector (including switched-off ones), at most 2 a month. A new sector is added on its own, with a quiet re-read of the listing sites and one summary.
- **Team control:** Sectors we track, at the bottom of the Events tab: the latest check, and a switch per sector. Switched-off sectors stop being searched and are not added back.
- **WhatsApp:** none (2026-11-03). The check is silent; funding reaches the team through the weekly and monthly letters (§15.16).
- Target: about 1 US cent a month. Never log headlines or AI output.

### 15.16 Funding tab (2026-11-02)
- **Purpose:** an Entrackr / Inc42 style view of where Indian startup and growth equity went, for a month or a week, with an editor's column on what it means for us.
- **Deals:** read from Google News (Entrackr, Inc42, VCCircle, Mint, YourStory, Economic Times) twice a day (08:00 and 18:00 IST, last 3 days). A cheap model reads the headlines in batches of 60; code then decides what counts. Left out: talks and plans, IPOs, QIPs, block deals and other listed-share trades, non-Indian companies, roundups. Rounds reported by several outlets merge into one deal (same company key and kind within 30 days), keeping every source (up to 6). Rupees convert at ₹90 to the dollar. On first start the app reads last month, the month before and this month so far, one per tick.
- **Filling gaps (2026-11-27):** a headline often leaves out the amount, the lead, the round or what the company does. After each read, every equity round from the last 45 days that is missing one of these (and that the team has not edited or left out) is looked up on the web: one search per round with the cheap model (OpenRouter's web search, about US$0.01 a round), at most 20 rounds a run and 2 tries a round on different days. Code keeps a filled field only when the search results back it: the amount only when the exact words stating it appear in a result that also names one of the round's investors (so an earlier round of the same company is not taken), the lead and the round only when a result names them, what the company does (at most 8 words) whenever found. Results that name the company are added to the round's sources (up to 6). Existing values are never overwritten; a later team edit wins as before. Logs counts and costs only.
- **Only equity counts.** Debt and acquisitions (including PE buyouts) are stored so the column can mention them for contrast, but appear in no figure, chart, tile or table.
- **Team corrections:** Edit (company, sector, type, amount, round, lead) or Leave out on any round. An edited deal keeps its fields; later reads only add sources. Left-out deals stay stored so they are not added back.
- **The tab:** month chips (this month so far and earlier months) and a week picker. Key figures: equity raised and rounds (with change on the previous period), median round, largest round, growth and late-stage money, and the Entrackr monthly total when its report headline is found (else the top sector). The editor's column. A "Companies we have seen" strip for rounds raised by companies in our own deal list. Charts: money by sector, rounds by stage, round sizes, biggest investors by money (each round credited in full to its lead, since reports rarely give shares) and most active lead investors. Colourful sector tiles ranked by money, each with an icon, amount, rounds and share; selecting one opens the editor's take on that sector and every round with its sources.
- **The column:** written by `OPENROUTER_FUNDING_MODEL` (default Claude Opus 5.5, about $0.20 a month) from the deal list, our deck counts by sector for 90 days and our portfolio by sector (counts only). Monthly from the 3rd of the next month (or once Entrackr's report is found): headline, standfirst, 4 to 5 paragraphs, 3 takeaways for us, 2 things to watch, and a take per sector. Weekly every Monday from 10:00 for the week before (or the next day it is still missing): headline, 2 paragraphs, 2 to 3 highlights (about $0.05). A month still in progress shows its latest weekly note.
- **Fact check:** every dollar figure and percentage in the text must match a deal, a sector or kind total, a sum of two deals in one sector, the period totals, the previous period or the benchmark, or a round threshold. One corrective retry; any figure still unmatched is listed under the byline.
- **The letter (PDF):** each note is sent as an A4 PDF in the style of a fund's LP letter (fixed Niveshaay colours, IBM Plex Sans and Source Serif 4 from `assets/fonts`): a green cover with the headline, key figures and what it means for us (the weekly cover lists the biggest rounds); the editor's letter with linked company names; charts (money by sector, rounds by stage, round sizes, biggest investors by money, most active leads); the editor's take on each sector (monthly); and every equity round as an appendix, with a note on method. "Letter (PDF)" in the Funding tab downloads it (`/api/funding/letter/<period>`). Rendered with `@react-pdf/renderer`.
- **WhatsApp:** both notes go, as the PDF with a short caption, to the portfolio updates group (`NEWS_WHATSAPP_GROUP`; `FUNDING_WHATSAPP_GROUP` overrides it), once each, with a link to the tab (`APP_URL/?view=funding`). Notes more than 10 days old are never posted.
- **Funding-only deployment (2026-11-03):** the same code with APP_MODE=funding, on its own address, for people outside the PE team. It shows only the Funding tab and its PDFs, read-only (no Edit or Leave out). 
equireRole() refuses every other page, action and file route (403), so nothing else can be reached even directly; "Companies we have seen" and every mark of our own pipeline are removed on the server; no background jobs run there (the main app runs them). Each note has two versions: the team version (sent to WhatsApp, shown in the main app) is written with our portfolio, deck counts and which companies are in our deal list; a separate shareable version (`publicData`) is written without any of that, for growth investors in general, and is the only one the funding-only deployment shows, on screen and in the PDF. The job writes the shareable version after each note (one try a day per note). About $0.20 a month more.
- Never log headlines or AI output; counts, ids and costs only.

## 16. Non-goals (for now)

- Email ingestion
- Notifications other than the idle deal reminders (§15.7), Research assignment messages (§15.8), news alerts (§15.10) and event alerts (§15.14)
- A banker column
- Deck page references in summaries
- Parked status
- Rejection reason categories (still a non-goal after §17: a rejected company's theme comes from the company, not from its reason)
- Details captured on Invest

## 17. Thesis and analyst read

- **Purpose:** the pipeline holds about 43 deals and no clear order to work them in. Each deal gets an **analyst read**: outside research, reasoning against the thesis, and scores out of 10 with the sources shown. One overall score ranks the pipeline.
- **The rule that outranks every other rule here:** the tool ranks, it never decides. The words invest, pass, reject, recommend, buy and avoid never appear in a label, tooltip, export or judgement text about a read. No score hides, blocks, auto-rejects or reorders a deal against the user's chosen sort.
- **A deck is a claim, not a fact.** A read checks what the deck says against sources outside the company and says which claims held, which did not and which could not be checked.
- **No matching against past deals.** The thesis is given to the reader as a way of thinking. A score is never set by resemblance to a named holding or a named rejection, and nothing in the read says "closest to".
- §9.3 stands: the summary still carries no ratings, risks or red flags. The read lives in its own tab and its own tables.
- The thesis is data, not a prompt. It is loaded from `thesis/thesis-seed.json` (built from the team's `thesis.md`), versioned, and shown in a Thesis tab with the evidence behind every line.
- **Version 1 of the rating was withdrawn on 2026-11-23** (§17.13). It scored 1 to 5 from the deck alone and placed deals on ladders of past deals. This section replaces it.

### 17.1 The thesis as data

- **Rows.** One `ThesisRow` per line of the thesis. `kind` is one of PRINCIPLE, THEME, PARAMETER, ANCHOR, FLAG, HIGHLIGHT. `code` is stable across versions (PR01, T06, F1, FL08, H01; anchors are `F1:5:1`). `data` holds the row's fields as JSON, validated by `thesisRowZ` in `src/lib/domain/thesis.ts`. `evidence` is the citation string as written in the source. `decision` names an open decision the row waits on (for example "D9"), or null.
- **PARAMETER and ANCHOR rows are not used by the read** and are not shown. They stay in the database until a later thesis version drops them from the seed.
- **Versions.** Rows are never edited in place. A change closes the old row (`toVersion` = the new version) and writes a new one (`fromVersion` = the new version). Current rows have `toVersion` null. `ThesisVersion` records the number, a label ("1.2"), a note and who made it. Any past version can be rebuilt with `fromVersion <= v AND (toVersion IS NULL OR toVersion > v)`.
- **Import.** `npx tsx scripts/thesis-import.mts thesis/thesis-seed.json` writes a new version from the file: unchanged rows are left alone, changed rows are closed and rewritten, rows missing from the file are closed. Running it twice with the same file changes nothing. It prints counts only.
- **The seed file is confidential** (it names holdings and rejected companies). `thesis/` is git-ignored. The import runs from a developer machine against the database; production needs no seed step.
- **Row fields**
  - PRINCIPLE: `text`.
  - THEME: `name`, `status` (CORE, EMERGING, CAUTIONARY, NO_VIEW, UNRESOLVED), `priority` (boolean), `crossSector` (boolean: a tag, never a company's theme), `latestEvidence`, `basis`, `exceptions`, and the mapping lists `sectors`, `fundingSectors`, `eventSectors`, `keywords` (§17.2).
  - PARAMETER, ANCHOR: as imported; unused.
  - FLAG: `name`, `fact`, `why`, `how` (CODE, DECK, STAGE or LATER).
  - HIGHLIGHT: `name`, `firesWhen`, `shownAs`.

### 17.2 Themes: the shared key

The dashboard has three sector lists that do not share anything: the pipeline's `Sector` table (§8), `FUNDING_SECTORS` and the events tracker's `EventSector`. Themes join them. No list is renamed or merged.

- **Mapping lives on the theme row:** `sectors` (names from §8), `fundingSectors` (names from `FUNDING_SECTORS`), `eventSectors` (names from `EventSector`), `keywords` (lower-case fragments, matched like `EventSector.keywords`). One sector can map to several themes (Energy Transition maps to meters, solar, storage and hydrogen); keywords tell them apart.
- **A company has at most one theme:** `Company.themeCode` (nullable) and `Company.themeEdited` (true once a person has set it, same pattern as `sectorEdited`). A person can change or clear it from the company file; that writes an `AuditLog` row.
- **How a company gets its theme**
  1. A person set it: kept.
  2. A read is loaded for it: the read's theme is used, including "no theme" (§17.11). A keyword guess must not outlive a researched answer.
  3. Everything else: `scripts/theme-backfill.mts` asks the cheap check model (the one the news filter uses) in batches of 60, giving only name, sector and sub-sector, and the list of theme codes, names and keywords. The answer must be a current theme code or null. Invested companies listed under `holdingThemes` in the seed file take that value and skip the model.
- **A theme is context, never a score.** A cautionary theme does not lower a read. The read's Thesis fit score weighs principles first (§17.7).
- **Code-only joins used by the Thesis tab** (pure helpers in `src/lib/domain/thesis.ts`, unit-tested):
  - `dealsForTheme(theme, deals)`: a `FundingDeal` belongs to a theme when its sector is in `fundingSectors` and, if the theme has keywords, `company` or `what` matches one.
  - `eventsForTheme(theme, events)`: `Event.sector` is in `eventSectors`.
- Cross-sector themes (`crossSector` true) are never assigned to a company. They are listed in the Thesis tab only.

### 17.3 Thesis tab

A **Thesis** tab after Funding (a side view like Events and Funding; URL `?view=thesis`). Not shown in the funding-only deployment.

- **Header:** "Thesis, version 1.2" with the version note and date, and a version picker (read-only for older versions).
- **Sub-views** (chips): Themes (default), Principles, How deals are scored, Flags and highlights, Waiting for a read.
- **Themes:** one row per theme, sorted Core, Emerging, Unresolved, No view, Cautionary, then by code. Each shows: name, status badge, a "Priority" badge when set, latest evidence (with "Stale" when older than 12 months and parseable), and three counts: holdings (number and ₹ Cr invested), pipeline deals, rejected. Selecting a row opens the theme page (§17.4).
- **Principles:** the list, each with its evidence line and an "Open: D9" label when `decision` is set.
- **How deals are scored:** the five scores and the overall score with their questions and the scale, as written in §17.7, and the research rules of §17.6 in short. Static copy.
- **Flags and highlights:** the two lists with what each records.
- **Waiting for a read:** Pipeline companies with a deck that have no read, or whose read is out of date (§17.7). Columns: company, stage, priority, days, reason ("No read yet", "New deck since the read", "Thesis changed since the read", "Read is over 90 days old"). Sorted by priority, then days waiting. A count shows on the chip. This is the work list for whoever writes reads.
- Every thesis row shows its evidence string as written. No editing in this version (§17.13).
- **Status colours:** Core uses the existing positive tone, Emerging the neutral accent, Cautionary the existing warning tone, Unresolved and No view grey. Only CSS variables from §11.

### 17.4 Theme page

`?view=thesis&theme=T06`. Everything here is a join on existing data; no AI.

1. **Header:** name, status, Priority badge, latest evidence, basis, known exceptions, evidence line.
2. **Holdings:** Invested companies with this theme: name (opens the company file), ₹ Cr invested by fund, first invested.
3. **In the pipeline:** deals with this theme: name, stage, Read score with confidence, highlight chips, days. Sorted by Read, highest first, unread last.
4. **Rejected:** name, date rejected, reason as written. Newest first, 20 at a time with "Show more".
5. **Money raised in this theme:** equity `FundingDeal`s from the last 90 days via `dealsForTheme`: company, amount, round, lead, date, with the existing "In our pipeline / Rejected by us / In our portfolio" mark. A total line. Empty state: "No rounds reported in the last 90 days".
6. **Events coming up:** via `eventsForTheme`, next 6 months, soonest first.

### 17.5 The analyst read

- **Who writes it.** Claude, working in a chat on the team's own subscription with web search, reading the dashboard's summary of the deck and the current thesis. The dashboard does no AI work for a read and spends nothing on OpenRouter for it. The dashboard stores, checks and shows the read.
- **One read is one JSON document**, validated by `readZ` in `src/lib/domain/read.ts` (pure, unit-tested). Shape:

```
schema: 1
company: the company's name exactly as in the dashboard
readAt: date         thesisLabel: "1.2"        author: who wrote it        deckFile: the deck the summary came from, or null
oneLine: what the company does, in the reader's own words
overall: { score, why, confidence ("HIGH" | "MEDIUM" | "LOW"), confidenceWhy }
scores: exactly five, one per key: POSITION, MOAT, MARKET, NUMBERS, THESIS
        each { key, score, why, sources: [source ids] }
research: {
  whoElse: [{ name, what, scale, sources }]      who else does this
  howHard: [point]                               how hard it is to do what the company does
  rank:    [point]                               where the company stands among them
  market:  [point]                               size, growth and direction
  record:  [point]                               the public record: filings, ratings, funding, ownership
}                                                point = { text, sources: [source ids], deck: boolean }
deckVsPublic: [{ claim, found, status ("CONFIRMED" | "PARTLY" | "CONTRADICTED" | "NOT_FOUND"), sources }]
thesis: [{ code (a current PRINCIPLE code), side ("FOR" | "AGAINST" | "OPEN"), note }]
theme: { code (a current company theme code or null), note }
highlights: [{ code ("H01"), state ("CLAIMED" | "SUPPORTED"), note }]
flags: [{ label, value, sources }]
openQuestions: [text]        what to ask the founder or check next
notChecked: [text]           what the reader could not or did not check
sources: [{ id, kind, publisher, title, url, date }]
```

- **Source kinds:** SUBJECT (the company's own site, release or filing-free statement), RIVAL (another company's site or release), GOVT (a government body, PSU or tender), RATING (a rating agency), REGISTRY (a company database or exchange listing page), RESEARCH (a research house), NEWS, TRADE (trade press or industry blog).
- **Limits:** `oneLine` 240 characters; each `why` 600; a point's `text` 400; at most 12 rivals, 8 points a list, 8 deck checks, 8 thesis lines, 8 flags, 8 questions, 30 sources. A read is at most 64 KB.
- A point with `deck: true` rests on the deck or the dashboard, not on an outside source, and is shown with a "From the deck" mark.

### 17.6 Research rules

These bind whoever writes a read. The checks marked **(code)** are also enforced when a read is loaded; a read that fails one is refused with the reason.

- **Nothing confidential leaves.** Searches use the company's name and facts that are already public. Deck text, deck figures and file names are never put into a search, a fetch or any outside tool.
- **Five questions are always answered:** who else does this; how hard it is; where the company ranks; what the market is doing; what the public record shows. An empty list is allowed only for `record`, and then `notChecked` says why.
- **Every score except THESIS cites its sources, or says it rests on the deck.** **(code)** A POSITION, MOAT, MARKET or NUMBERS score above 6 must cite at least one source whose kind is not SUBJECT. A moat cannot score high on the company's word alone.
- **Every source id used anywhere must exist in `sources`, and every URL is `http:` or `https:`.** **(code)**
- **Deck claims are tested, not repeated.** The deck's main claims about position, moat, customers and numbers appear in `deckVsPublic` with what was found.
- **Say what was not checked.** `notChecked` is never empty. **(code)**
- **Figures:** as the source states them, with the year. A figure from the deck is marked as from the deck.
- **Copyright:** sources are paraphrased. No quotation over 15 words, at most one per source.
- **Judgement text carries no verdict.** **(code)** `oneLine`, `overall.why`, every score's `why` and every thesis `note` are checked with `hasBannedWord`; research text is not, because it reports what third parties did ("Hitachi is investing ₹300 Cr").
- **No past-deal matching.** A holding or a rejected company may be named only as a fact that bears on the deal (a customer, a competitor, a reference call), never as the reason for a score.
- **UI copy rules apply to the read's text:** sentence case, and no em dashes **(code)**.

### 17.7 Scores

- **Scale:** 0 to 10 in half points. **(code)** 9 to 10 is rare and needs outside proof; 7 to 8 strong; 5 to 6 mixed; 3 to 4 weak; 1 to 2 very weak. The full range is meant to be used.
- **The five scores and their questions**
  - **Position:** where does it rank among those doing the same thing, and how many have got this far? A company that is one of the only ones to build a large business in its category scores high here.
  - **Moat:** what stops a well-funded rival, and what outside the deck shows it?
  - **Market:** is the market large and moving the right way for this company to reach listing scale?
  - **Numbers:** do the reported numbers, the public filings and the plan hold together?
  - **Thesis fit:** how closely does it match how Niveshaay thinks? Principles first; the theme is context. What the funds already hold plays no part.
- **Overall** is the reader's judgement, not an average. **(code)** It must lie between the lowest and the highest of the five. `overall.why` names what drives it and what holds it back.
- **Confidence** says how much of the read rests on sources outside the company: HIGH, MEDIUM or LOW, with a reason. It is shown beside the overall score everywhere the score is shown.
- **Out of date** (pure function `readStale`, unit-tested). A read is out of date when a deck was uploaded after it was loaded, when the thesis version has changed since, or when `readAt` is more than 90 days ago. It is still shown, with the reason. Nothing is re-scored automatically.

### 17.8 Flags and highlights

Facts shown beside the scores. **None changes a score.**

- **Flags** come from the read: a label, a value and its sources ("Close to listing: IPO targeted for early 2027"). Shown as a key and value list. The FLAG rows of the thesis stay in the Thesis tab as the list of things a reader should look for.
- **Highlights** are the positive counterpart: patterns the team wants surfaced every time.
  - **H01, sweet spot:** a small company that is already a qualified vendor in an industry with a long qualification timeline, in any theme. Set by the read: "Sweet spot (claimed)" when it rests on the deck, "Sweet spot (supported)" when outside sources back it. A person can mark it checked with a required note, which shows "Sweet spot (checked)", survives later reads and writes an `AuditLog` row. Small means last actual revenue under ₹100 Cr (constant `SMALL_REVENUE_CR`; an assumption to confirm with the IC).
  - **H02, priority theme:** fires by code when the company's theme has `priority` true.
- Highlights appear as chips in the Company cell of the table, in the Read tab and on the theme page. There is a filter for them (§17.10). They do not reorder the table.

### 17.9 People's scores

One table, `FitInput`, one row per company and key: `code` (POSITION, MOAT, MARKET, NUMBERS, THESIS or OVERALL), `score` (0 to 10 in half points), `reason` (required, 10 characters at least), who and when. Rows left by version 1 (codes F1 to P5) are ignored.

- **Team score** on any of the five scores or on the overall: shown beside the read's score ("Team 8 · Read 7") with the reason. The table and the sorts use the team's overall when there is one.
- **Remove** restores the read's score. Team scores survive a new read.
- Every save and removal writes an `AuditLog` row in the same transaction ("Read: moat set to 8" with the reason as the note).

### 17.10 Where it shows

- **Table, Pipeline and Rejected tabs:** one column after Priority: **Read**. The cell shows the overall score to one decimal (tabular numerals) with "out of 10" for screen readers, the confidence beneath in small text, and an "Out of date" mark when §17.7 says so; "–" when there is no read. Clicking opens the company file on the Read tab. Not editable in the cell. The Fit and Promise columns of version 1 are removed.
- **Sorts** (Pipeline, Rejected): "Read, highest first". Unread rows last. The default sort does not change.
- **Filters:** Theme (theme names plus "No theme") on all three tabs; Highlights (Sweet spot, Priority theme) on Pipeline.
- **Company cell:** highlight chips under the name.
- **Company file:** a **Read** tab after Summary, for Pipeline and Rejected companies, in this order:
  1. The overall score ("7.0 out of 10"), confidence chip with its reason, highlight chips, and the theme with its status badge (click to change).
  2. A fixed line: "Ranks deals after outside research. It is not a recommendation."
  3. `oneLine`, then `overall.why`.
  4. The five scores: name, score pill, the question, the `why`, numbered source links, and **Team score**.
  5. **Who else does this:** a table of name, what they do, scale, sources.
  6. **How hard is it**, **Where it ranks**, **Market**, **Public record:** the points, each with its source numbers or "From the deck".
  7. **Deck against the public record:** claim, what was found, a status badge (Confirmed, Partly, Contradicted, Not found).
  8. **Against the thesis:** each principle's code and text (from the current thesis), a For, Against or Open mark, and the note.
  9. **Things to know:** the flags.
  10. **Questions for the founder** and **Not checked.**
  11. **Sources:** numbered, with publisher, title, date and kind. Links open in a new tab with `rel="noopener noreferrer"`; a URL is validated again before rendering, like OneDrive links.
  12. Footer: "Read by <author> on 23 Nov 2026, thesis version 1.2, from <deck file>", **Load a read** (a file picker for a `.json` read) and **Earlier reads** (date, overall, who loaded it; selecting one shows it read-only).
  - Empty state: "No read yet." with **Load a read**.
- **Excel export:** unchanged in this version.

### 17.11 Loading reads

- **`AnalystRead`** keeps every read as history; `Company.activeReadId` points at the one shown. The same read loaded twice is stored once (unique on company and content hash).
- **One function does the work:** `loadRead` in `src/lib/server/read.ts`, used by all three ways in.
  1. Parse with `readZ` and run the code checks of §17.6 and §17.7. Any failure refuses the whole read and returns the reasons as a `UserError`.
  2. Find the company: `company` must match exactly one Pipeline or Rejected company by name, ignoring case and outer spaces. No match or several: refused, nothing guessed.
  3. Check `thesis[].code` and `theme.code` against the current thesis rows. An unknown code is refused.
  4. In one transaction: write the `AnalystRead` with the current thesis version; point `activeReadId` at it; when `themeEdited` is false, set `themeCode` to the read's theme (null included); carry over a checked H01 mark; write an `AuditLog` row ("Read loaded: 7.0 out of 10").
- **Ways in**
  - `POST /api/reads`: a JSON body holding one read or a list of up to 50. Starts with `requireRole()`, requires `Content-Type: application/json` and an `Origin` equal to the app's own, and a body of at most 512 KB. Returns one result per read: `{ company, ok, id or reasons }`. This is how a chat session with a browser loads reads straight into the dashboard.
  - **Load a read** in the Read tab and on the Thesis tab's waiting list: a file picker that posts to the same route and shows the result per company.
  - `npx tsx --conditions=react-server scripts/read-import.mts thesis/reads`: loads every `.json` in a folder as the shared Team user and prints one line per file with the company's id, ok or the reason codes. It never prints the read.
- **No job, no worker, no AI call.** Loading is synchronous. `FitJob` is no longer written.
- **Read files are confidential** (they carry deck figures). `thesis/reads/` sits inside the git-ignored `thesis/` folder. Test fixtures use made-up companies only.

### 17.12 Security

- Every action and route starts with `requireRole()` and a zod schema, as everywhere. The funding-only deployment refuses all of it.
- A read holds deck figures. It is stored like the summary is, served only through the authorised actions, and never logged. Log ids, counts and error codes only.
- Every string in a read is rendered as text, never as HTML. Source URLs are `http:` or `https:` only, checked on load and again before rendering.
- `thesis/` is git-ignored. The seed file and the read files never reach the repository or the Docker image.

### 17.13 Version 1, and what is not in this version

**Withdrawn on 2026-11-23:** the deck reading, the two-call scoring, the 1 to 5 scale, anchors and "Closest to", the theme lookup score, Fit and Promise, the `FitJob` worker and its triggers, `OPENROUTER_FIT_MODEL`, `scripts/fit-backfill.mts` and `scripts/try-fit.mts`. The `FitRating` and `FitJob` tables and their rows stay in the database, unread; `Company.activeFitId` is left as it is. Nothing is deleted.

**Not in this version**

- Reads written by the dashboard itself through a paid API with web search. The read's shape and checks are the same either way, so this can be added without changing what is stored or shown.
- Editing the thesis in the app, and an inbox of proposed changes from new sources.
- Watching for new founder interviews or research notes.
- A calibration view for the IC's own ranking.
- Reads for Invested companies; the Read column in the Excel export.
- "Waiting on" and round deadline fields.

**Data model added**

```prisma
/// One analyst read for a company (SPEC §17.5). Kept as history; Company.activeReadId is the one shown.
model AnalystRead {
  id            String   @id @default(cuid())
  companyId     String
  company       Company  @relation("CompanyReads", fields: [companyId], references: [id], onDelete: Cascade)
  thesisVersion Int
  /// 0 to 10 in half points
  overall       Decimal  @db.Decimal(3, 1)
  /// HIGH, MEDIUM or LOW
  confidence    String
  /// The whole validated read (readZ). Holds deck figures: never logged
  body          Json
  /// sha256 of the canonical JSON, so the same read is stored once
  hash          String
  readAt        DateTime @db.Date
  author        String
  loadedById    String
  loadedBy      User     @relation(fields: [loadedById], references: [id])
  loadedAt      DateTime @default(now())

  activeFor Company? @relation("ActiveRead")

  @@unique([companyId, hash])
  @@index([companyId, loadedAt])
}
// Company gains: activeReadId String? @unique, activeRead (relation "ActiveRead", onDelete: SetNull), reads (relation "CompanyReads")
// FitInput.score changes from Int to Decimal(3,1) so a team score can be a half point; existing rows keep their values.
```
