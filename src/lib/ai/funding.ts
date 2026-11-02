import "server-only";
import { z } from "zod";
import type { SectorProposal } from "@/lib/domain/eventSectors";
import { aiProvider } from "./provider";

// The monthly funding check's AI step (SPEC §15.15). Headlines only, cheap model, data_collection deny (set by the
// provider). Our own deck flow goes in as sector counts, never company names. Never log the items or the output.

const MODEL = "google/gemini-2.5-flash";

const answer = z.object({
  summary: z.string(),
  sectors: z.array(z.object({ name: z.string(), keys: z.array(z.string()) })),
  new_sectors: z.array(z.object({ name: z.string(), keywords: z.array(z.string()), query: z.string(), why: z.string(), evidence_keys: z.array(z.string()) })),
});
export type FundingRead = z.infer<typeof answer> & { new_sectors: SectorProposal[] };

const strings = { type: "array", items: { type: "string" } };
const schema = {
  type: "object",
  additionalProperties: false,
  required: ["summary", "sectors", "new_sectors"],
  properties: {
    summary: { type: "string" },
    sectors: {
      type: "array",
      items: { type: "object", additionalProperties: false, required: ["name", "keys"], properties: { name: { type: "string" }, keys: strings } },
    },
    new_sectors: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["name", "keywords", "query", "why", "evidence_keys"],
        properties: { name: { type: "string" }, keywords: strings, query: { type: "string" }, why: { type: "string" }, evidence_keys: strings },
      },
    },
  },
};

const system = [
  "You help a growth-stage private equity fund in India see where venture and growth money is going, so it can track the right industries.",
  "You get recent funding headlines, each with a key, the sectors already tracked, and how many decks the fund received per sector in the last 90 days.",
  "sectors: group the headlines that report an actual investment in an Indian company by sector, using tracked sector names where they fit. keys: the headline keys in that sector. Each headline goes in one sector at most. Skip fund launches, opinion pieces and repeats of the same deal.",
  "new_sectors: only an industry that is clearly attracting money, is not covered by any tracked sector, and is a real operating industry a growth fund could back. Usually this is empty. Never suggest real estate, roads, ports, hospitality, sports, media, crypto, or a slice of a tracked sector.",
  "For each new sector: name (short), keywords (3 to 6 lowercase words that would appear in the name of a trade show for it), query (a Google News search for its events in India, using OR), why (one plain sentence), evidence_keys (the headlines showing the money).",
  "summary: two plain sentences on where money went and what changed. Use only what the headlines show. Do not state totals they don't give.",
].join("\n");

export async function readFunding(headlines: { key: string; title: string }[], tracked: string[], decks: { sector: string; count: number }[]): Promise<FundingRead> {
  const prompt = [
    `Tracked sectors: ${tracked.join("; ")}`,
    "",
    "Decks received, last 90 days:",
    ...decks.map((d) => `${d.sector}: ${d.count}`),
    "",
    "Headlines:",
    ...headlines.map((h) => `[${h.key}] ${h.title}`),
  ].join("\n");
  const raw = await aiProvider().generateJson({ system, prompt, jsonSchema: schema, model: MODEL, maxTokens: 8000 });
  return answer.parse(JSON.parse(raw));
}
