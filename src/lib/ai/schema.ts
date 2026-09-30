import { z } from "zod";

// SPEC §9.2 output contract. Validated with zod after the model's strict JSON-schema output.

const str = z.string().nullable().optional();
const arr = z.array(z.string().nullable()).nullable().optional();

export const summarySchema = z.object({
  company: str,
  sector: str,
  subSector: str,
  round: str,
  advisor: str,
  location: str,
  deckDate: str,
  business: arr,
  revenueMix: str,
  financials: z
    .object({
      unit: str,
      columns: z.array(z.string()).max(8).nullable().optional(),
      rows: z
        .array(
          z.object({
            label: z.string(),
            values: z.array(z.union([z.string(), z.number()]).nullable()),
          }),
        )
        .max(6)
        .nullable()
        .optional(),
      growth: str,
    })
    .nullable()
    .optional(),
  dealAsk: str,
  founders: str,
  customers: str,
  differentiation: str,
  sectorPoints: arr,
  tailwinds: arr,
});

export type SummaryOutput = z.infer<typeof summarySchema>;

/** JSON Schema passed as response_format.json_schema (strict). */
export function responseJsonSchema(sectors: string[]) {
  const s = { type: ["string", "null"] };
  const list = (desc: string) => ({ type: "array", items: { type: "string" }, description: desc });
  return {
    type: "object",
    properties: {
      company: { ...s, description: "Company name as written in the deck" },
      sector: { type: ["string", "null"], enum: [...sectors, null], description: "Exactly one of the listed sectors" },
      subSector: { ...s, description: "2 to 5 words" },
      round: { ...s, description: "e.g. Series A, Series B, Pre-IPO" },
      advisor: { ...s, description: "Investment banker or advisor firm" },
      location: { ...s, description: "Headquarters city" },
      deckDate: { ...s, description: "Month and year of the deck" },
      business: list("3 or 4 bullets, each under 18 words: what they do, for whom, how they make money"),
      revenueMix: { ...s, description: "One or two sentences on revenue split" },
      financials: {
        type: ["object", "null"],
        properties: {
          unit: { type: "string", description: '"₹ Cr" for INR, or "USD Mn" for USD decks' },
          columns: { type: "array", items: { type: "string" }, description: "At most 6 years, e.g. FY24, FY25, FY26E" },
          rows: {
            type: "array",
            description: "At most 3 rows. Revenue first, then the most useful of EBITDA %, Gross margin %, PAT",
            items: {
              type: "object",
              properties: {
                label: { type: "string" },
                values: { type: "array", items: { type: ["string", "null"] } },
              },
              required: ["label", "values"],
              additionalProperties: false,
            },
          },
          growth: { ...s, description: '"X% CAGR actual (FYa–FYb) vs Y% projected (FYc–FYd)"' },
        },
        required: ["unit", "columns", "rows", "growth"],
        additionalProperties: false,
      },
      dealAsk: { ...s, description: "Raise size, round and use of funds, one or two sentences" },
      founders: { ...s, description: "Founders with one-line background, plus existing investors" },
      customers: { ...s, description: "Key customers or customer metrics, one sentence" },
      differentiation: { ...s, description: "What the company claims sets it apart, one or two sentences" },
      sectorPoints: list("2 or 3 bullets on market size and structure"),
      tailwinds: list("2 or 3 bullets on sector tailwinds"),
    },
    required: [
      "company", "sector", "subSector", "round", "advisor", "location", "deckDate", "business",
      "revenueMix", "financials", "dealAsk", "founders", "customers", "differentiation", "sectorPoints", "tailwinds",
    ],
    additionalProperties: false,
  };
}
