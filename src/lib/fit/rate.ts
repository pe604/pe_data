import "server-only";
import type { DeckInput } from "@/lib/ai/provider";
import { flagsFor, highlightsFor, lookupRow, means, meetingRow, type Facts, type FinancialsLite, type FitInputLite, type FitParam, type FlagRow, type HighlightRow, type Means, type ScoreRow } from "@/lib/domain/fit";
import type { Stage } from "@/lib/domain/constants";
import { anchorsFor, companyThemes, themeByCode, themeOptions, type ThemeRow, type ThesisRow } from "@/lib/domain/thesis";
import { readDeck, type ReadResult } from "./read";
import { scoreParameter } from "./score";

// One rating (SPEC §17.5–17.8): read the deck (or reuse a stored reading), score, then flags and highlights by code.
// Shared by the FitJob worker and scripts/try-fit.mts. Never logs quotes or scores.

/** The parameter that also sees the qualification quotes (SPEC §17.7). */
const QUALIFICATION_PARAM = "F1";

export const paramsOf = (rows: ThesisRow[]): FitParam[] =>
  rows
    .filter((r): r is Extract<ThesisRow, { kind: "PARAMETER" }> => r.kind === "PARAMETER")
    .map((r) => ({ code: r.code, name: r.data.name, question: r.data.question, group: r.data.group, source: r.data.source, weight: r.data.weight }))
    .sort((a, b) => a.code.localeCompare(b.code, undefined, { numeric: true }));

export const themesOf = (rows: ThesisRow[]) =>
  companyThemes(themeOptions(rows)).map((t) => ({ ...t, keywords: themeByCode(rows, t.code)?.data.keywords ?? [] }));

export interface RateInput {
  rows: ThesisRow[];
  /** Read the deck (DECK and MANUAL) or reuse a stored reading (THESIS) */
  source: { deck: DeckInput } | { facts: Facts };
  company: { themeCode: string | null; themeEdited: boolean; stage: Stage };
  /** try-fit only: the theme to rate against, instead of the reading's */
  themeOverride?: string | null;
  financials: FinancialsLite | null;
  unverified: number;
  business: string[];
  holdingsFor: (themeCode: string | null) => string[];
  seenBefore: { date: string; stage: string | null } | null;
  inputs: FitInputLite[];
  previousHighlights: HighlightRow[];
  signal?: AbortSignal;
}

export interface RateResult {
  facts: Facts;
  read: Omit<ReadResult, "facts"> | null;
  themeCode: string | null;
  scores: ScoreRow[];
  means: Means;
  flags: FlagRow[];
  highlights: HighlightRow[];
  unchecked: boolean;
}

export async function rate(input: RateInput): Promise<RateResult> {
  const params = paramsOf(input.rows);
  let facts: Facts;
  let read: RateResult["read"] = null;
  if ("deck" in input.source) {
    const r = await readDeck(input.source.deck, params, themesOf(input.rows), input.signal);
    facts = r.facts;
    read = { kept: r.kept, dropped: r.dropped, droppedBy: r.droppedBy, nulled: r.nulled, unchecked: r.unchecked };
  } else {
    facts = input.source.facts;
  }
  // A person's theme stands; otherwise the reading's (a try-fit run may name one).
  const themeCode = input.company.themeEdited ? input.company.themeCode : input.themeOverride !== undefined ? input.themeOverride : (facts.theme ?? input.company.themeCode);
  const theme: ThemeRow | undefined = themeByCode(input.rows, themeCode);

  const scores: ScoreRow[] = [];
  for (const p of params) {
    if (p.source === "LOOKUP") scores.push(lookupRow(p.code, theme?.data.status ?? null));
    else if (p.source === "MEETING") scores.push(meetingRow(p.code));
    else {
      const anchors = anchorsFor(input.rows, p.code).map((a) => ({ code: a.code, score: a.data.score, label: a.data.label, shows: a.data.shows }));
      scores.push(
        // A parameter added after the reading has no quotes: blank until the deck is read again (SPEC §17.11).
        await scoreParameter(p, anchors, facts.quotes[p.code] ?? [], {
          qualification: p.code === QUALIFICATION_PARAM ? facts.qualification : [],
          business: input.business,
          signal: input.signal,
        }),
      );
    }
  }
  const flags = flagsFor({
    facts,
    financials: input.financials,
    unverified: input.unverified,
    stage: input.company.stage,
    holdingsSameTheme: input.holdingsFor(themeCode),
    seenBefore: input.seenBefore,
  });
  return {
    facts,
    read,
    themeCode: theme ? themeCode : null,
    scores,
    means: means(scores, input.inputs, params),
    flags,
    highlights: highlightsFor(facts, theme ? { priority: theme.data.priority } : null, input.previousHighlights),
    unchecked: read?.unchecked ?? false,
  };
}
