// Runs the real summary pipeline on a local deck file and prints the markdown (and word count).
// Usage: npx tsx --conditions=react-server scripts/try-summary.mts <path-to-deck.pdf|pptx>
// For checking prompt quality on sample decks; nothing is stored.
import "dotenv/config";
import { readFileSync } from "node:fs";
import path from "node:path";
import { prepareDeck } from "../src/lib/ai/deck";
import { systemPrompt, userPrompt } from "../src/lib/ai/prompt";
import { aiProvider } from "../src/lib/ai/provider";
import { responseJsonSchema, summarySchema } from "../src/lib/ai/schema";
import { SEED_SECTORS } from "../src/lib/domain/constants";
import { buildMarkdown, wordCount } from "../src/lib/summary/markdown";

const file = process.argv[2];
if (!file) throw new Error("Pass a deck path");
const name = path.basename(file);
const deck = await prepareDeck(readFileSync(file), name, name.toLowerCase().endsWith(".pdf") ? "application/pdf" : "");
const t = Date.now();
const text = await aiProvider().generateJson({
  system: systemPrompt(SEED_SECTORS),
  prompt: userPrompt(name, deck.kind === "text" ? deck.text : undefined),
  deck,
  jsonSchema: responseJsonSchema(SEED_SECTORS),
});
const parsed = summarySchema.parse(JSON.parse(text));
const md = buildMarkdown(parsed);
console.log(`--- ${name} (${Date.now() - t} ms, ${wordCount(md)} words) ---`);
console.log(`company: ${parsed.company} | sector: ${parsed.sector} | subSector: ${parsed.subSector}`);
console.log(md || "(empty summary)");
