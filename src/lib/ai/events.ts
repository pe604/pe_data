import "server-only";
import { z } from "zod";
import { EVENT_KINDS, EVENT_SECTORS, EVENT_TIERS } from "@/lib/domain/events";
import type { RawItem } from "@/lib/domain/news";
import { aiProvider } from "./provider";

// The events scan's AI filter (SPEC §15.14). Text only, cheap model, data_collection deny (set by the provider).
// Never log the items or the model's output.

const MODEL = "google/gemini-2.5-flash";

export type EventCandidate = RawItem & { key: string; source: "NEWS" | "LINKEDIN" };

const found = z.object({
  key: z.string(),
  keep: z.boolean(),
  name: z.string(),
  kind: z.enum(EVENT_KINDS),
  sector: z.enum(EVENT_SECTORS),
  tier: z.enum(EVENT_TIERS),
  start_date: z.string().nullable(),
  end_date: z.string().nullable(),
  city: z.string().nullable(),
  organiser: z.string().nullable(),
  why: z.string(),
});
export type FoundEvent = z.infer<typeof found>;

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
        required: ["key", "keep", "name", "kind", "sector", "tier", "start_date", "end_date", "city", "organiser", "why"],
        properties: {
          key: { type: "string" },
          keep: { type: "boolean" },
          name: { type: "string" },
          kind: { type: "string", enum: [...EVENT_KINDS] },
          sector: { type: "string", enum: [...EVENT_SECTORS] },
          tier: { type: "string", enum: [...EVENT_TIERS] },
          start_date: { type: ["string", "null"] },
          end_date: { type: ["string", "null"] },
          city: { type: ["string", "null"] },
          organiser: { type: ["string", "null"] },
          why: { type: "string" },
        },
      },
    },
  },
};

const system = [
  "You screen news and LinkedIn posts for a private equity fund in India, looking for events its deal team should attend.",
  "Keep an item only if it announces a specific, named, in-person event that has not happened yet, in India or aimed at Indian investors, and that is one of:",
  "- networking between PE / VC firms, founders and investors, such as a fund showcasing its portfolio companies or a demo day (kind NETWORKING);",
  "- a conference run by an investment bank or for its clients (kind BANKER);",
  "- a family office forum (kind FAMILY_OFFICE);",
  `- a major trade expo or summit in one of these sectors only: ${EVENT_SECTORS.filter((s) => s !== "Multi-sector").join(", ")} (kind SECTOR_EXPO). Drop shows in any other field, such as agriculture, poultry, food, textiles, real estate or healthcare.`,
  "Drop reports on events already over, webinars, awards, college fests, generic business summits, job fairs, state investor meets with no investor angle, and small local meetups.",
  "tier: TOP only for a flagship event in its field, attended by leading investors or the whole industry. Otherwise WORTH_A_LOOK.",
  "start_date and end_date: YYYY-MM-DD, only if the item states them. Never guess or work out a date; use null.",
  "city, organiser: as stated, else null. name: the event's proper name with its year if stated.",
  "why: one plain sentence on why it matters to a PE investor (max 160 characters). For dropped items use an empty string.",
  "Return one entry per item, with its key. When keep is false, fill the other fields with any valid value.",
].join("\n");

export async function judgeEvents(today: string, items: EventCandidate[], opts: { signal?: AbortSignal } = {}): Promise<FoundEvent[]> {
  const prompt = [
    `Today: ${today}`,
    "",
    "Items:",
    ...items.map((i) =>
      [
        `[${i.key}] ${i.source === "LINKEDIN" ? `LinkedIn post, ${i.outlet ?? ""}` : `News, ${i.outlet ?? "unknown outlet"}`}${i.publishedAt ? `, ${i.publishedAt.slice(0, 10)}` : ""}`,
        `Title: ${i.title}`,
        i.text && i.text !== i.title ? `Text: ${i.text.slice(0, 800)}` : "",
      ]
        .filter(Boolean)
        .join("\n"),
    ),
  ].join("\n");
  const raw = await aiProvider().generateJson({ system, prompt, jsonSchema: schema, model: MODEL, signal: opts.signal, maxTokens: 8000 });
  const parsed = z.object({ items: z.array(found) }).parse(JSON.parse(raw));
  return parsed.items.filter((v) => v.keep && items.some((i) => i.key === v.key));
}
