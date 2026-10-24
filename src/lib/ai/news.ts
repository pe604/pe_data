import "server-only";
import { z } from "zod";
import { IMPORTANCE, NEWS_CATEGORIES, type RawItem } from "@/lib/domain/news";
import { aiProvider } from "./provider";

// The news agent's AI filter (SPEC §15.10). Text only, cheaper model, data_collection deny (set by the provider).
// Never log the items or the model's output.

const MODEL = "google/gemini-2.5-flash";

export interface CompanyProfile {
  name: string;
  names: string[];
  sector: string | null;
  subSector: string | null;
  website: string | null;
}

export type Candidate = RawItem & { key: string; source: "NEWS" | "LINKEDIN" };

const verdict = z.object({
  key: z.string(),
  about_company: z.boolean(),
  material: z.boolean(),
  repeat: z.boolean(),
  category: z.enum(NEWS_CATEGORIES),
  importance: z.enum(IMPORTANCE),
  summary: z.string(),
});
export type Verdict = z.infer<typeof verdict>;

const schema = {
  type: "object",
  additionalProperties: false,
  required: ["items"],
  properties: {
    items: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["key", "about_company", "material", "repeat", "category", "importance", "summary"],
        properties: {
          key: { type: "string" },
          about_company: { type: "boolean" },
          material: { type: "boolean" },
          repeat: { type: "boolean" },
          category: { type: "string", enum: [...NEWS_CATEGORIES] },
          importance: { type: "string", enum: [...IMPORTANCE] },
          summary: { type: "string" },
        },
      },
    },
  },
};

const system = [
  "You screen news and LinkedIn posts for a private equity fund in India that has invested in the company below.",
  "For each item decide:",
  "- about_company: true only if the item is really about THIS company (not another company with a similar name, not a passing mention). Use the sector, website and names to tell them apart.",
  "- material: true if it matters to an investor: a product launch; a big order, contract or tender win; a fundraise, valuation, acquisition, merger or IPO plan; expansion, a new plant or capacity; a key management or board change; regulatory, tax or legal action; financial results; negative news (fraud, default, layoffs, accident, recall, dispute, raid). Routine marketing, hiring posts, events and webinars, greetings, thought leadership and minor awards are NOT material.",
  "- repeat: true if it reports the same event as one of the already recorded updates, or as an earlier item in this list.",
  "- category: the best fit from the list; OTHER if none.",
  "- importance: high for a big order, fundraise / M&A / IPO, negative news, regulatory or legal action, or a key person leaving; medium for other material items; low otherwise.",
  "- summary: one plain sentence (max 200 characters) with the concrete facts (amounts, customer, product, place). No hype, no emojis.",
  "Return one entry per item, with its key. Use only what the item says; do not guess numbers.",
].join("\n");

/** Judges a company's new items in one call. Items the model leaves out are returned as not judged. */
export async function judgeItems(company: CompanyProfile, items: Candidate[], recent: string[], signal?: AbortSignal): Promise<Map<string, Verdict>> {
  const prompt = [
    `Company: ${company.name}`,
    company.names.length ? `Also known as: ${company.names.join(", ")}` : "",
    company.sector ? `Sector: ${company.sector}${company.subSector ? ` (${company.subSector})` : ""}` : "",
    company.website ? `Website: ${company.website}` : "",
    "",
    "Already recorded updates (last 30 days):",
    recent.length ? recent.map((r) => `- ${r}`).join("\n") : "- none",
    "",
    "Items:",
    ...items.map((i) =>
      [
        `[${i.key}] ${i.source === "LINKEDIN" ? "LinkedIn post by the company" : `News, ${i.outlet ?? "unknown outlet"}`}${i.publishedAt ? `, ${i.publishedAt.slice(0, 10)}` : ""}`,
        `Title: ${i.title}`,
        i.text && i.text !== i.title ? `Text: ${i.text.slice(0, 1200)}` : "",
      ]
        .filter(Boolean)
        .join("\n"),
    ),
  ]
    .filter((l) => l !== null)
    .join("\n");
  const raw = await aiProvider().generateJson({ system, prompt, jsonSchema: schema, model: MODEL, signal });
  const parsed = z.object({ items: z.array(verdict) }).parse(JSON.parse(raw));
  return new Map(parsed.items.filter((v) => items.some((i) => i.key === v.key)).map((v) => [v.key, { ...v, summary: v.summary.trim().slice(0, 300) }]));
}
