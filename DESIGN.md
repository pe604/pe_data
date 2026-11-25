---
name: Niveshaay PE Desk
description: The private equity team's deal desk, set in Marine Drive deco.
colors:
  band: "#0F3B3A"
  band-2: "#134645"
  band-ink: "#F3EFE4"
  band-muted: "#A3C4BF"
  coral: "#EE7A5B"
  coral-2: "#F28D71"
  on-coral: "#2A0E06"
  green: "#0F5C58"
  green-2: "#127069"
  green-soft: "#DCEFEB"
  on-green: "#FFFFFF"
  gold: "#85620C"
  gold-fill: "#D4AE3A"
  gold-soft: "#F6EDD2"
  on-gold: "#211904"
  brick: "#A3341F"
  brick-soft: "#F8E4DE"
  amber: "#875900"
  stage-0: "#E3ECEA"
  stage-1: "#D2EAE5"
  stage-2: "#ACDCD4"
  stage-3: "#6CBFB3"
  stage-4: "#23877D"
  stage-5: "#0F5C58"
  paper: "#F2F6F5"
  surface: "#FFFFFF"
  surface-2: "#F7FAF9"
  hover: "#EDF4F2"
  sel: "#E1F0EC"
  ink: "#0D2121"
  ink-2: "#2D4544"
  muted: "#536B6A"
  faint: "#687F7E"
  rule: "#D5E1DE"
  rule-2: "#E6EEEC"
typography:
  wordmark:
    fontFamily: "Jost, Futura, Century Gothic, sans-serif"
    fontSize: "21px"
    fontWeight: 500
    lineHeight: 1
    letterSpacing: "0.2em"
  display:
    fontFamily: "Jost, Futura, Century Gothic, sans-serif"
    fontSize: "30px"
    fontWeight: 500
    lineHeight: 1
    letterSpacing: "-0.01em"
  headline:
    fontFamily: "Jost, Futura, Century Gothic, sans-serif"
    fontSize: "22px"
    fontWeight: 500
    lineHeight: 1.2
    letterSpacing: "-0.005em"
  title:
    fontFamily: "Hanken Grotesk, Segoe UI, system-ui, sans-serif"
    fontSize: "14.5px"
    fontWeight: 600
    lineHeight: 1.3
    letterSpacing: "-0.003em"
  body:
    fontFamily: "Hanken Grotesk, Segoe UI, system-ui, sans-serif"
    fontSize: "14px"
    fontWeight: 400
    lineHeight: 1.45
    letterSpacing: "0.003em"
    fontFeature: "\"tnum\" 1"
  label:
    fontFamily: "Hanken Grotesk, Segoe UI, system-ui, sans-serif"
    fontSize: "12px"
    fontWeight: 600
    lineHeight: 1.3
    letterSpacing: "0.01em"
  stamp:
    fontFamily: "Jost, Futura, Century Gothic, sans-serif"
    fontSize: "11px"
    fontWeight: 600
    lineHeight: 1.2
    letterSpacing: "0.12em"
  reading:
    fontFamily: "Source Serif 4, Georgia, Times New Roman, serif"
    fontSize: "14px"
    fontWeight: 500
    lineHeight: 1.55
rounded:
  stamp: "4px"
  sm: "6px"
  md: "8px"
  lg: "12px"
  pill: "999px"
spacing:
  hairline-step: "3px"
  xs: "6px"
  sm: "10px"
  md: "14px"
  gutter-phone: "16px"
  lg: "22px"
  gutter-desk: "28px"
components:
  button-primary:
    backgroundColor: "{colors.coral}"
    textColor: "{colors.on-coral}"
    rounded: "{rounded.md}"
    padding: "0 13px"
    height: "36px"
  button-primary-hover:
    backgroundColor: "{colors.coral-2}"
  button-secondary:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    rounded: "{rounded.md}"
    padding: "0 13px"
    height: "36px"
  button-on-band:
    backgroundColor: "transparent"
    textColor: "{colors.band-ink}"
    rounded: "{rounded.md}"
    height: "36px"
  button-on-band-hover:
    backgroundColor: "{colors.band-2}"
  tab:
    textColor: "{colors.band-muted}"
    padding: "9px 12px 16px"
  tab-active:
    textColor: "{colors.band-ink}"
  stage-segment:
    rounded: "8px 8px 0 0"
    padding: "10px 14px 9px"
    typography: "{typography.display}"
  pe-card:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    rounded: "{rounded.md}"
    padding: "8px 12px 8px 8px"
  pe-card-selected:
    backgroundColor: "{colors.green-soft}"
  chip:
    backgroundColor: "{colors.green-soft}"
    textColor: "{colors.ink}"
    rounded: "{rounded.sm}"
    padding: "2px 8px"
  priority-p1:
    backgroundColor: "{colors.gold-fill}"
    textColor: "{colors.on-gold}"
    rounded: "{rounded.pill}"
    padding: "3px 22px 3px 8px"
  priority-p2:
    backgroundColor: "{colors.gold-soft}"
    textColor: "{colors.gold}"
    rounded: "{rounded.pill}"
  stamp-rejected:
    textColor: "{colors.brick}"
    typography: "{typography.stamp}"
    rounded: "{rounded.stamp}"
    padding: "2px 7px 1px"
  stamp-invested:
    textColor: "{colors.gold}"
    typography: "{typography.stamp}"
    rounded: "{rounded.stamp}"
    padding: "2px 7px 1px"
  input-search:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    rounded: "{rounded.md}"
    height: "36px"
    padding: "0 10px 0 34px"
  table-header:
    backgroundColor: "{colors.surface-2}"
    textColor: "{colors.muted}"
    typography: "{typography.label}"
    padding: "11px 8px"
  row-open:
    backgroundColor: "{colors.sel}"
  deal-card:
    backgroundColor: "{colors.surface}"
    rounded: "{rounded.lg}"
    padding: "14px 14px 12px"
  deal-card-open:
    backgroundColor: "{colors.sel}"
---

# Design System: Niveshaay PE Desk

## Overview

**Creative North Star: "The Marine Drive Deal Desk"**

The desk is set in Mumbai's Art Deco financial district. A peacock-teal band carries the ivory wordmark and the tabs; below it the page is cool white, never cream, and the pipeline reads as a skyline of setbacks: six stage segments stepping up from left to right on a deep teal baseline, their counts set large in a geometric deco face. The rest of the screen is a working instrument, dense and quiet, so the band and the skyline carry the character and the table carries the data.

Colour is rationed by job. Coral belongs to the primary action alone. Brass marks P1, the active tab and the close of the band. Teal does the everyday work of links, focus, selection and ownership, and the sea-glass ramp tells stage progress from pale aqua to deep teal. Exits are not deletions: rejected and invested deals carry a tilted stamp where their stage used to be. The one ornament is the triple hairline. Light and dark both follow `prefers-color-scheme`; in dark the ground goes teal-black, the band deepens, and coral and sea-glass brighten.

Density follows the work: a wide table that fits every Pipeline column at 1440px on a desk, and lead-with-the-next-step cards on a phone with 40px touch targets and 16px gutters. The rejected category default is a grey dashboard with a single green or neon accent.

**Key Characteristics:**
- One teal band for header and tabs, closed by a brass rule and two faint hairlines.
- A stepped stage bar whose heights rise with the stage and whose weight follows the count.
- Coral used for the primary action only.
- Jost for the wordmark, counts, titles and stamps; Hanken Grotesk with tabular figures for everything else.
- Flat surfaces with a whisper shadow; the open row or card is the one thing that lifts.
- Exit states stamp onto the row instead of disappearing.

**Scope.** This system is evidenced by the header band, stage skyline, PE row, toolbar, the Pipeline, Rejected and Invested lists, phone cards, and drawer and modal chrome. Events, Funding and Thesis inherit the tokens but are not yet restyled; they are pending and not a source for these rules. The Results document's fixed brand colours and the Excel and PDF exports sit outside this world.

## Colors

A cool teal-and-white palette with one warm voice (coral) and one precious metal (brass), every value reached through a CSS variable. Dark values are paired on the same token names (see the sidecar).

### Primary
- **Peacock Band** (band): the header and tab field, in both themes; band-2 is its hover tint, band-ink (Marine Ivory) its text, band-muted its quiet text and inactive tabs.
- **Harbour Coral** (coral): primary actions only, Add company and the primary button in a modal. Text on it is on-coral, a near-black brown, never white. Hover lightens to coral-2.

### Secondary
- **Deep Teal** (green): links, focus rings, caret, selection tint, sort arrows, the open-row outline, the selected PE card and ink avatars. green-soft is its quiet fill for chips, selected states and success banners.
- **Sea-Glass Ramp** (stage-0 to stage-5): the six pipeline stages, pale aqua to deep teal. Each stage has a paired text token (t0 to t5 in the stylesheet) that keeps counts legible on its fill. The same ramp fills the per-row stage rail.

### Tertiary
- **Brass** (gold-fill, gold, gold-soft, on-gold): gold-fill is the P1 pill, the active tab underline, the band's closing rule and the "PE Desk" label on the band; gold is brass as text (P2 text, Invested stamp, Invested badge); gold-soft is its quiet fill (P2, notices).
- **Brick** (brick, brick-soft): rejection and danger: the Rejected stamp and badge, destructive buttons, errors, and days past the ageing threshold.
- **Ageing Amber** (amber): days waiting in the warning band, between neutral and brick.

### Neutral
- **Cool Paper** (paper): the page ground. Cool white with a teal cast; never cream.
- **Surface** (surface, surface-2): cards, table body, inputs; surface-2 for table headers and inset wells.
- **Hover and Selected** (hover, sel): row hover and the open row or card.
- **Harbour Ink** (ink, ink-2, muted, faint): text from primary through secondary to metadata and placeholders.
- **Rules** (rule, rule-2): borders and dividers; rule-2 for in-table row lines.

### Named Rules
**The One Coral Rule.** Coral marks the primary action and nothing else. If two coral things are on screen, one of them is wrong.

**The Never Cream Rule.** The page is cool paper with a teal cast. Warm off-white grounds belong to a different world.

**The Brass Is Earned Rule.** Brass is for P1, the active tab and the band's closing rule. It is never decoration.

## Typography

**Display Font:** Jost (with Futura, Century Gothic)
**Body Font:** Hanken Grotesk (with Segoe UI, system-ui)
**Reading Font:** Source Serif 4 (with Georgia), for long reading text only

**Character:** Jost brings the deco geometry: wide-tracked capitals in the wordmark, large round counts in the skyline. Hanken Grotesk is the workhorse for data, with tabular figures on everything.

### Hierarchy
- **Wordmark** (Jost 500, 21px, 0.2em tracking, uppercase by CSS; 17px and 0.16em on phones): "Niveshaay" on the band only.
- **Display** (Jost 500, 30px, line-height 1): stage counts in the skyline (26px on phones), the drawer company name. PE counts use the same face at 19px.
- **Headline** (Jost 500, 22px to 24px): modal titles and empty-state headings.
- **Title** (Hanken Grotesk 600, 14.5px; 16.5px on phone cards): company names in the table and cards.
- **Body** (Hanken Grotesk 400, 14px/1.45, tabular figures): cells, comments, controls at 13px to 14px.
- **Label** (Hanken Grotesk 600, 12px, 0.01em): table headers, stage names, PE label, card field labels.
- **Stamp** (Jost 600, 11px, 0.12em, uppercase by CSS): exit stamps only.
- **Reading** (Source Serif 4, 14px/1.55): Funding letters and analyst reads.

### Named Rules
**The Figures Line Up Rule.** Every number is tabular (`"tnum" 1` on body). Counts, amounts, days and dates must align in columns.

**The Uppercase By CSS Rule.** Copy is sentence case in the source. Only the wordmark and stamps are uppercased, and only through `text-transform`.

## Layout

A full-width column: band, then the stage skyline, then the PE row, then the triple hairline, the toolbar and the list. Desktop gutters are 28px; the table sits in a rounded well that fills the remaining height and scrolls inside itself, with a sticky header row and a sticky Company column. Every Pipeline column fits at 1440px.

Below 760px the page scrolls as a whole and the band (header, then tabs) stays pinned. Gutters drop to 16px. The six stages wrap into two rows of three, still stepping up left to right. The PE row, filter toolbar and tab row scroll sideways instead of wrapping. The table is replaced by a list of deal cards. Header actions become 40px icon buttons with labels for screen readers, and controls grow to 40px tall. Below 340px the "PE Desk" label drops.

Rhythm is small and steady: 3px between skyline segments and hairlines, 6px between toolbar controls and PE cards, 10px to 14px inside cells and cards, 22px above the skyline.

## Elevation & Depth

Flat by default with tonal layering: paper, then surface, then surface-2. A whisper shadow sits under buttons, the table well and cards. Real lift is reserved for things that float or are open.

### Shadow Vocabulary
- **Whisper** (`box-shadow: 0 1px 2px rgba(13,33,33,.07)`): buttons, the table well, deal cards at rest.
- **Pop** (`box-shadow: 0 1px 2px rgba(13,33,33,.07), 0 16px 40px rgba(13,33,33,.16)`): popovers, modals, menus, and the open deal card on phones.
- **Drawer** (`box-shadow: -24px 0 56px rgba(13,33,33,.16)`): the company drawer.
- **Selected stage** (`box-shadow: inset 0 0 0 2px var(--ink), 0 -6px 18px rgba(0,0,0,.10)`): the chosen skyline segment.

### Named Rules
**The Only The Open Lifts Rule.** At rest everything sits flat. The open row is tinted and outlined in teal; the open card lifts 1px with the pop shadow. Nothing else rises.

## Shapes

Gently curved, architectural. Buttons, inputs, PE cards and skyline segments use 8px; the table well, deal cards, modals and popovers use 12px; chips use 6px; priority pills are fully round; stamps are 4px with a 1.5px currentColor border. Skyline segments round only their top corners and stand on a 2px deep-teal baseline, and the per-row stage rail repeats the setback: six bars rising from 4px to 9px tall with rounded tops.

**The Setback Rule.** Progress is drawn as rising steps, never as a flat progress bar.

## Components

### Buttons
Confident and few.
- **Shape:** 8px radius, 36px tall (28px small, 40px on phones), whisper shadow.
- **Primary:** coral fill, on-coral text, weight 600. Used once per view.
- **Hover / Focus:** primary lightens to coral-2; secondaries darken their border to faint. Focus is a 2px teal outline offset 2px; on the band the outline turns brass.
- **Secondary:** surface fill, rule border, ink text.
- **On the band:** transparent with a band-rule border and ivory text; hover fills band-2.
- **Danger:** brick text on a brick-tinted border, brick-soft on hover.

### Chips
- **Style:** green-soft fill, ink text, 12px weight 500, 6px radius. Names wrap inside their column.

### Priority pill
- **Style:** a round select. P1 is solid brass with on-gold text; P2 is gold-soft with brass text and border; P3 has a stage-4 border; P4 and P5 are muted; an unset priority is a dashed outline reading "Set".

### Cards / Containers
- **Table well:** 12px radius, rule border, whisper shadow, surface fill.
- **Deal card (phone):** 12px radius, rule border, 14px padding, whisper shadow. It leads with the company and priority, then the latest comment as the next step, then sector, stage, people and a ruled footer with date, files, OneDrive and days. Open: teal border, sel fill, pop shadow, 1px lift.

### Inputs / Fields
- **Style:** surface fill, rule border, 8px radius, 36px tall (40px on phones), search with a 34px left inset for its icon.
- **Focus:** border turns teal with a 3px green-soft halo.

### Navigation
- **Band tabs:** band-muted labels at weight 500 with a count pill in band-rule; the active tab turns ivory at 600, its count pill inverts to ivory on teal, and a 3px brass underline sits above the band's closing rule. Phones scroll the tab row sideways.

### Stage skyline (signature)
Six sea-glass segments stepping from 62px to 102px tall, each with the stage name in label type and its count in display type. A stage with no deals is drawn as a rule outline, so weight follows the count. The selected stage gets an ink ring and a soft upward shadow; the others dim to 50% while a stage filter is on. On first load the segments rise from 82% height once, staggered 40ms apart (0.7s, `cubic-bezier(.16,1,.3,1)`); reduced motion skips it.

### PE row
Each person is a card with a 32px initials avatar in Jost (green-soft, inverting to solid teal when selected), the name and the count. Selected: 2px teal ring on green-soft.

### Exit stamp
In Rejected and Invested the stage column shows a stamp, "Rejected" in brick or "Invested" in brass, tilted -3deg, above "at <stage>" or "Added directly". Reduced motion removes the tilt.

### Triple hairline
Three 1px rules 3px apart: in rule between the bars and the toolbar, and at the foot of the band as one brass rule over two band-rule hairlines. It is the only ornament.

## Do's and Don'ts

### Do:
- **Do** reach every colour through its CSS variable and define the dark value on the same token.
- **Do** keep coral for the single primary action in a view, with on-coral text.
- **Do** set counts and the drawer title in Jost and all data in Hanken Grotesk with tabular figures.
- **Do** draw stage progress as rising setbacks on the sea-glass ramp.
- **Do** stamp exit states onto the row instead of removing the deal.
- **Do** keep 16px gutters and 40px touch targets below 760px, and honour reduced motion.

### Don't:
- **Don't** use a cream or warm off-white page.
- **Don't** use coral or brass as decoration or as fills for sections.
- **Don't** add ornament beyond the triple hairline.
- **Don't** write uppercase or title case in the copy; the wordmark and stamps are uppercased by CSS only.
- **Don't** use em dashes in UI copy.
- **Don't** lift anything at rest; only floating layers and the open row or card rise.
