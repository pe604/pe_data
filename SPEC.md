# Niveshaay Deal Pipeline: Product Spec

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

Stages enum, in order:

1. Not Assigned
2. Call Pending
3. Internal Discussion
4. Scuttlebutt
5. Allocation
6. Due Diligence

## 5. Page layout (single page)

1. **Header.**
   - Left: the wordmark "Niveshaay" (serif, green) and "Deal pipeline".
   - Right: **Export to Excel** (secondary) and **Add company** (primary).
2. **Tabs**: Pipeline · Rejected · Invested, each with a count.
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
| Company | Serial number in front of the name (**follows the current view**: renumbers 1…n after any sort or filter). Clicking the name opens the Company File drawer. Shows "N files" underneath when files exist. |
| OneDrive | A **solid green cloud** when a link is saved: click opens it in a new tab (`target=_blank rel=noopener`), and hovering shows ✎ to edit. A **grey outline cloud** when missing: click opens a popover to paste the link. See 6.4. |
| Sector & sub-sector | Two lines. Click to edit: the sector comes from the master list, with "Add a new sector…" as an option (admin only); the sub-sector is free text. |
| Stage | A thin 6-segment progress rail above an inline dropdown. Any stage can be chosen (skipping is allowed). The Rejected and Invested tabs show "Stage at exit" read-only, or "Added directly" for direct-invested companies. |
| Priority | Inline dropdown: Set / P1…P5. P1 is solid gold, P2 gold outline, P3 neutral outline, P4–P5 muted, and unset uses a dashed outline. |
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

Institutional and restrained, in Niveshaay's colours. Light and dark themes (`prefers-color-scheme`).

| Token | Light | Dark |
|---|---|---|
| paper (page) | #F5F6F0 | #0F1510 |
| surface | #FFFFFF | #151D16 |
| ink | #16241A | #E6ECE2 |
| muted | #6A766D | #8E9A8F |
| rule | #DDE2D6 | #28332A |
| green (brand/primary) | #27500A | #86B85C |
| gold (P1) | #C5963A | #D0A24C |
| brick (reject/danger) | #8A2C1F | #E48A78 |
| amber (ageing) | #946510 | #DDAE52 |
| stage 0–5 | #E4E7DF, #D8E6CD, #BED6AC, #96BC7C, #5F8C43, #27500A | #252E26, #243522, #2D4625, #3C5E2C, #557F3A, #86B85C |

- **Fonts:**
  - IBM Plex Sans for the UI, with tabular numerals for figures
  - Source Serif 4 for the wordmark, drawer company name and modal titles
- **Sentence case everywhere.** No em dashes in UI copy.
- **Responsive:** 16px gutters on phones; the table scrolls horizontally with Company pinned.
- **Motion:** respect reduced-motion settings.

## 12. Export to Excel

- **Button:** header. Available to all roles.
- **Scope:** always exports **everything**, ignoring active filters.
- **File:** `Niveshaay Deal Pipeline YYYY-MM-DD.xlsx`.
- **Sheets:**
  - **Pipeline:** Sr. No., Company, Sector, Sub-sector, Stage, Priority, Assigned PE, Assigned Research, Latest comment, Comments (count), Via, Date received, Days, OneDrive, Files (count)
  - **Rejected:** Sr. No., Company, Sector, Sub-sector, Stage at exit, Priority, Assigned PE, Assigned Research, Rejection reason, Rejected on, Via, Date received, Days in pipeline, OneDrive
  - **Invested:** Sr. No., Company, Sector, Sub-sector, Stage at exit (or "Added directly"), Priority, Assigned PE, Assigned Research, Latest comment, Via, Date received, Invested on, Days in pipeline, OneDrive
- **Each sheet:**
  - row 1: title "Niveshaay Deal Pipeline: <Sheet>" in Times New Roman 14 bold, dark green #004800
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
- Deck content is sent to the model only for summarising. No logging of deck text.
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
  5. **Via:** if the caption, or a text from the same sender within 5 minutes of the deck, says `from`, `via`, `through`, `thru`, `ref`/`referred by` or `from/via` followed by a name (e.g. "from/Via arvind sir"), Via is that person (matched to the team list, else Title Case). Otherwise Via is the sender.
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
  - **MIS received** and **Result note** are **uploads from the cell**: click → the files for that company and quarter (View for PDF/images, Download), **Upload files** (several at once) and **Upload a folder** (every file in it). Only the column's types are uploaded (MIS: PDF, Excel, CSV; result note: PDF, Word, Excel, PowerPoint); hidden/system files and other types are skipped and counted in the toast. Files are stored like any other (encrypted), with type MIS or Result note and the quarter, and also appear in Materials.
  - The tick is the India date of the first upload: MIS shows "✓ 12 Nov" once received, Result note "✓ Made 20 Nov" (plus "· N files" when more than one). Until then the cell shows just an **upload icon**. A result note is marked made **only** by uploading it.
  - **No MIS due date** in the tracker (removed 2026-10-27; any saved due dates are kept but not shown). **Show** filter: All companies / MIS not received / MIS received / Result note not made. Order **Needs action first** (MIS not received, then result note not made, then done) or Company A–Z.
  - Header: progress ("MIS received: 14/22", "Result notes made: 9/22").
  - Not included: Result made by, IPO/Exit tracking, Result update, Quarterly calls, Shared with BDO.
- **Contacts** (`CompanyContact`): several per Invested company on the Investment tab: name (required), designation, email (validated), phone; one is **Primary** (the first one automatically; marking another moves it). Used for the tracker's POC column and, later, a mail merge asking for MIS/data.
- **Meetings**: per company, date, type (Plant visit, Management meeting, Quarterly call, Other), status (Planned, Done, Cancelled; Done can't be in the future), who is going, notes / next steps. The Meetings view lists all portfolio meetings in **Needs updating** (planned, date passed), **Upcoming**, **Past**, filterable by person and company; Add, Mark done, Edit, Remove. Each Invested company's file has a **Meetings** tab.
- Every upload, remark, MIS due date change, contact and meeting change writes a History note.
- **Next: reminders** (weekly WhatsApp digest) and a mail merge to POCs requesting data.

### 15.3 Quarterly files and MIS reader (company file → Investment)
- **Quarterly MIS and results**: each quarter with its MIS and Result note files (View, Download), **Upload MIS** for a chosen quarter, and **Read figures** on any MIS file.
- **Reading:** the model only *copies* the quarter's figures exactly as printed, plus the unit printed (Cr, Lakh, Mn, Thousand, Rupees): the quarter total if printed, else each of the three months (actuals only; never YTD, full-year or budget). Revenue = revenue from operations (not other income); EBITDA as labelled; PAT; cash and bank at quarter end. The code converts to ₹ Cr and adds the three months when there's no quarter total (never a partial quarter). Every copied figure is checked against the file's text; misses are listed.
- **Review before saving**; nothing is saved until **Save figures** (`MisFigure`, one per company per quarter). Losses as -12.5 or (12.5). **Enter manually** also works.
- **Table:** last 6 quarters: Revenue, Revenue YoY, EBITDA, EBITDA %, PAT, Cash and bank; Edit and Remove per quarter.

### 15.5 Company file for Invested companies (2026-10-20)
- Tabs: **Overview** (invested by fund, latest update, contacts, rounds) · **MIS & results** (upload MIS / result note for a quarter, files of the latest 2 quarters with "Show older", financials table with Edit/Remove in each quarter's header menu) · **Updates** (form behind an Add update button) · **Meetings** · **Files** (materials, plus the deck summary in a collapsed section) · **History** (comments, then the change log). Pipeline and Rejected companies keep Summary · Materials · Comments · History.
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
- **Sources, checked at 08:00, 12:00, 16:00 and 20:00 IST:** Google News search (India edition) for the search names, last 2 days; LinkedIn company posts via Apify (`harvestapi/linkedin-company-posts`, no cookies), posts since the previous LinkedIn check (first run: 3 days). LinkedIn needs `APIFY_TOKEN`; without it, news only. Every item seen is stored once per company (`NewsItem`, unique by URL), so nothing is checked or sent twice.
- **AI filter** (OpenRouter, cheaper check model, `data_collection: deny`): per company, the new items plus the last 30 days of updates. For each item: is it really about this company; is it **material** (product launch, big order or contract, fundraise / valuation / M&A / IPO, expansion or new capacity, key management change, regulatory or legal action, financial results, negative news such as fraud, default, layoffs, accidents, disputes); is it a repeat of something already recorded; category; importance (high: big order, fundraise, M&A / IPO, negative, regulatory or legal, key exit; else medium or low); a one-line summary. Not material: routine marketing, hiring posts, events, greetings, thought leadership, minor awards.
- **Stored:** material, non-repeat items go straight into the company's **Updates** (source NEWS or LINKEDIN, with the link, category and importance), dated by publication, added by "News agent". Anyone can edit or remove them. They count as the Latest update in the Invested table.
- **Repeats:** the AI compares each item with the company's updates from the last 30 days and with material news found earlier in the same check (any batch), and with earlier items in its batch; a repeat is stored but never added or sent.
- **WhatsApp** only to the group in `NEWS_WHATSAPP_GROUP` (the team's "PE Portfolio Updates"); never the deck-intake group. Unset = no news messages (news still goes into Updates). **one message per material item, no clubbing**, right after the check that found it, high importance first and headed "Big news". Each has the company, category, one-line summary, date and a **short link** `APP_URL/n/<7-character code>` that redirects to the article or post (original link when `APP_URL` isn't set). No message when nothing is found. A failed send is retried after the next check (items up to 3 days old).
- **Check now** on a company's News watch runs that company immediately (same storing and messages).
- Never log article text, posts or AI output; ids and counts only.

## 16. Non-goals (for now)

- Email ingestion
- Notifications other than the idle deal reminders (§15.7) and Research assignment messages (§15.8)
- A banker column
- Deck page references in summaries
- Parked status
- Rejection reason categories
- Details captured on Invest
