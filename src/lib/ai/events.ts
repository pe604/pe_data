import "server-only";
import { z } from "zod";
import type { ListingItem } from "@/lib/domain/eventListings";
import { keepFound, SECTOR_FOCUS } from "@/lib/domain/eventSectors";
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

export interface JudgeSector {
  name: string;
  priority: boolean;
}

const sectorLine = (s: JudgeSector) => `  - ${s.name}${SECTOR_FOCUS[s.name] ? `: ${SECTOR_FOCUS[s.name]}` : ""}`;

const system = (all: JudgeSector[]) => {
  const sectors = all.filter((s) => s.name !== "Multi-sector");
  const top = sectors.filter((s) => s.priority);
  const rest = sectors.filter((s) => !s.priority);
  return [
    "You screen news, LinkedIn posts and event listings for a growth-stage private equity fund in India, looking for the few events its deal team should attend. Be strict: the team wants fewer, better events.",
    "Keep an item only if it announces a specific, named, in-person event that has not happened yet, in India or aimed at Indian investors, and that is one of:",
    "- curated networking between PE / VC firms, founders and investors run by a recognised organiser (an industry body such as IVCA or TiE, a media house such as VCCircle, a fund or a bank), such as a fund showcasing its portfolio companies or a demo day (kind NETWORKING). Drop open ticketed mixers, happy hours, generic founder meetups and pay-to-pitch events;",
    "- a conference run by an investment bank or for its clients (kind BANKER);",
    "- a family office forum by a recognised organiser (kind FAMILY_OFFICE);",
    "- a sector event (kind SECTOR_EXPO), only in these sectors, and only within each sector's focus:",
    `  TOP PRIORITY sectors: keep every established national or international show, summit or convention where the sector's leaders and buyers gather, including industry conventions with an awards night. Drop city editions of generic trade fairs, dealer and distributor shows, and standalone award ceremonies.`,
    ...top.map(sectorLine),
    `  OTHER sectors: keep only the one flagship national event of the sector, and mark it TOP. Drop everything else in these sectors, including regional and city shows.`,
    ...rest.map(sectorLine),
    "  Drop shows in any other field, such as agriculture, poultry, food, textiles or real estate.",
    "Drop reports on events already over, webinars, standalone awards, college fests, generic business summits, job fairs, state investor meets with no investor angle, and small local meetups.",
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
};

export interface TrackedEvent {
  key: string;
  name: string;
  date: string | null;
  city: string | null;
}

const flat = (s: string) => s.replace(/\s+/g, " ").trim();

/**
 * The AI's verdicts, then the code's own check: outside the priority sectors only flagship expos are kept. Now and
 * then the model runs away on one item and its answer is cut off; that batch is split in half and judged again, so
 * one bad item can't hold up the rest. A single item that still gets a broken answer is dropped.
 */
export async function judgeEvents(today: string, items: EventCandidate[], tracked: TrackedEvent[], sectors: JudgeSector[], opts: { signal?: AbortSignal } = {}): Promise<FoundEvent[]> {
  try {
    return await judgeOnce(today, items, tracked, sectors, opts);
  } catch (e) {
    if (!(e instanceof SyntaxError || e instanceof z.ZodError)) throw e;
    if (items.length === 1) return [];
    const half = Math.ceil(items.length / 2);
    return [...(await judgeEvents(today, items.slice(0, half), tracked, sectors, opts)), ...(await judgeEvents(today, items.slice(half), tracked, sectors, opts))];
  }
}

async function judgeOnce(today: string, items: EventCandidate[], tracked: TrackedEvent[], sectors: JudgeSector[], opts: { signal?: AbortSignal }): Promise<FoundEvent[]> {
  const priority = new Set(sectors.filter((s) => s.priority).map((s) => s.name));
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
        `Title: ${flat(i.title)}`,
        // Runs of blank lines from listing pages can send the model into a loop of newlines, so text goes in flat.
        i.text && i.text !== i.title ? `Text: ${flat(i.text).slice(0, 800)}` : "",
      ]
        .filter(Boolean)
        .join("\n"),
    ),
  ].join("\n");
  const raw = await aiProvider().generateJson({ system: system(sectors), prompt, jsonSchema: schema(sectors.map((s) => s.name)), model: MODEL, signal: opts.signal, maxTokens: 8000 });
  const parsed = z.object({ items: z.array(found) }).parse(JSON.parse(raw));
  return parsed.items.filter((v) => v.keep && items.some((i) => i.key === v.key) && keepFound(v, priority));
}
