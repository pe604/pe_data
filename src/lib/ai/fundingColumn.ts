import "server-only";
import { z } from "zod";
import {
  allowedFigures,
  columnTexts,
  money,
  uncheckedFigures,
  weekTexts,
  type Benchmark,
  type FundingColumn,
  type FundingDealItem,
  type FundingWeekNote,
  type PeriodStats,
} from "@/lib/domain/funding";
import { fundingModel } from "@/lib/env";
import { aiProvider } from "./provider";

// The monthly column and the weekly note (SPEC §15.16), written by the strongest model from the deal list. Every
// dollar figure and percentage is checked against the deals; one corrective retry, as for deck summaries. Never log
// the prompt or the output.

export interface ColumnContext {
  label: string;
  nextMonth: string;
  deals: FundingDealItem[];
  stats: PeriodStats;
  prevTotal: number | null;
  prevCount: number | null;
  bench: Benchmark | null;
  /** Counts only: decks received in 90 days and the invested portfolio, by our own sector names */
  decks: { sector: string; count: number }[];
  portfolio: { sector: string; count: number }[];
}

const str = { type: "string" };
const strs = { type: "array", items: str };
const columnSchema = {
  type: "object",
  additionalProperties: false,
  required: ["headline", "standfirst", "body", "takeaways", "watch", "sectors"],
  properties: {
    headline: str,
    standfirst: str,
    body: strs,
    takeaways: strs,
    watch: strs,
    sectors: { type: "array", items: { type: "object", additionalProperties: false, required: ["name", "headline", "text"], properties: { name: str, headline: str, text: str } } },
  },
};
const columnAnswer = z.object({
  headline: z.string(),
  standfirst: z.string(),
  body: z.array(z.string()),
  takeaways: z.array(z.string()),
  watch: z.array(z.string()),
  sectors: z.array(z.object({ name: z.string(), headline: z.string(), text: z.string() })),
});
const weekSchema = { type: "object", additionalProperties: false, required: ["headline", "body", "highlights"], properties: { headline: str, body: strs, highlights: strs } };
const weekAnswer = z.object({ headline: z.string(), body: z.array(z.string()), highlights: z.array(z.string()) });

const voice = [
  "You are the senior editor of a respected Indian financial newspaper's private markets desk, writing for the partners of Niveshaay, a SEBI Category II AIF that writes growth-stage cheques.",
  "Write like a seasoned editor, not a data feed: lead with the one idea that explains the period, make an argument, connect deals into trends, say what is surprising, compare with what came before, and say what to watch. Never just list deals sector by sector. Short, plain, confident sentences. British spelling. No hype, no cliches, no em dashes, no exclamation marks.",
  "Use only the facts given. Never invent a number, investor, valuation or reason. If you infer, say so. Only state dollar figures and percentages that appear in the data or the FIGURES list; do not add up deals yourself except two deals in the same sector. Write money as $66M or $1.16bn.",
  "Every company you name must appear in the data; wrap each company name in [[ ]] exactly as it appears in the data, e.g. [[Blacksmith]]. Acquisitions and debt are context only: the totals are equity.",
].join("\n");

const row = (d: FundingDealItem) =>
  `${d.date} | ${d.company} | ${d.sector} | ${d.kind === "EQUITY" ? d.round : d.kind.toLowerCase()} | ${d.amountUsdM == null ? "undisclosed" : `$${d.amountUsdM}M`} | lead: ${d.lead ?? "-"} | ${d.what ?? ""}${d.ours ? ` | in our deal list (${d.ours})` : ""}`;

function figures(c: Omit<ColumnContext, "label" | "nextMonth">): string[] {
  const s = c.stats;
  const out = [
    `Equity total ${money(s.total)} across ${s.count} rounds (${s.disclosed} with a disclosed amount). Median round ${money(s.median)}. ${s.under5} rounds under $5M.`,
    `Growth and late stage: ${money(s.growth.amount)} across ${s.growth.count} rounds, ${s.growth.share}% of the money.`,
    `By sector: ${s.sectors.map((x) => `${x.name} ${money(x.amount)}, ${x.count} rounds, ${x.share}%`).join("; ")}.`,
  ];
  if (c.prevTotal != null) out.push(`Previous period: ${money(c.prevTotal)} across ${c.prevCount ?? "?"} rounds.`);
  if (c.bench) out.push(`Benchmark: ${c.bench.outlet} reports ${money(c.bench.totalUsdM)} for the month${c.bench.changePct == null ? "" : `, ${c.bench.changePct > 0 ? "up" : "down"} ${Math.abs(c.bench.changePct)}% month on month`}. Our tape is wider: it also counts pre-IPO rounds and traditional businesses. Name the outlet as [[${c.bench.outlet}]].`);
  return out;
}

function context(c: ColumnContext): string[] {
  const eq = c.deals.filter((d) => d.kind === "EQUITY" && !d.hidden);
  const other = c.deals.filter((d) => d.kind !== "EQUITY" && !d.hidden);
  return [
    `Niveshaay's invested portfolio by sector (company counts): ${c.portfolio.map((p) => `${p.sector} ${p.count}`).join(", ") || "not given"}.`,
    `Decks Niveshaay received in the last 90 days by sector: ${c.decks.map((p) => `${p.sector} ${p.count}`).join(", ") || "not given"}.`,
    "",
    "FIGURES:",
    ...figures(c),
    "",
    "EQUITY ROUNDS (date | company | sector | round | US$ | lead | what it does):",
    ...eq.map(row),
    "",
    "NOT EQUITY (acquisitions and debt, for contrast only):",
    ...(other.length ? other.map(row) : ["none"]),
  ];
}

async function write<T>(system: string, prompt: string, schema: unknown, parse: (raw: string) => T, texts: (t: T) => string[], allowed: { dollars: number[]; percents: number[] }, maxTokens: number): Promise<{ data: T; unchecked: string[] }> {
  const ask = (p: string) => aiProvider().generateJson({ system, prompt: p, jsonSchema: schema, model: fundingModel, maxTokens, signal: AbortSignal.timeout(300_000) });
  const first = parse(await ask(prompt));
  const bad = uncheckedFigures(texts(first), allowed);
  if (!bad.length) return { data: first, unchecked: [] };
  const second = parse(await ask(`${prompt}\n\nYour last draft stated figures that are not in the data: ${bad.join(", ")}. Write it again using only figures from the data and the FIGURES list.`));
  const still = uncheckedFigures(texts(second), allowed);
  return still.length <= bad.length ? { data: second, unchecked: still } : { data: first, unchecked: bad };
}

/** The monthly column with a take on every sector that had equity rounds. */
export async function writeColumn(c: ColumnContext): Promise<{ data: FundingColumn; unchecked: string[] }> {
  const sectors = c.stats.sectors.map((s) => s.name);
  const prompt = [
    `Month: ${c.label}.`,
    ...context(c),
    "",
    `Return JSON. headline: under 12 words. standfirst: one sentence, under 30 words. body: 4 to 5 paragraphs, each 60 to 110 words. takeaways: exactly 3 short sentences on what this means for Niveshaay. watch: 2 short sentences on what to watch in ${c.nextMonth}. sectors: one entry for each of these sectors: ${sectors.join("; ")}. For each: name (exactly as given), headline (under 9 words, an argument not a label), text (2 to 3 sentences, under 75 words, naming the deals that matter).`,
  ].join("\n");
  const allowed = allowedFigures(c.deals, c.stats, c.prevTotal, c.bench);
  return write(`${voice}\nThis is the monthly funding column.`, prompt, columnSchema, (raw) => columnAnswer.parse(JSON.parse(raw)), columnTexts, allowed, 9000);
}

/** The weekly note: shorter, what moved this week. */
export async function writeWeekNote(c: Omit<ColumnContext, "nextMonth" | "bench">): Promise<{ data: FundingWeekNote; unchecked: string[] }> {
  const prompt = [
    `Week: ${c.label}.`,
    ...context({ ...c, bench: null, nextMonth: "" }),
    "",
    "Return JSON. headline: under 12 words. body: 2 paragraphs, each 50 to 90 words: the week's story first, then what else stood out. highlights: 2 or 3 short sentences, each one thing a growth-stage investor should note.",
  ].join("\n");
  const allowed = allowedFigures(c.deals, c.stats, c.prevTotal, null);
  return write(`${voice}\nThis is the weekly funding note, read on WhatsApp: keep it tight.`, prompt, weekSchema, (raw) => weekAnswer.parse(JSON.parse(raw)), weekTexts, allowed, 3000);
}
