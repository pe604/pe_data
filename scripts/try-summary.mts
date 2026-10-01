// Runs the real summary pipeline on a local deck file and prints the markdown (and word count).
// Usage: npx tsx --conditions=react-server scripts/try-summary.mts <path-to-deck.pdf|pptx>
// For checking prompt quality on sample decks; nothing is stored.
import "dotenv/config";
import { readFileSync } from "node:fs";
import path from "node:path";
import { prepareDeck } from "../src/lib/ai/deck";
import { summarise } from "../src/lib/ai/summarise";
import { SEED_SECTORS } from "../src/lib/domain/constants";
import { wordCount } from "../src/lib/summary/markdown";

const file = process.argv[2];
if (!file) throw new Error("Pass a deck path");
const name = path.basename(file);
const deck = await prepareDeck(readFileSync(file), name, name.toLowerCase().endsWith(".pdf") ? "application/pdf" : "");
console.log(`deck text: ${deck.text.length} chars`);
const t = Date.now();
const { parsed, markdown, unverified } = await summarise(deck, SEED_SECTORS);
console.log(`--- ${name} (${Date.now() - t} ms, ${wordCount(markdown)} words, ${unverified.length} unverified figures) ---`);
console.log(`company: ${parsed.company} | sector: ${parsed.sector} | subSector: ${parsed.subSector}`);
console.log(markdown || "(empty summary)");
