---
version: 1
slug: "src-app-page-tsx"
primary_target: "src/app/page.tsx"
related_targets: ["src/components/Dashboard.tsx","src/app/globals.css"]
---

# Dashboard: shell and deal lists

Scope: the single dashboard page (header, tabs, stage bar, PE team bar, toolbar, Pipeline/Rejected/Invested lists, phone cards, drawer chrome). Mode: Operate. Events, Funding and Thesis inherit the tokens now; their own pass comes later.

Audience and job: the PE team and assigned analysts triage deals, change stage and priority, and see who owns what; at a desk on wide screens, and on phones between meetings and plant visits.

Constraints: SPEC §11 is the written system; sentence case, no em dashes in UI copy, tabular figures, light and dark via prefers-color-scheme, 16px phone gutters, reduced motion respected, colours only through CSS variables.

Unresolved: Events, Funding and Thesis restyle (second pass).

## Direction contract

THESIS: A deal desk in Mumbai's Art Deco financial district: the pipeline reads as a skyline of setbacks. It refuses the category default of a grey dashboard with one green or neon accent.

OWN-WORLD: Peacock-teal header band (#0F3B3A) carrying an ivory wordmark; cool white page (#F4F7F6), never cream; coral (#E8735A family) for primary actions only; brass for P1; sea-glass stage ramp from pale aqua to deep teal; triple hairline rules as the one ornament; a geometric sans with deco proportions for the wordmark and counts, a workhorse sans for data. Dark mode: teal-black ground, the band deepens, coral and sea-glass brighten.

STORY: The team sees at once how many deals sit at each stage, who holds them, and which are ageing; changes stage or priority in place; opens a company in the drawer. Rejected and invested deals carry a stamp instead of vanishing.

FIRST VIEWPORT: Full-width teal band: wordmark "Niveshaay PE Desk" left, Export and coral Add company right, tabs on the band's lower edge. Below on the white page: the stepped stage bar (six segments rising left to right, large counts), PE team row with initials, filters, then the table. Primary action: Add company, top right, coral.

FORM: Marine Drive deco, position 5 of 7 on the ordered list; seed:f227b231acc39223. Raises: from the airport wayfinding challenger, counts set large and the phone card leads with the next step; from the ticket wallet challenger, exit states stamp onto the row; from the streaming wall challenger, the open row lifts while the rest stays quiet.

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance
