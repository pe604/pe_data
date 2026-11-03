"use server";

// Funding tracker. SPEC §15.16.
import { z } from "zod";
import { requireRole } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { todayISO } from "@/lib/domain/dates";
import {
  addMonths,
  DEAL_KINDS,
  FUNDING_SECTOR_NAMES,
  fundingKey,
  lastFullWeek,
  monthLabel,
  monthOf,
  periodRange,
  periodStats,
  stageFor,
  weekLabel,
  weekOf,
  weekRange,
  type Benchmark,
  type FundingColumn,
  type FundingDealItem,
  type FundingWeekNote,
} from "@/lib/domain/funding";
import { dealsBetween } from "@/lib/funding/data";
import { run, UserError } from "@/lib/server/action";

export interface FundingPeriod {
  key: string;
  label: string;
  kind: "MONTH" | "WEEK";
}
export interface FundingView {
  periods: FundingPeriod[];
  period: FundingPeriod;
  /** Includes hidden deals (shown greyed in tables, left out of figures) */
  deals: FundingDealItem[];
  column: FundingColumn | null;
  week: FundingWeekNote | null;
  /** When the note is a weekly note shown for a month still in progress, its week */
  weekOf: string | null;
  unchecked: string[];
  writtenAt: string | null;
  /** The model that wrote the note, e.g. "anthropic/claude-opus-5.5" */
  writer: string | null;
  prev: { label: string; total: number; count: number } | null;
  bench: Benchmark | null;
  /** First month with deals; nothing before it has been read */
  since: string | null;
}

const PERIOD = z.string().regex(/^\d{4}-(\d{2}|W\d{2})$/);

async function view(want: string | null): Promise<FundingView> {
  const today = todayISO();
  const month = monthOf(today);
  const first = await db.fundingDeal.findFirst({ orderBy: { date: "asc" }, select: { date: true } });
  const since = first ? monthOf(first.date.toISOString().slice(0, 10)) : null;
  const months: FundingPeriod[] = [];
  for (let m = month, i = 0; i < 12 && (!since || m >= since); m = addMonths(m, -1), i++) months.push({ key: m, label: monthLabel(m), kind: "MONTH" });
  const weeks: FundingPeriod[] = [];
  for (let w = lastFullWeek(today), i = 0; i < 4; w = weekOf(new Date(Date.parse(weekRange(w)[0] + "T00:00:00Z") - 86_400_000).toISOString().slice(0, 10)), i++) weeks.push({ key: w, label: weekLabel(w), kind: "WEEK" });
  const periods = [...months, ...weeks];
  const fallback = months.find((m) => m.key === addMonths(month, -1)) ?? months[0];
  const period = periods.find((p) => p.key === want) ?? fallback;

  const [from, to] = periodRange(period.key);
  const prevKey = period.kind === "MONTH" ? addMonths(period.key, -1) : weekOf(new Date(Date.parse(from + "T00:00:00Z") - 86_400_000).toISOString().slice(0, 10));
  const [deals, prevDeals, note, bench] = await Promise.all([
    dealsBetween(from, to, { withHidden: true }),
    dealsBetween(...periodRange(prevKey)),
    db.fundingNote.findUnique({ where: { period: period.key } }),
    period.kind === "MONTH" ? db.appSetting.findUnique({ where: { key: `funding:benchmark:${period.key}` } }) : null,
  ]);
  // A month still in progress has no column yet: show its latest weekly note instead.
  const weekNote = !note && period.kind === "MONTH" ? await db.fundingNote.findFirst({ where: { kind: "WEEK", createdAt: { gte: new Date(from + "T00:00:00Z") } }, orderBy: { period: "desc" } }) : null;
  const shown = note ?? weekNote;
  const ps = periodStats(prevDeals);
  const prevEnough = ps.count >= (period.kind === "MONTH" ? 10 : 3) && (!since || prevKey.slice(0, 7) >= since);
  return {
    periods,
    period,
    deals,
    column: shown?.kind === "MONTH" ? (shown.data as unknown as FundingColumn) : null,
    week: shown?.kind === "WEEK" ? (shown.data as unknown as FundingWeekNote) : null,
    weekOf: weekNote ? weekLabel(weekNote.period) : null,
    unchecked: shown?.unchecked ?? [],
    writtenAt: shown ? shown.createdAt.toISOString() : null,
    writer: shown?.model ?? null,
    prev: prevEnough ? { label: period.kind === "MONTH" ? monthLabel(prevKey) : "the week before", total: ps.total, count: ps.count } : null,
    bench: bench ? (JSON.parse(bench.value) as Benchmark) : null,
    since,
  };
}

export async function getFunding(period: string | null) {
  return run<FundingView>(async () => {
    await requireRole();
    return view(period === null ? null : PERIOD.parse(period));
  });
}

const patch = z
  .object({
    company: z.string().trim().min(1).max(80),
    sector: z.enum(FUNDING_SECTOR_NAMES),
    kind: z.enum(DEAL_KINDS),
    amountUsdM: z.number().positive().max(100_000).nullable(),
    round: z.string().trim().min(1).max(40),
    lead: z.string().trim().max(80).nullable(),
    hidden: z.boolean(),
  })
  .partial();

/** A correction by the team. The deal is then marked edited, so later reads only add sources to it. */
export async function updateFundingDeal(id: string, data: z.input<typeof patch>, period: string) {
  return run<FundingView>(async () => {
    await requireRole();
    const p = patch.parse(data);
    const extra = {
      ...(p.company ? { key: fundingKey(p.company) } : {}),
      ...(p.round ? { stage: stageFor(p.round) } : {}),
      ...(p.lead !== undefined ? { lead: p.lead || null } : {}),
    };
    const r = await db.fundingDeal.updateMany({ where: { id: z.string().min(1).max(40).parse(id) }, data: { ...p, ...extra, edited: true } });
    if (!r.count) throw new UserError("That deal no longer exists. Reload the page.");
    return view(PERIOD.parse(period));
  });
}
