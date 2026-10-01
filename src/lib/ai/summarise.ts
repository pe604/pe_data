import "server-only";
import { buildMarkdown } from "@/lib/summary/markdown";
import { unverifiedFigures } from "@/lib/summary/verify";
import { correctionPrompt, systemPrompt, userPrompt } from "./prompt";
import { aiProvider, type DeckInput } from "./provider";
import { responseJsonSchema, summarySchema, type SummaryOutput } from "./schema";

export interface SummaryResult {
  parsed: SummaryOutput;
  markdown: string;
  /** Financial figures still not found in the deck text after one correction ("FY26 Revenue 208.0"). */
  unverified: string[];
}

/**
 * Deck → validated summary (SPEC §9). The JSON is validated with zod (one retry), then every financial figure is
 * checked against the deck's own text; if any is missing, the model gets one corrective pass and the better answer
 * is kept. Figures that still don't match are listed in the summary instead of passing silently.
 */
export async function summarise(deck: DeckInput, sectors: string[], signal?: AbortSignal): Promise<SummaryResult> {
  const provider = aiProvider();
  const base = { system: systemPrompt(sectors), deck, jsonSchema: responseJsonSchema(sectors), signal };

  const ask = async (prompt: string): Promise<SummaryOutput | null> => {
    for (let attempt = 0; attempt < 2; attempt++) {
      const text = await provider.generateJson({ ...base, prompt });
      try {
        const r = summarySchema.safeParse(JSON.parse(text));
        if (r.success) return r.data;
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

  return { parsed, markdown: buildMarkdown(parsed, unverified), unverified };
}
