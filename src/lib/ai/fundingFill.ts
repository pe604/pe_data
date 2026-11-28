import "server-only";
import { z } from "zod";
import { unnamedCompany, type FillAnswer, type FillResult } from "@/lib/domain/funding";
import { webSearchJson } from "./provider";

// Fills a funding round's gaps from a web search (SPEC §15.16): public news only, the cheap model, about US$0.01 a
// round. Code checks every field against the results (fillPatch). Never log the results or the answer.

const MODEL = "google/gemini-2.5-flash";

const answer = z.object({
  company: z.string(),
  companyQuote: z.string(),
  what: z.string(),
  amount: z.number().nullable(),
  currency: z.enum(["USD", "INR_CR", "EUR", "NONE"]),
  amountQuote: z.string(),
  round: z.string(),
  lead: z.string().nullable(),
});

const schema = {
  type: "object",
  additionalProperties: false,
  required: ["company", "companyQuote", "what", "amount", "currency", "amountQuote", "round", "lead"],
  properties: {
    company: { type: "string" },
    companyQuote: { type: "string" },
    what: { type: "string" },
    amount: { type: ["number", "null"] },
    currency: { type: "string", enum: ["USD", "INR_CR", "EUR", "NONE"] },
    amountQuote: { type: "string" },
    round: { type: "string" },
    lead: { type: ["string", "null"] },
  },
};

const system = [
  "You find the facts of one Indian startup funding round in web search results. Use only what the results say; never guess.",
  "Make sure a result is about this round (the company, the investors named, the month reported), not an earlier round of the same company.",
  "company: only when the company is described but not named (e.g. 'Indian consumer-focused firm'), its real name as a result states it; else empty. companyQuote: the exact words from one result that name it together with the investor; empty when company is empty.",
  "what: what the company does, at most 8 words, plain (e.g. 'precision engineering and manufacturing platform'). Empty if no result says.",
  "amount: the amount raised in this round as a result states it. currency: USD with amount in millions; INR_CR with amount in crore (convert lakh to crore); EUR in millions; NONE with amount null when no result states it.",
  "amountQuote: the exact words, copied from one result, that state that amount (e.g. 'Rs 300 crore'). Empty when amount is null.",
  "round: as stated (Seed, Pre-Series A, Series A, Series B, Pre-IPO); empty if not stated.",
  "lead: the lead investor if a result names one, else null.",
].join("\n");

export async function searchRound(d: { company: string; date: string; round: string; lead: string | null; investors: string[]; what: string | null }): Promise<{ answer: FillAnswer; results: FillResult[] }> {
  const known = [
    unnamedCompany(d.company) ? `The headline did not name the company; it called it "${d.company}". Find its name.` : `Company: ${d.company}${d.what ? ` (${d.what})` : ""}`,
    `Reported: ${d.date}`,
    d.round !== "Undisclosed round" ? `Round: ${d.round}` : null,
    d.lead ? `Lead investor: ${d.lead}` : null,
    d.investors.length ? `Investors: ${d.investors.join(", ")}` : null,
    "Find this funding round's company name if unknown, amount, round, lead investor and what the company does.",
  ].filter(Boolean);
  const r = await webSearchJson({ system, prompt: known.join("\n"), jsonSchema: schema, model: MODEL, maxResults: 5 });
  return { answer: answer.parse(JSON.parse(r.text)), results: r.results };
}
