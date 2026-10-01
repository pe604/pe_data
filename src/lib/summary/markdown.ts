// Builds the summary markdown from the AI JSON (SPEC §9.4). Empty sections are omitted.
// Pure: unit-tested in tests/unit/markdown.test.ts.

export interface SummaryJson {
  company?: string | null;
  sector?: string | null;
  subSector?: string | null;
  round?: string | null;
  advisor?: string | null;
  location?: string | null;
  deckDate?: string | null;
  business?: (string | null)[] | null;
  revenueMix?: string | null;
  financials?: {
    unit?: string | null;
    columns?: (string | null)[] | null;
    rows?: ({ label?: string | null; values?: (string | number | null)[] | null } | null)[] | null;
    growth?: string | null;
  } | null;
  dealAsk?: string | null;
  founders?: string | null;
  customers?: string | null;
  differentiation?: string | null;
  sectorPoints?: (string | null)[] | null;
  tailwinds?: (string | null)[] | null;
}

const PLACEHOLDER = /^(null|n\/?a|none|nil|-+|–|not (in (the )?deck|disclosed|available|mentioned|stated|provided|specified))\.?$/i;

/** Trimmed string, or null for blanks and "not in deck"-style placeholders. */
export function cleanStr(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const t = v.trim();
  if (!t || PLACEHOLDER.test(t)) return null;
  return t;
}

export function cleanArr(a: unknown): string[] {
  return Array.isArray(a) ? a.map(cleanStr).filter((x): x is string => !!x) : [];
}

const cell = (v: unknown) => String(v).replace(/\|/g, "/").replace(/\s+/g, " ").trim();

/** `unverified`: financial figures not found in the deck text (see verify.ts); listed under the table. */
export function buildMarkdown(j: SummaryJson, unverified: string[] = []): string {
  const out: string[] = [];

  const snap = (
    [
      ["Round", cleanStr(j.round)],
      ["Advisor", cleanStr(j.advisor)],
      ["Location", cleanStr(j.location)],
      ["Deck date", cleanStr(j.deckDate)],
    ] as [string, string | null][]
  ).filter((x): x is [string, string] => !!x[1]);
  if (snap.length) out.push("## Snapshot", ...snap.map(([k, v]) => `${k}: ${v}`), "");

  const business = cleanArr(j.business);
  if (business.length) out.push("## Business", ...business.map((x) => "- " + x), "");

  const mix = cleanStr(j.revenueMix);
  if (mix) out.push("## Revenue mix", mix, "");

  const f = j.financials;
  const cols = cleanArr(f?.columns).slice(0, 6);
  const rows = (f?.rows ?? [])
    .filter((r): r is NonNullable<typeof r> => !!r && !!cleanStr(r.label))
    .slice(0, 3)
    .map((r) => {
      const vals = (r.values ?? []).map((v) => (v === null || v === undefined || String(v).trim() === "" ? "–" : cell(v)));
      while (vals.length < cols.length) vals.push("–");
      return { label: cell(r.label), vals: vals.slice(0, cols.length) };
    })
    .filter((r) => r.vals.some((v) => v !== "–"));
  if (f && cols.length && rows.length) {
    out.push(
      `## Financials (${cleanStr(f.unit) ?? "₹ Cr"})`,
      "| | " + cols.map(cell).join(" | ") + " |",
      "|---|" + cols.map(() => "---:").join("|") + "|",
      ...rows.map((r) => `| ${r.label} | ${r.vals.join(" | ")} |`),
    );
    const growth = cleanStr(f.growth);
    if (growth) out.push("", "Growth: " + growth);
    if (unverified.length) out.push("", `Check against the deck (not found in its text): ${unverified.map(cell).join(", ")}`);
    out.push("");
  }

  for (const [k, label] of [
    ["dealAsk", "Deal ask"],
    ["founders", "Founders & cap table"],
    ["customers", "Customers"],
    ["differentiation", "Differentiation (claimed)"],
  ] as const) {
    const v = cleanStr(j[k]);
    if (v) out.push("## " + label, v, "");
  }

  const sp = cleanArr(j.sectorPoints);
  if (sp.length) out.push("## Sector", ...sp.map((x) => "- " + x), "");
  const tw = cleanArr(j.tailwinds);
  if (tw.length) out.push("## Tailwinds", ...tw.map((x) => "- " + x), "");

  return out.join("\n").trim();
}

export function wordCount(md: string): number {
  return md
    .replace(/^#+\s+/gm, "")
    .replace(/[|:-]{3,}/g, " ")
    .split(/\s+/)
    .filter((w) => /[A-Za-z0-9₹]/.test(w)).length;
}
