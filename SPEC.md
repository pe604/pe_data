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
| AI | **OpenRouter** (OpenAI-compatible chat completions API), server-side only, behind an `AiProvider` interface so the model can be swapped later. Model from env `OPENROUTER_MODEL` (default `google/gemini-2.5-pro`, which reads PDFs natively; Flash put correct figures under the wrong years in testing). Requests set `provider.data_collection = "deny"` (see §13). The PDF's text layer is sent with the PDF so figures are copied exactly, and every figure in the financials table is checked against the deck text: if any is missing, the model gets one corrective pass, and figures still not found are listed under the table as "Check against the deck" |
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
| Admin | Everything, plus hard delete, plus manage the sector master list |
| Editor | Add and edit companies, upload files, comment, reject, invest, restore, manage the PE team list |

- There is no read-only Viewer role for now.
- **While there is no login, everyone is an Editor** (the shared "Team" user). Admin actions are unavailable until a login exists.

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
| Assigned Research | Same as Assigned PE. |
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

- Suggestions come from the TeamMember list:
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

Aerospace & Defence, Agri & Food, Auto & Auto Components, Chemicals & Materials, Consumer & Retail, Education, Electronics & Semiconductors, Financial Services & Fintech, Healthcare & Pharma, Industrials & Manufacturing, Infrastructure & EPC, Media & Entertainment, Mobility & Logistics, Power & T&D, Real Estate & Hospitality, Renewables & Climate, Technology & SaaS, Other (always last).

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
business: string[3–4] (each < 18 words: what they do, for whom, how they make money),
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
- Plain, factual wording, under about 220 words in total, readable in 60–90 seconds.

### 9.4 Rendering

The server builds markdown from the JSON, omitting empty sections entirely:

1. Snapshot (key–value grid: Round, Advisor, Location, Deck date)
2. Business (bullets)
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

## 15. Non-goals (for now)

- Email ingestion
- Notifications
- A banker column
- Deck page references in summaries
- Parked status
- Rejection reason categories
- Details captured on Invest
