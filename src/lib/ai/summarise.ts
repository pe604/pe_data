import "server-only";
import { z } from "zod";
import { buildMarkdown } from "@/lib/summary/markdown";
import { cleanFinancials, pagesWithFigures, unverifiedFigures } from "@/lib/summary/verify";
import { correctionPrompt, ownershipPrompt, ownershipSchema, ownershipSystem, systemPrompt, userPrompt } from "./prompt";
import { aiProvider, type AiProvider, type DeckInput } from "./provider";
import { responseJsonSchema, summarySchema, type SummaryOutput } from "./schema";

export interface SummaryResult {
  parsed: SummaryOutput;
  markdown: string;
  /** Financial figures still not found in the deck text after one correction ("FY26 Revenue 208.0"). */
  unverified: string[];
}

/** A yes/no question on a few pages of text: the cheaper model is enough. */
const CHECK_MODEL = "google/gemini-2.5-flash";

/**
 * Deck → validated summary (SPEC §9).
 * 1. JSON validated with zod (one retry). Financial rows not labelled as a metric (e.g. "Bharat Dynamics Ltd") are dropped.
 * 2. Every financial figure is checked against the deck's text; if any is missing, one corrective pass.
 * 3. A separate check confirms the table is the company's OWN figures, not peers, market sizes or order values;
 *    if not, the financials are removed. Decks without their own financials get no table.
 */
export async function summarise(deck: DeckInput, sectors: string[], signal?: AbortSignal): Promise<SummaryResult> {
  const provider = aiProvider();
  const base = { system: systemPrompt(sectors), deck, jsonSchema: responseJsonSchema(sectors), signal };

  const ask = async (prompt: string): Promise<SummaryOutput | null> => {
    for (let attempt = 0; attempt < 2; attempt++) {
      const text = await provider.generateJson({ ...base, prompt });
      try {
        const r = summarySchema.safeParse(JSON.parse(text));
        if (r.success) return cleanFinancials(r.data);
      } catch {
        /* retry */
      }
    }
    return null;
  };

  let parsed = await ask(userPrompt(deck));
  if (!parsed) throw new Error("invalid_json");
  let unverified = unverifiedFigures(parsed, deck.text) ?? [];

  if (unverified.length) {
    const second = await ask(correctionPrompt(deck, unverified));
    const again = second ? (unverifiedFigures(second, deck.text) ?? []) : null;
    if (second && again && again.length < unverified.length) {
      parsed = second;
      unverified = again;
    }
  }

  if (parsed.financials && !(await isOwnFinancials(provider, parsed, deck, signal))) {
    parsed = { ...parsed, financials: null };
    unverified = [];
  }

  return { parsed, markdown: buildMarkdown(parsed, unverified), unverified };
}

const ownAnswer = z.object({ own: z.boolean() });

/** Exported for scripts/tests; summarise() calls it whenever the summary has a financials table. */
export async function isOwnFinancials(provider: AiProvider, parsed: SummaryOutput, deck: DeckInput, signal?: AbortSignal) {
  const pages = pagesWithFigures(parsed, deck.text);
  const req = {
    system: ownershipSystem,
    prompt: ownershipPrompt(parsed.company, buildMarkdown({ financials: parsed.financials }), pages),
    // With the pages' text in the prompt, the PDF isn't needed; scanned decks (no text) get the PDF instead.
    deck: pages.length ? ({ kind: "text", text: "", fileName: deck.fileName } as const) : deck,
    jsonSchema: ownershipSchema,
    signal,
    model: CHECK_MODEL,
  };
  let lastError: unknown = new Error("invalid_json");
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const r = ownAnswer.safeParse(JSON.parse(await provider.generateJson(req)));
      if (r.success) return r.data.own;
    } catch (e) {
      lastError = e;
    }
  }
  // Never show unconfirmed figures as the company's own: fail the job so it can be generated again.
  throw lastError;
}
