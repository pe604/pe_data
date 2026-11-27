import "server-only";
import { searchRound } from "@/lib/ai/fundingFill";
import { aiUsage } from "@/lib/ai/provider";
import { db } from "@/lib/db";
import { fillPatch, gapsOf, type DealRowData } from "@/lib/domain/funding";

// Filling a round's gaps from a web search (SPEC §15.16). Kept apart from agent.ts so scripts can run it without the
// PDF letter code. Logs counts, ids and cost only.

const FILL_PER_RUN = 20;
const day = (iso: string) => new Date(iso + "T00:00:00Z");
const addDaysISO = (iso: string, n: number) => new Date(day(iso).getTime() + n * 86_400_000).toISOString().slice(0, 10);
const errCode = (e: unknown) => (e as { status?: number }).status ?? (e as Error).message?.slice(0, 40);

async function claim(key: string): Promise<boolean> {
  const r = await db.appSetting.createMany({ data: [{ key, value: new Date().toISOString() }], skipDuplicates: true });
  return r.count > 0;
}

/**
 * Looks up equity rounds from the last 45 days that are missing their amount, round, lead or what the company does:
 * one web search each, at most 20 a run, 2 tries a round on different days. Rounds the team edited or left out are
 * skipped; code keeps only what the results back (fillPatch).
 */
export async function fillGaps(today: string, limit = FILL_PER_RUN): Promise<{ tried: number; filled: number; cost: number }> {
  const rows = await db.fundingDeal.findMany({
    where: { kind: "EQUITY", edited: false, hidden: false, date: { gte: day(addDaysISO(today, -45)) } },
    orderBy: { date: "desc" },
  });
  const costBefore = aiUsage.costUsd;
  let tried = 0;
  let filled = 0;
  for (const r of rows) {
    if (tried >= limit) break;
    const deal = { company: r.company, amountUsdM: r.amountUsdM, round: r.round, lead: r.lead, what: r.what, investors: r.investors, sources: r.sources as unknown as DealRowData["sources"] };
    if (!gapsOf(deal).length) continue;
    // Two tries a round, on different days.
    const first = await db.appSetting.findUnique({ where: { key: `funding:fill:${r.id}:1` } });
    const tryKey = !first ? `funding:fill:${r.id}:1` : first.value.slice(0, 10) < today ? `funding:fill:${r.id}:2` : null;
    if (!tryKey || !(await claim(tryKey))) continue;
    tried++;
    try {
      const { answer, results } = await searchRound({ ...deal, date: r.date.toISOString().slice(0, 10) });
      const { patch, filled: got } = fillPatch(deal, answer, results);
      if (got.length) {
        // Only while no one has edited it: a team edit since the search wins.
        const n = await db.fundingDeal.updateMany({
          where: { id: r.id, edited: false },
          data: { ...patch, ...(patch.sources ? { sources: patch.sources as object[] } : {}) },
        });
        if (n.count) filled++;
      }
    } catch (e) {
      console.error("[funding] fill failed", r.id, errCode(e));
      if ((e as { code?: string }).code === "no_credits") break;
    }
  }
  if (tried) console.log(`[funding] gaps: ${tried} looked up, ${filled} filled, US$${(aiUsage.costUsd - costBefore).toFixed(3)}`);
  return { tried, filled, cost: aiUsage.costUsd - costBefore };
}
