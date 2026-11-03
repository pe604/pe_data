import "server-only";
import { db } from "@/lib/db";
import { asSector, fundingKey, sameCompany, type DealKind, type FundingDealItem, type FundingSource, type Stage } from "@/lib/domain/funding";

// Loading deals for the Funding tab and the writer (SPEC §15.16).

const STATUS_LABEL = { PIPELINE: "In our pipeline", REJECTED: "Rejected by us", INVESTED: "In our portfolio" } as const;
const day = (iso: string) => new Date(iso + "T00:00:00Z");

/** Our own companies by name key, for the "deck seen" mark. */
async function ourCompanies(): Promise<{ key: string; label: string }[]> {
  const rows = await db.company.findMany({ select: { name: true, status: true } });
  return rows.map((r) => ({ key: fundingKey(r.name), label: STATUS_LABEL[r.status] }));
}

type Row = Awaited<ReturnType<typeof db.fundingDeal.findMany>>[number];

export function toItem(r: Row, ours: { key: string; label: string }[]): FundingDealItem {
  const key = r.key;
  return {
    id: r.id,
    company: r.company,
    amountUsdM: r.amountUsdM,
    round: r.round,
    stage: r.stage as Stage,
    kind: r.kind as DealKind,
    sector: asSector(r.sector),
    what: r.what,
    lead: r.lead,
    investors: r.investors,
    date: r.date.toISOString().slice(0, 10),
    sources: ((r.sources as unknown as FundingSource[]) ?? []).map((s) => ({ outlet: s.outlet, url: s.url })).filter((s) => /^https?:\/\//.test(s.url)),
    hidden: r.hidden,
    ours: key.length >= 3 ? (ours.find((o) => o.key === key || sameCompany(o.key, key))?.label ?? null) : null,
  };
}

/** Deals reported in [from, to). */
export async function dealsBetween(from: string, to: string, opts: { withHidden?: boolean } = {}): Promise<FundingDealItem[]> {
  const [rows, ours] = await Promise.all([
    db.fundingDeal.findMany({ where: { date: { gte: day(from), lt: day(to) }, ...(opts.withHidden ? {} : { hidden: false }) }, orderBy: [{ amountUsdM: { sort: "desc", nulls: "last" } }, { company: "asc" }] }),
    ourCompanies(),
  ]);
  return rows.map((r) => toItem(r, ours));
}

/** Counts only, by our own sector names: decks received in 90 days and the invested portfolio. */
export async function ourSectorCounts(): Promise<{ decks: { sector: string; count: number }[]; portfolio: { sector: string; count: number }[] }> {
  const since = new Date(Date.now() - 90 * 86_400_000);
  const [decks, portfolio, sectors] = await Promise.all([
    db.company.groupBy({ by: ["sectorId"], where: { dateReceived: { gte: since }, sectorId: { not: null } }, _count: true }),
    db.company.groupBy({ by: ["sectorId"], where: { status: "INVESTED", sectorId: { not: null } }, _count: true }),
    db.sector.findMany({ select: { id: true, name: true } }),
  ]);
  const named = (rows: { sectorId: string | null; _count: number }[]) =>
    rows.map((r) => ({ sector: sectors.find((s) => s.id === r.sectorId)?.name ?? "Other", count: r._count })).sort((a, b) => b.count - a.count);
  return { decks: named(decks), portfolio: named(portfolio) };
}
