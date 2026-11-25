# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Stack

Existing app (`niveshaay-deal-pipeline`): Next.js 16 with React 19 and TypeScript, PostgreSQL through Prisma 7, and Zod for validation. ExcelJS handles Excel export, @react-pdf/renderer handles PDFs, and files go to S3-compatible storage. Tested with Vitest and Playwright. Deployed with Docker on Easypanel. Build within this stack.

## Users

The firm's private-equity team and the research analysts assigned to deals. They use the tool through the working day, mostly at a desk on large screens, and also on their phones between meetings and while travelling. Each deal has one or more assigned PE owners and research analysts, and the team tracks its workload per person.

## Product Purpose

**Niveshaay PE Desk** is the PE team's single record of every private company it looks at, from first deck to investment and afterwards. It covers:

- **Pipeline:** live deals moving through stages (Not Assigned → Call Pending → Internal Discussion → Scuttlebutt → Allocation → Due Diligence), each with a priority (P1–P5), Fit and Promise scores, sector and sub-sector, assigned PE and research owners, threaded comments, the source it came from ("Via"), date received, and days waiting.
- **Rejected:** the archive of passed deals, which is several hundred long.
- **Invested:** the portfolio: amount invested per company, split across funds (Hedgehogs, Sambhav, Other), sector allocation, a quarterly tracker, meetings, results, and dated updates (some written by a news agent).
- **Events:** networking events, banker meets, family-office events, sector expos and the firm's own events, triaged as New, Interested, Going, Skipped or Attended.
- **Funding:** monthly reviews of Indian startup funding rounds, written by Claude, that compare the market with the firm's own pipeline and rejections.
- **Thesis:** the investment thesis (versioned, drafted for the IC) as themes (Core and Emerging), principles, parameters, and flags. Each theme shows how fresh its evidence is, plus its holdings, pipeline and rejected companies.

Success means no deal goes untracked or sits forgotten, everyone can see who owns what and what happens next, and every decision traces back to the thesis.

## Positioning

Open decision: no differentiating claim has been confirmed. One candidate that the product already supports: it connects deal flow, rejections, the portfolio and market funding to a versioned, IC-facing thesis, with evidence freshness on each theme. A generic CRM or deal tracker doesn't do that. Confirm this before using it as a claim.

## Operating Context

- Internal tool for the PE team only; not client-facing.
- Deal documents live in OneDrive and are linked per company with file counts.
- The team coordinates over WhatsApp, and the app links to it from the PE team panel.
- Work is exported to Excel for sharing and offline review.
- Decisions go through an investment committee (IC); the thesis is drafted for it.
- Amounts are in Indian rupees, in crores (₹ Cr). Dates are written in day-month-year order (e.g. 28 Oct 2026).

## Capabilities and Constraints

- Pipeline table with search across companies and comments, filters (date, priority, stage, sector, theme, highlights, PE, research, Via, OneDrive), and many sort orders. Stage and priority can be changed inline from the table.
- Highlight tags on companies (e.g. "Sweet spot (claimed)", "Priority theme").
- Add company, export to Excel, manage the PE team.
- Desktop is a wide, dense table; mobile web uses the same table with horizontal scrolling.
- Open decisions: user roles and permissions; any data sources beyond OneDrive and the news agent.

## Brand Commitments

The tool is named **Niveshaay PE Desk** (chosen 2026-11-25; previously "Deal pipeline"): wordmark "Niveshaay", product label "PE Desk". The Excel export carries the new name too. The team's own terms (Scuttlebutt, Allocation, Fit, Promise, Sweet spot, Via, IC) are product vocabulary; keep them.

## Evidence on Hand

The live app at the deployed URL holds real deal, portfolio and thesis data. This folder has no source code, screenshots or exports. Treat the live data as confidential: don't copy company names, amounts or comments into mock-ups, examples or anything shared outside the team. Use clearly marked sample data instead.

## Product Principles

1. **Nothing falls through.** Every deal has a stage, an owner and a visible age; neglected deals have to surface on their own.
2. **Ownership is explicit.** It's always clear who on the PE and research side holds a deal, and what the next step is.
3. **Decisions trace to the thesis.** Deals, rejections and holdings stay connected to themes, so the thesis can be tested against what actually happens.
4. **Dense on desktop, workable on mobile.** The desktop table carries the full picture; on a phone the team must still be able to triage, update and comment.
5. **Numbers stand up in IC.** Amounts, dates, scores and evidence keep their source and freshness visible.
