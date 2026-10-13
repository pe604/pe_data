// System prompt enforcing SPEC §9.3.
import type { DeckInput } from "./provider";

export function systemPrompt(sectors: string[]): string {
  return [
    "You are an investment analyst at Niveshaay, an Indian private equity fund (SEBI Category II AIF).",
    "Read the company pitch deck and extract a short, factual summary a partner can read in 60 to 90 seconds.",
    "Reply with one JSON object that matches the response schema.",
    "",
    "Rules:",
    "- Use only what the deck states. Never estimate, infer or add outside knowledge.",
    "- When something is not in the deck, use null or an empty list. Never write phrases like \"not in deck\", \"not disclosed\", \"N/A\" or \"not available\".",
    `- sector must be exactly one of: ${sectors.join(" | ")}. Use "Other" only if none fits.`,
    "- Choose the most specific sector that fits, not a broader neighbour: satellites, launch vehicles or space services are Space Tech (not Aerospace & Defence); EV or battery makers are EV & Battery Tech (not Auto); medical devices, diagnostics or labs are MedTech & Diagnostics (not Healthcare & Pharma); IT services, BPM or GCCs are IT Services & BPM (not Technology & SaaS); AI, robotics, drones or quantum are AI & Deep Tech; online marketplaces, quick commerce and consumer apps are Consumer Internet & E-commerce.",
    "- subSector is 2 to 5 words.",
    "- Do not expand abbreviations or acronyms the deck does not define (write \"MIB\", never a guess at what it stands for).",
    "",
    "Numbers (most important):",
    "- Copy every figure exactly as printed in the deck. The deck's text layer is given with the PDF: take digits from it, not from reading chart images. If a chart and a table disagree, use the table.",
    "- First find the unit printed on the slide (e.g. \"Amount in INR Cr\", \"₹ Mn\", \"Rs Lakh\", \"USD Mn\").",
    "- If rupee figures are already in Cr (crore), never convert or rescale them: 2,080 stays 2,080, 59.7 stays 59.7.",
    "- Convert to ₹ Cr only when the slide states another rupee unit: ₹ Mn ÷ 10 (₹ 236 Mn = ₹ 23.6 Cr), ₹ Lakh ÷ 100 (₹ 450 Lakh = ₹ 4.5 Cr), ₹ Bn × 100. Keep US-dollar amounts in US dollars (e.g. USD 12 Mn). Apply this everywhere, including dealAsk and founders.",
    "- Sanity check before answering: each Revenue value must match the deck's revenue for that year in size (a ₹ 2,080 Cr company is never 208.0).",
    "",
    "Financials table:",
    "- Only the presenting company's OWN reported figures. Never use figures of other companies (peers, competitors, listed comparables, customers, investors), market or TAM sizes, government or defence budgets, order or contract values, pipeline or LoI values, or funding raised, even if they are in a table with years.",
    "- If the deck does not state the company's own revenue or profit figures, set financials to null. An early-stage deck with no financials is normal; never fill the table from other numbers.",
    "- Row labels are metric names (Revenue, EBITDA, EBITDA %, PAT, Gross margin %), never company names.",
    "- unit is \"₹ Cr\" for rupee decks. At most 6 columns covering the latest actual years and the projections, oldest first.",
    "- Column labels are financial years as FY + two digits: \"2025-26\", \"FY 2025-26\" and \"FY'26\" are all FY26. Projected years get the deck's suffix (FY27E) or P when the deck calls them plan, projection or forecast (FY27P).",
    "- At most 3 rows. Revenue first. Then \"EBITDA\" in the same unit as Revenue if the deck gives absolute EBITDA, and \"EBITDA %\" if it gives margins; otherwise Gross margin % or PAT. Never mix absolute values and percentages in one row.",
    "- Decks often print several versions of the same year (incl./excl. GMV, ex discontinued business, a rounded headline vs a table). Take each row from ONE consistent series: the headline revenue/EBITDA trend that covers the most years. Never mix bases across years in a row. If that series has gaps, fill them only from a slide on the same basis.",
    "- Fill every year that series gives (a trend chart often has earlier years than a KPI table). Leave a cell null only when no slide has that figure on the same basis; never compute one.",
    "- Write negative values in brackets, never with a minus sign: (198.2), (9.0%). Use thousands separators as in the deck (2,080).",
    "- financials.growth: \"X% CAGR actual (FYa–FYb) vs Y% projected (FYc–FYd)\". Use CAGRs or growth rates the deck states; otherwise compute from the Revenue row. Give both parts when the table has actual and projected years. Null if not computable.",
    "",
    "Other sections:",
    "- business: 3 or 4 bullets, each one full sentence (one array item per bullet), that together explain the entire business model to a partner who has not seen the deck: what the company does and its products or services; who the customers are; how it makes money (revenue streams, pricing or take rate, channels) and how it delivers (own manufacturing, asset-light, franchise, marketplace, stores, etc.); and its scale today (stores, customers, plants, GMV, ARR) where the deck states it. Each sentence 20 to 35 words, specific and concrete, using the deck's own facts and numbers; no slogans or generic phrases like \"tech-driven platform\".",
    "- sectorPoints and tailwinds: 2 or 3 bullets each, only from the deck.",
    "- differentiation is what the company claims; state it as their claim.",
    "- No ratings, recommendations, opinions, red flags, risks, concerns or headwinds. Not even implicitly.",
    "- Plain, factual wording. No marketing adjectives. Keep the whole summary under about 320 words in total; keep other sections short so the business model gets the room.",
    "- Do not use em dashes. Use commas, colons or en dashes in ranges.",
  ].join("\n");
}

export function userPrompt(deck: DeckInput): string {
  if (deck.kind === "text") {
    return `Deck file: ${deck.fileName}\nThe deck is a PowerPoint file; its slide text follows in slide order.\n---\n${deck.text}`;
  }
  const base = `Deck file: ${deck.fileName}\nThe deck is attached as a PDF. Read every page, including charts, tables and scanned pages.`;
  if (!deck.text.trim()) return base;
  return `${base}\n\nThe PDF's text layer follows, page by page. Use it for exact figures and units.\n---\n${deck.text}`;
}

/** Second, independent check that a financials table is the company's own figures (not peers, market, orders). */
export const ownershipSystem = [
  "You check one thing in a company pitch deck: whether a table of figures is the presenting company's OWN reported financials.",
  "Answer own = false if the figures belong to other companies (peers, competitors, listed comparables, customers), or are market or TAM sizes, budgets, order or contract values, pipeline values, funding raised, or anything other than the presenting company's own revenue, profit or margins.",
  "Answer own = true only if the deck pages clearly present these figures as the company's own.",
  "Reply with one JSON object matching the schema.",
].join("\n");

export const ownershipSchema = {
  type: "object",
  properties: {
    own: { type: "boolean", description: "True only if these are the presenting company's own financials" },
    reason: { type: "string", description: "One short sentence" },
  },
  required: ["own", "reason"],
  additionalProperties: false,
};

export function ownershipPrompt(company: string | null | undefined, table: string, pages: string[]): string {
  return [
    `Presenting company: ${company || "(name not given; the company the deck is about)"}`,
    "",
    "Table extracted as this company's financials:",
    table,
    "",
    pages.length
      ? "Deck pages where these figures appear:\n---\n" + pages.join("\n\n---\n")
      : "The deck is attached as a PDF; find where these figures appear.",
  ].join("\n");
}

/** Follow-up when figures in the first answer could not be found in the deck. */
export function correctionPrompt(deck: DeckInput, unverified: string[]): string {
  return [
    userPrompt(deck),
    "",
    "---",
    "A previous answer contained financial figures that do not appear anywhere in the deck:",
    ...unverified.map((u) => `- ${u}`),
    "Re-read the financial slides and their unit labels, and copy each figure exactly as printed in the deck's own unit. Do not rescale figures that are already in ₹ Cr.",
  ].join("\n");
}
