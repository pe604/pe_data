import "server-only";
import { z } from "zod";
import type { ThemeOption } from "@/lib/domain/thesis";
import { aiProvider } from "./provider";
import { CHECK_MODEL } from "./news";

// Picks a thesis theme for companies without one (SPEC §17.2, step 3). Name, sector and sub-sector only: no deck,
// no comments. Never log the companies or the answer.

export interface ThemeCandidate {
  key: string;
  name: string;
  sector: string | null;
  subSector: string | null;
}

const system = [
  "You sort companies into the investment themes of a growth-stage private equity fund in India.",
  "For each company, answer with the one theme code it clearly belongs to, judged only from its name, sector and sub-sector, or null when none fits or you cannot tell.",
  "Use only the codes listed. Never guess: a company that could fit several themes, or whose business is unclear, gets null.",
].join("\n");

/** The theme codes for a batch, keyed by candidate key. Anything not a listed code comes back null. */
export async function pickThemes(items: ThemeCandidate[], themes: (ThemeOption & { keywords: string[] })[], opts: { signal?: AbortSignal } = {}): Promise<Map<string, string | null>> {
  const codes = themes.map((t) => t.code);
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
          required: ["key", "theme"],
          properties: { key: { type: "string" }, theme: { type: ["string", "null"], enum: [...codes, null] } },
        },
      },
    },
  };
  const prompt = [
    "Themes (code: name; keywords):",
    ...themes.map((t) => `${t.code}: ${t.name}${t.keywords.length ? `; ${t.keywords.join(", ")}` : ""}`),
    "",
    "Companies (key | name | sector | sub-sector):",
    ...items.map((i) => `${i.key} | ${i.name} | ${i.sector ?? "-"} | ${i.subSector ?? "-"}`),
  ].join("\n");
  const raw = await aiProvider().generateJson({ system, prompt, jsonSchema: schema, model: CHECK_MODEL, signal: opts.signal, maxTokens: 8000 });
  const parsed = z.object({ items: z.array(z.object({ key: z.string(), theme: z.string().nullable() })) }).parse(JSON.parse(raw));
  const out = new Map<string, string | null>();
  for (const i of items) out.set(i.key, null);
  for (const a of parsed.items) if (out.has(a.key)) out.set(a.key, a.theme && codes.includes(a.theme) ? a.theme : null);
  return out;
}
