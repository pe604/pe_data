import "server-only";
import { z } from "zod";
import { userPrompt } from "@/lib/ai/prompt";
import { aiProvider, type DeckInput } from "@/lib/ai/provider";
import { aiModel } from "@/lib/env";
import { checkNumbers, checkQuotes, factsZ, MAX_QUOTE_WORDS, MAX_QUOTES, NUMBER_KEYS, type Facts, type FitParam, type NumberKey } from "@/lib/domain/fit";
import type { ThemeOption } from "@/lib/domain/thesis";

// Step 1 of the fit rating (SPEC §17.6): one call with the deck, the same model and deck preparation as the summary.
// It extracts; it does not judge. Every quote and number is then checked against the deck's text layer by code.
// Never log the deck, the prompt or the answer.

export interface ReadResult {
  facts: Facts;
  kept: number;
  dropped: number;
  /** Quotes dropped per parameter code (and "qualification"): not word for word in the deck, too long, or too many */
  droppedBy: Record<string, number>;
  /** Numbers set to null because they were not in the deck text */
  nulled: NumberKey[];
  /** No text layer: quotes could not be checked */
  unchecked: boolean;
}

const quote = { type: "object", additionalProperties: false, required: ["text", "page"], properties: { text: { type: "string" }, page: { type: ["integer", "null"] } } };
const quotes = { type: "array", items: quote };
const nullable = (type: string) => ({ type: [type, "null"] });

function schema(params: FitParam[], themes: ThemeOption[]) {
  return {
    type: "object",
    additionalProperties: false,
    required: ["theme", "quotes", "qualification", "numbers", "flagQuotes"],
    properties: {
      theme: { type: ["string", "null"], enum: [...themes.map((t) => t.code), null] },
      quotes: { type: "object", additionalProperties: false, required: params.map((p) => p.code), properties: Object.fromEntries(params.map((p) => [p.code, quotes])) },
      qualification: quotes,
      numbers: {
        type: "object",
        additionalProperties: false,
        required: ["unit", "lastActualYear", "nextPlanYear", ...NUMBER_KEYS],
        properties: {
          unit: { type: ["string", "null"], enum: ["INR_CR", "USD_MN", null] },
          lastActualYear: nullable("string"),
          nextPlanYear: nullable("string"),
          ...Object.fromEntries(NUMBER_KEYS.map((k) => [k, nullable("number")])),
        },
      },
      flagQuotes: { type: "object", additionalProperties: false, required: ["relatedParty", "subsidyProfit"], properties: { relatedParty: quotes, subsidyProfit: quotes } },
    },
  };
}

const SYSTEM = [
  "You read a company's pitch deck for a private equity fund in India and copy out evidence. You extract; you never judge, rate or give opinions.",
  `Quotes: copy text word for word from the deck, never paraphrase, never join sentences from different places. Each quote at most ${MAX_QUOTE_WORDS} words, at most ${MAX_QUOTES} per question, with the page (or slide) number it is on. Prefer quotes with a number, a name or a date. Use an empty list when the deck does not answer the question.`,
  "Numbers: as printed in the deck, as plain numbers (no commas, no units, no % sign). Losses are negative. Use the deck's own unit: INR_CR when the deck states crores of rupees, USD_MN when it states millions of US dollars; if the deck uses lakhs or another unit, use null for the unit and for the figures. Null when the deck does not state a figure.",
  "Last actual year: the latest year with actual (not projected, estimated or planned) figures. Projected years such as FY27E or FY28P are never the last actual year. Next plan year: the first projected year.",
  "Theme: the one theme code the company clearly sits in, or null.",
].join("\n");

function prompt(deck: DeckInput, params: FitParam[], themes: (ThemeOption & { keywords: string[] })[]): string {
  return [
    "Questions (copy the quotes that answer each, under its code):",
    ...params.map((p) => `${p.code} ${p.name}: ${p.question}`),
    "",
    "qualification: quotes where the deck says the company is an approved, qualified, certified or registered vendor or supplier of a named buyer or regulator (for example a defence lab, a space agency, an aircraft maker or a utility).",
    "flagQuotes.relatedParty: quotes about dealings with entities linked to the founders or promoters.",
    "flagQuotes.subsidyProfit: quotes showing profit depends on a subsidy, incentive scheme or concessional credit.",
    "numbers: unit, lastActualYear, lastActualRevenue, lastActualEbitda, lastActualPat, nextPlanYear, nextPlanRevenue, orderBook (signed orders in hand), raise (this round's size), preMoney (pre-money valuation asked), secondaryPct (share of the round going to sellers), topCustomerPct (largest customer's share of revenue), schemeSharePct (share of revenue from one government scheme or mandate), receivableDays, capexPlanned, newDebt.",
    "",
    "Themes (code: name; keywords):",
    ...themes.map((t) => `${t.code}: ${t.name}${t.keywords.length ? `; ${t.keywords.join(", ")}` : ""}`),
    "",
    userPrompt(deck),
  ].join("\n");
}

/** Reads the deck once, then checks every quote and number against its text layer (§17.6). */
export async function readDeck(deck: DeckInput, params: FitParam[], themes: (ThemeOption & { keywords: string[] })[], signal?: AbortSignal): Promise<ReadResult> {
  const deckParams = params.filter((p) => p.source === "DECK");
  const req = { system: SYSTEM, prompt: prompt(deck, deckParams, themes), deck, jsonSchema: schema(deckParams, themes), model: aiModel, signal, maxTokens: 12_000 };
  let facts: Facts | null = null;
  for (let attempt = 0; attempt < 2 && !facts; attempt++) {
    try {
      const r = factsZ.safeParse(JSON.parse(await aiProvider().generateJson(req)));
      if (r.success) facts = r.data;
    } catch (e) {
      if (e instanceof SyntaxError || e instanceof z.ZodError) continue;
      throw e;
    }
  }
  if (!facts) throw new Error("invalid_json");
  const got: Facts = facts;
  // A theme the model made up, or a cross-sector one, is dropped. Every DECK parameter has a list, even when left out.
  const raw: Facts = {
    ...got,
    theme: got.theme && themes.some((t) => t.code === got.theme && !t.crossSector) ? got.theme : null,
    quotes: Object.fromEntries(deckParams.map((p) => [p.code, got.quotes[p.code] ?? []])),
  };
  const q = checkQuotes(raw, deck.text);
  const n = checkNumbers(q.facts, deck.text);
  const droppedBy = Object.fromEntries(Object.keys(raw.quotes).map((k) => [k, (raw.quotes[k]?.length ?? 0) - (q.facts.quotes[k]?.length ?? 0)]));
  droppedBy.qualification = raw.qualification.length - q.facts.qualification.length;
  return { facts: n.facts, kept: q.kept, dropped: q.dropped, droppedBy, nulled: n.nulled, unchecked: q.unchecked };
}
