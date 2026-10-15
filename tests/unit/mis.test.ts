import { describe, expect, it } from "vitest";
import { draftFromExtract, marginPct, quarterMonths, signedFigure, toCr, unmatchedFigures, type MisExtract } from "@/lib/domain/mis";

describe("figures and units", () => {
  it("reads signs and separators as printed", () => {
    expect(signedFigure("1,23,456.5")).toBe(123456.5);
    expect(signedFigure("(12.4)")).toBe(-12.4);
    expect(signedFigure("-3.2")).toBe(-3.2);
    expect(signedFigure("₹ 45 Cr")).toBe(45);
    expect(signedFigure("–")).toBeNull();
    expect(signedFigure(null)).toBeNull();
  });

  it("converts to ₹ Cr", () => {
    expect(toCr(2080, "Cr")).toBe(2080);
    expect(toCr(450, "Lakh")).toBe(4.5);
    expect(toCr(236, "Mn")).toBe(23.6);
    expect(toCr(12345678, "Rupees")).toBe(1.23);
    expect(toCr(98765, "Thousand")).toBe(9.88);
  });

  it("lists a quarter's months", () => {
    expect(quarterMonths("FY27-Q2")).toEqual(["2026-07", "2026-08", "2026-09"]);
    expect(quarterMonths("FY27-Q4")).toEqual(["2027-01", "2027-02", "2027-03"]);
  });
});

describe("quarter draft", () => {
  const months = (rev: (string | null)[]) =>
    ["2026-07", "2026-08", "2026-09"].map((month, i) => ({ month, revenue: rev[i], ebitda: null, pat: null }));

  it("prefers the printed quarter total", () => {
    const x: MisExtract = { unit: "Lakh", quarter: { revenue: "1,250", ebitda: "(80)", pat: null }, months: months(["400", "420", "430"]), cashAtEnd: "900" };
    const d = draftFromExtract(x, "FY27-Q2");
    expect(d).toMatchObject({ revenue: 12.5, ebitda: -0.8, pat: null, cash: 9 });
    expect(d.source).toEqual({ revenue: "quarter", ebitda: "quarter", pat: null });
  });

  it("adds up three months when there is no quarter total, never a partial quarter", () => {
    const full = draftFromExtract({ unit: "Cr", quarter: null, months: months(["4.1", "4.2", "4.3"]), cashAtEnd: null }, "FY27-Q2");
    expect(full.revenue).toBe(12.6);
    expect(full.source.revenue).toBe("months");
    const partial = draftFromExtract({ unit: "Cr", quarter: null, months: months(["4.1", null, "4.3"]), cashAtEnd: null }, "FY27-Q2");
    expect(partial.revenue).toBeNull();
  });

  it("flags figures not in the file text", () => {
    const text = "MIS for the quarter ended 30 Sep 2026. Revenue 1250 EBITDA (80) cash 900 ".repeat(5);
    const x: MisExtract = { unit: "Lakh", quarter: { revenue: "1,250", ebitda: "(80)", pat: "55" }, months: [], cashAtEnd: "900" };
    expect(unmatchedFigures(x, "FY27-Q2", text)).toEqual(["PAT (quarter) 55"]);
  });

  it("computes margins", () => {
    expect(marginPct(1.5, 12.5)).toBe(12);
    expect(marginPct(null, 12.5)).toBeNull();
    expect(marginPct(1, 0)).toBeNull();
  });
});
