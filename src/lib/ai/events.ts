import "server-only";
import { z } from "zod";
import type { ListingItem } from "@/lib/domain/eventListings";
import { EVENT_KINDS, EVENT_TIERS } from "@/lib/domain/events";
import type { RawItem } from "@/lib/domain/news";
import { aiProvider } from "./provider";

// The events scan's AI filter (SPEC §15.14). Text only, cheap model, data_collection deny (set by the provider).
// Never log the items or the model's output.

const MODEL = "google/gemini-2.5-flash";

export type EventCandidate = RawItem & { key: string; source: "NEWS" | "LINKEDIN" | "LISTING"; listing?: ListingItem };

const found = z.object({
  key: z.string(),
  keep: z.boolean(),
  name: z.string(),
  kind: z.enum(EVENT_KINDS),
  sector: z.string(),
  tier: z.enum(EVENT_TIERS),
  start_date: z.string().nullable(),
  end_date: z.string().nullable(),
  city: z.string().nullable(),
  organiser: z.string().nullable(),
  venue: z.string().nullable(),
  description: z.string(),
  why: z.string(),
  same_as: z.string().nullable(),
});
export type FoundEvent = z.infer<typeof found>;

const schema = (sectors: string[]) => ({
  type: "object",
  additionalProperties: false,
  required: ["items"],
  properties: {
    items: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["key", "keep", "name", "kind", "sector", "tier", "start_date", "end_date", "city", "organiser", "venue", "description", "why", "same_as"],
        properties: {
          key: { type: "string" },
          keep: { type: "boolean" },
          name: { type: "string" },
          kind: { type: "string", enum: [...EVENT_KINDS] },
          sector: { type: "string", enum: sectors },
          tier: { type: "string", enum: [...EVENT_TIERS] },
          start_date: { type: ["string", "null"] },
          end_date: { type: ["string", "null"] },
          city: { type: ["string", "null"] },
          organiser: { type: ["string", "null"] },
          venue: { type: ["string", "null"] },
          description: { type: "string" },
          why: { type: "string" },
          same_as: { type: ["string", "null"] },
        },
      },
    },
  },
});

const system = (sectors: string[]) => [
  "You screen news and LinkedIn posts for a private equity fund in India, looking for events its deal team should attend.",
  "Keep an item only if it announces a specific, named, in-person event that has not happened yet, in India or aimed at Indian investors, and that is one of:",
  "- networking between PE / VC firms, founders and investors, such as a fund showcasing its portfolio companies or a demo day (kind NETWORKING);",
  "- a conference run by an investment bank or for its clients (kind BANKER);",
  "- a family office forum (kind FAMILY_OFFICE);",
  `- a major trade expo or summit in one of these sectors only: ${sectors.filter((s) => s !== "Multi-sector").join(", ")} (kind SECTOR_EXPO). Drop shows in any other field, such as agriculture, poultry, food, textiles or real estate.`,
  "Drop reports on events already over, webinars, awards, college fests, generic business summits, job fairs, state investor meets with no investor angle, and small local meetups.",
  "tier: TOP only for a flagship event in its field, attended by leading investors or the whole industry. Otherwise WORTH_A_LOOK.",
  "start_date and end_date: YYYY-MM-DD, only if the item states them. Never guess or work out a date; use null.",
  "city, organiser: as stated, else null. name: the event's proper name with its year if stated.",
  "Items from a listing site are scheduled events: judge whether they fit, not whether they are announced. Keep regional shows only if they are established in a sector above.",
  "venue: as stated, else null.",
  "description: one or two plain sentences on what the event is, only from the item (max 220 characters). Empty for dropped items.",
  "why: one plain sentence on why it matters to a PE investor (max 160 characters). For dropped items use an empty string.",
  "same_as: the team must never be told about the same event twice. If an item is about an event in the Already tracked list, even under a different name, short form, spelling or language, and it is the same edition, set same_as to that event's key. Otherwise null.",
  "If two items are about the same event, keep only the first and drop the other.",
  "Return one entry per item, with its key. When keep is false, fill the other fields with any valid value.",
].join("\n");

export interface TrackedEvent {
  key: string;
  name: string;
  date: string | null;
  city: string | null;
}

export async function judgeEvents(today: string, items: EventCandidate[], tracked: TrackedEvent[], sectors: string[], opts: { signal?: AbortSignal } = {}): Promise<FoundEvent[]> {
  const prompt = [
    `Today: ${today}`,
    "",
    "Already tracked:",
    ...tracked.map((t) => `[${t.key}] ${t.name}, ${t.date ?? "no date yet"}${t.city ? `, ${t.city}` : ""}`),
    "",
    "Items:",
    ...items.map((i) =>
      [
        `[${i.key}] ${i.source === "LISTING" ? `Listing site, ${i.outlet ?? ""}` : i.source === "LINKEDIN" ? `LinkedIn post, ${i.outlet ?? ""}` : `News, ${i.outlet ?? "unknown outlet"}`}${i.publishedAt ? `, ${i.publishedAt.slice(0, 10)}` : ""}`,
        `Title: ${i.title}`,
        i.text && i.text !== i.title ? `Text: ${i.text.slice(0, 800)}` : "",
      ]
        .filter(Boolean)
        .join("\n"),
    ),
  ].join("\n");
  const raw = await aiProvider().generateJson({ system: system(sectors), prompt, jsonSchema: schema(sectors), model: MODEL, signal: opts.signal, maxTokens: 8000 });
  const parsed = z.object({ items: z.array(found) }).parse(JSON.parse(raw));
  return parsed.items.filter((v) => v.keep && items.some((i) => i.key === v.key));
}
