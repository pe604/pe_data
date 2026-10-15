// ₹ Cr amounts (Invested tab). Pure: unit-tested in tests/unit/money.test.ts.

/** "1,250.5" style number in Indian grouping, up to 2 decimals. */
export function fmtCrNumber(n: number): string {
  return n.toLocaleString("en-IN", { maximumFractionDigits: 2, minimumFractionDigits: 0 });
}

/** "₹ 12.5 Cr", or null for no amount. */
export function fmtCr(n: number | null | undefined): string | null {
  return n === null || n === undefined ? null : `₹ ${fmtCrNumber(n)} Cr`;
}

/**
 * Parses what someone types into the amount box: "12.5", "1,250", "₹ 12 Cr", "12cr". Blank → null.
 * Returns undefined when it isn't a valid non-negative amount.
 */
export function parseCr(input: string): number | null | undefined {
  const s = input.replace(/₹|rs\.?|inr|crores?|cr\.?/gi, "").replace(/[,\s]/g, "");
  if (!s) return null;
  if (!/^\d+(\.\d+)?$/.test(s)) return undefined;
  const n = Math.round(Number(s) * 100) / 100;
  return Number.isFinite(n) && n <= 1_000_000 ? n : undefined;
}

/** Sum of the amounts entered, or null when none are. */
export function totalCr(values: (number | null)[]): number | null {
  const v = values.filter((x): x is number => x !== null);
  return v.length ? Math.round(v.reduce((a, b) => a + b, 0) * 100) / 100 : null;
}
