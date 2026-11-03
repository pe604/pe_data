import "server-only";
import { z } from "zod";
import { DEAL_KINDS, FUNDING_SECTOR_NAMES, type ExtractedDeal } from "@/lib/domain/funding";
import { aiProvider } from "./provider";

// Reads funding deals from news headlines (SPEC §15.16). Headlines only, a cheap model, data_collection deny (set by
// the provider). Never log the headlines or the output.

const MODEL = "google/gemini-2.5-flash";

const answer = z.object({
  deals: z.array(
    z.object({
      key: z.string(),
      company: z.string(),
      amount: z.number().nullable(),
      currency: z.enum(["USD", "INR_CR", "EUR", "NONE"]),
      round: z.string(),
      kind: z.enum(DEAL_KINDS),
      status: z.enum(["DONE", "TALKS"]),
      indian: z.boolean(),
      listed: z.boolean(),
      startup: z.boolean(),
      investors: z.array(z.string()),
      lead: z.string().nullable(),
      sector: z.string(),
      what: z.string(),
    }),
  ),
});

const str = { type: "string" };
const schema = {
  type: "object",
  additionalProperties: false,
  required: ["deals"],
  properties: {
    deals: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["key", "company", "amount", "currency", "round", "kind", "status", "indian", "listed", "startup", "investors", "lead", "sector", "what"],
        properties: {
          key: str,
          company: str,
          amount: { type: ["number", "null"] },
          currency: { type: "string", enum: ["USD", "INR_CR", "EUR", "NONE"] },
          round: str,
          kind: { type: "string", enum: [...DEAL_KINDS] },
          status: { type: "string", enum: ["DONE", "TALKS"] },
          indian: { type: "boolean" },
          listed: { type: "boolean" },
          startup: { type: "boolean" },
          investors: { type: "array", items: str },
          lead: { type: ["string", "null"] },
          sector: { type: "string", enum: [...FUNDING_SECTOR_NAMES] },
          what: str,
        },
      },
    },
  },
};

const system = [
  "You extract funding deals from news headlines about Indian companies. Return one entry per headline that reports a specific investment into a named company. Skip fund launches, weekly or monthly roundups, reports, layoffs, earnings, IPO news and opinion.",
  "Only money put into the company counts. An order, a contract, revenue, a valuation, an IPO or anchor allotment, a grant, or shares bought from existing shareholders (a secondary sale) is not a funding deal: skip it.",
  "key: the headline's key. company: the company that received the money, as named.",
  "amount: the number as stated. currency: USD for dollars with amount in millions; INR_CR for rupees with amount in crore (convert lakh to crore); EUR in millions; NONE if undisclosed, with amount null.",
  "round: as stated (Pre-seed, Seed, Pre-Series A, Series A, Series B, Pre-IPO, Unspecified).",
  "kind: EQUITY for a funding round; DEBT for loans, venture debt, bonds or NCDs; ACQUISITION when a fund or company buys control or a majority, or acquires the company.",
  "status: DONE if raised, closed or announced; TALKS if in talks, planning, set to or looking to raise.",
  "indian: true if the company is Indian or mainly operates in India. listed: true if the company is listed on a stock exchange (e.g. Swiggy, Eternal, Lenskart, Meesho, Pine Labs, Groww, Ola Electric) or the deal is a share sale, block deal, QIP, anchor book or secondary sale.",
  "startup: true for a startup or a privately held growth company; false for a large established corporate, a conglomerate subsidiary, a joint venture between companies, a bank, an insurer, a PSU or a government body.",
  "investors: names stated. lead: the lead investor if stated, else null.",
  "sector: the best fit from the list. Energy transition covers solar, wind, batteries, green hydrogen, recycling and climate. Deep tech and space covers semiconductors, electronics, quantum, robotics and space. Defence covers defence, drones and security hardware.",
  "what: what the company does in at most 8 words, only if the headline says; else empty. Never guess a figure.",
].join("\n");

/** One batch of headlines (keys like "H12"). */
export async function extractDeals(headlines: { key: string; title: string }[]): Promise<ExtractedDeal[]> {
  const prompt = headlines.map((h) => `[${h.key}] ${h.title}`).join("\n");
  const raw = await aiProvider().generateJson({ system, prompt, jsonSchema: schema, model: MODEL, maxTokens: 16000 });
  return answer.parse(JSON.parse(raw)).deals;
}
