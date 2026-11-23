// Runs the fit rating (SPEC §17.6–17.8) on a local deck without writing anything, and prints what it found.
//   npx tsx --conditions=react-server scripts/try-fit.mts <deck.pdf|pptx> [--theme T06]
// Reads the current thesis from the database (read only). The summary is written first, as it would be in the app, for
// the business bullets, the financials table and the figure check; its cost is shown separately.
// This terminal output may show deck quotes. Nothing in src/ logs them.
import "dotenv/config";
import { readFileSync } from "node:fs";
import path from "node:path";
import { prepareDeck } from "../src/lib/ai/deck";
import { aiUsage } from "../src/lib/ai/provider";
import { summarise } from "../src/lib/ai/summarise";
import { db } from "../src/lib/db";
import { BLANK_LABELS, hasBannedWord, highlightLabel, meanLabel } from "../src/lib/domain/fit";
import { fitModel, aiModel } from "../src/lib/env";
import { rate, paramsOf } from "../src/lib/fit/rate";
import { currentThesis } from "../src/lib/server/thesis";

const args = process.argv.slice(2);
const file = args.find((a) => !a.startsWith("--") && args[args.indexOf(a) - 1] !== "--theme");
const ti = args.indexOf("--theme");
const themeOverride = ti >= 0 ? (args[ti + 1] ?? null) : undefined;
if (!file) throw new Error("Pass a deck path");

const name = path.basename(file);
const rows = await currentThesis();
const sectors = (await db.sector.findMany({ orderBy: { sortOrder: "asc" } })).map((s) => s.name);
const deck = await prepareDeck(readFileSync(file), name, name.toLowerCase().endsWith(".pdf") ? "application/pdf" : "");
console.log(`deck: ${name}, ${deck.text.length} characters of text${deck.text.trim() ? "" : " (scanned: quotes cannot be checked)"}`);
console.log(`models: reading ${aiModel}, scoring ${fitModel}`);

const t0 = Date.now();
const summary = await summarise(deck, sectors);
const summaryCost = aiUsage.costUsd;
const summaryCalls = aiUsage.calls;
console.log(`summary: ${summary.unverified.length} figures not found in the deck, US$${summaryCost.toFixed(4)} (${summaryCalls} calls)\n`);

const holdings = async (code: string | null) =>
  code ? (await db.company.findMany({ where: { status: "INVESTED", themeCode: code }, select: { name: true }, orderBy: { name: "asc" } })).map((c) => c.name) : [];
const holdingNames = new Map<string | null, string[]>();
for (const r of rows) if (r.kind === "THEME") holdingNames.set(r.code, await holdings(r.code));

const r = await rate({
  rows,
  source: { deck },
  company: { themeCode: null, themeEdited: false, stage: "NOT_ASSIGNED" },
  themeOverride,
  financials: summary.parsed.financials ?? null,
  unverified: summary.unverified.length,
  business: (summary.parsed.business ?? []).filter((b): b is string => !!b),
  holdingsFor: (code) => holdingNames.get(code) ?? [],
  seenBefore: null,
  inputs: [],
  previousHighlights: [],
});

const theme = rows.find((x) => x.kind === "THEME" && x.code === r.themeCode);
console.log(`theme: reading says ${r.facts.theme ?? "none"}; rated against ${r.themeCode ?? "none"}${theme && theme.kind === "THEME" ? ` (${theme.data.name}, ${theme.data.status})` : ""}`);
console.log(`quotes: ${r.read?.kept ?? 0} kept, ${r.read?.dropped ?? 0} dropped${r.unchecked ? " (scanned deck: not checked)" : ""}; numbers set to null: ${r.read?.nulled.join(", ") || "none"}`);
console.log(`numbers: ${JSON.stringify(r.facts.numbers)}`);
console.log(`qualification quotes: ${r.facts.qualification.length} kept, ${r.read?.droppedBy.qualification ?? 0} dropped`);
for (const q of r.facts.qualification) console.log(`    "${q.text}" (p. ${q.page ?? "?"})`);
console.log("");

const params = paramsOf(rows);
const banned: string[] = [];
for (const p of params) {
  const s = r.scores.find((x) => x.code === p.code);
  if (!s) continue;
  const quotes = r.facts.quotes[p.code] ?? [];
  const final = s.score === null ? `blank (${s.blank ? BLANK_LABELS[s.blank] : "?"})` : String(s.score);
  const readings = s.readings.length ? `readings ${s.readings.map((x) => x ?? "null").join(" and ")}, ` : "";
  console.log(`${p.code} ${p.name} [${p.group}, ${p.source}]: ${readings}final ${final}${s.anchor ? `, closest to ${s.anchor}` : ""}`);
  if (p.source === "DECK") console.log(`    quotes ${quotes.length} kept, ${r.read?.droppedBy[p.code] ?? 0} dropped`);
  for (const q of quotes) console.log(`    "${q.text}" (p. ${q.page ?? "?"})`);
  if (s.why) console.log(`    why: ${s.why}`);
  if (hasBannedWord(s.why)) banned.push(p.code);
}
console.log("");
console.log(meanLabel("Fit", r.means.fit, r.means.fitScored, r.means.fitTotal));
console.log(meanLabel("Promise", r.means.promise, r.means.promiseScored, r.means.promiseTotal));
console.log(`highlights: ${r.highlights.map(highlightLabel).join(", ") || "none"}`);
console.log("flags:");
for (const f of r.flags) console.log(`    ${f.code}: ${f.value}${f.note ? `  ${f.note}` : ""}`);
for (const f of r.flags) if (hasBannedWord(f.value)) banned.push(f.code);
console.log(`\nbanned words: ${banned.length ? banned.join(", ") : "none"}`);
console.log(`fit cost: US$${(aiUsage.costUsd - summaryCost).toFixed(4)} (${aiUsage.calls - summaryCalls} calls); with the summary US$${aiUsage.costUsd.toFixed(4)}; ${Math.round((Date.now() - t0) / 1000)} s`);
await db.$disconnect();
