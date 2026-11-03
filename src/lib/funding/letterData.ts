import "server-only";
import { db } from "@/lib/db";
import {
  addMonths,
  monthLabel,
  periodStats,
  weekLabel,
  weekOf,
  weekRange,
  monthRange,
  type Benchmark,
  type FundingColumn,
  type FundingDealItem,
  type FundingWeekNote,
  type PeriodStats,
} from "@/lib/domain/funding";
import { dealsBetween } from "./data";

// What the funding letter PDF needs (SPEC §15.16): the note, the period's figures and every equity round.

export interface LetterData {
  kind: "MONTH" | "WEEK";
  period: string;
  /** "October 2026" or "26 Oct – 1 Nov" */
  label: string;
  column: FundingColumn | null;
  week: FundingWeekNote | null;
  writer: string;
  writtenAt: string;
  stats: PeriodStats;
  /** Visible equity rounds, largest first */
  deals: FundingDealItem[];
  prev: { label: string; total: number; count: number } | null;
  bench: Benchmark | null;
  unchecked: string[];
  /** The shareable version (funding-only deployment): no "us", no team-only wording */
  shared: boolean;
}

const dayBefore = (iso: string) => new Date(Date.parse(iso + "T00:00:00Z") - 86_400_000).toISOString().slice(0, 10);

/** The letter for a written note, or null when that period has no note yet. */
export async function loadLetter(period: string, opts: { shareable?: boolean } = {}): Promise<LetterData | null> {
  const note = await db.fundingNote.findUnique({ where: { period } });
  // Shared outside the team: only the version written without our own data.
  const text = opts.shareable ? note?.publicData : note?.data;
  if (!note || !text) return null;
  const month = note.kind === "MONTH";
  const range = month ? monthRange(period) : weekRange(period);
  const prevKey = month ? addMonths(period, -1) : weekOf(dayBefore(range[0]));
  const [all, prevDeals, bench] = await Promise.all([
    dealsBetween(...range),
    dealsBetween(...(month ? monthRange(prevKey) : weekRange(prevKey))),
    month ? db.appSetting.findUnique({ where: { key: `funding:benchmark:${period}` } }) : null,
  ]);
  const ps = periodStats(prevDeals);
  const min = month ? 10 : 3;
  return {
    kind: month ? "MONTH" : "WEEK",
    period,
    label: month ? monthLabel(period) : weekLabel(period),
    column: month ? (text as unknown as FundingColumn) : null,
    week: month ? null : (text as unknown as FundingWeekNote),
    writer: note.model,
    writtenAt: note.createdAt.toISOString().slice(0, 10),
    stats: periodStats(all),
    // Shared outside the team: which companies we have seen stays private.
    deals: all.filter((d) => d.kind === "EQUITY" && !d.hidden).map((d) => (opts.shareable ? { ...d, ours: null } : d)),
    prev: ps.count >= min ? { label: month ? monthLabel(prevKey) : "the week before", total: ps.total, count: ps.count } : null,
    bench: bench ? (JSON.parse(bench.value) as Benchmark) : null,
    unchecked: opts.shareable ? note.publicUnchecked : note.unchecked,
    shared: !!opts.shareable,
  };
}
