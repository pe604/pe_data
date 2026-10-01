// Checks the financials table of an AI summary against the deck's own text, so misread or rescaled figures
// (e.g. ₹ 2,080 Cr written as 208.0) are caught instead of shown as fact. Pure: unit-tested in tests/unit/verify.test.ts.
import type { SummaryJson } from "./markdown";

/** Too little text (e.g. a scanned PDF) to check anything against. */
const MIN_TEXT = 300;

/** Every number printed in the deck text, as absolute values ("1,407" → 1407, "(150.3)" → 150.3). */
export function deckNumbers(text: string): number[] {
  const out: number[] = [];
  for (const m of text.matchAll(/\d[\d,]*(?:\.\d+)?/g)) {
    const n = Number(m[0].replace(/,/g, "").replace(/\.$/, ""));
    if (Number.isFinite(n)) out.push(n);
  }
  return out;
}

/** Number in a table cell ("(198.2)", "2,080", "12.8%", "₹ 59.7") as an absolute value, or null for blanks. */
export function parseFigure(v: unknown): number | null {
  if (v === null || v === undefined) return null;
  const m = /\d[\d,]*(?:\.\d+)?/.exec(String(v));
  if (!m) return null;
  const n = Number(m[0].replace(/,/g, ""));
  return Number.isFinite(n) ? n : null;
}

/**
 * Factors by which the deck's numbers may legitimately be rescaled into ₹ Cr: only for rupee units the deck
 * itself states. A deck already in Cr gets factor 1 only, so "2,080 → 208.0" is flagged.
 */
export function allowedScales(text: string): number[] {
  const scales = [1];
  if (/(?:INR|Rs\.?|₹)\s*(?:in\s+)?(?:mn|million|mio)\b|\b(?:mn|million)\s*(?:INR|₹)/i.test(text)) scales.push(0.1);
  if (/(?:INR|Rs\.?|₹)\s*(?:in\s+)?(?:lakhs?|lacs?)\b|\b(?:lakhs?|lacs?)\s*(?:INR|₹)/i.test(text)) scales.push(0.01);
  if (/(?:INR|Rs\.?|₹)\s*(?:in\s+)?(?:bn|billion)\b|\b(?:bn|billion)\s*(?:INR|₹)/i.test(text)) scales.push(100);
  return scales;
}

const close = (a: number, b: number) => Math.abs(a - b) <= Math.max(0.051, Math.abs(b) * 0.002);

/**
 * Financial figures that can't be found in the deck text, as "FY26 Revenue 208.0".
 * Returns null when the deck has too little text to check (nothing is flagged then).
 * Percentages pass if printed in the deck or if they equal the ratio of two other rows in the same column.
 */
export function unverifiedFigures(j: SummaryJson, deckText: string): string[] | null {
  if (deckText.replace(/\s+/g, "").length < MIN_TEXT) return null;
  const f = j.financials;
  const cols = (f?.columns ?? []).map((c) => String(c ?? "").trim());
  const rows = (f?.rows ?? []).filter((r): r is NonNullable<typeof r> => !!r);
  if (!cols.length || !rows.length) return [];

  const nums = deckNumbers(deckText);
  const scales = allowedScales(deckText);
  const inDeck = (v: number) => nums.some((n) => scales.some((s) => close(n * s, v)));

  const out: string[] = [];
  rows.forEach((r, ri) => {
    const label = String(r.label ?? "").trim();
    (r.values ?? []).slice(0, cols.length).forEach((raw, ci) => {
      const v = parseFigure(raw);
      if (v === null || v === 0 || inDeck(v)) return;
      const isPct = /%/.test(String(raw)) || /%|margin/i.test(label);
      if (isPct) {
        const others = rows
          .filter((_, k) => k !== ri)
          .map((o) => parseFigure(o.values?.[ci]))
          .filter((x): x is number => x !== null && x !== 0);
        const derived = others.some((a) => others.some((b) => a !== b && Math.abs((a / b) * 100 - v) <= 0.15));
        if (derived) return;
      }
      out.push(`${cols[ci]} ${label} ${String(raw).trim()}`);
    });
  });
  return out;
}
