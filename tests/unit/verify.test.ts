import { describe, expect, it } from "vitest";
import { buildMarkdown } from "@/lib/summary/markdown";
import { allowedScales, deckNumbers, parseFigure, unverifiedFigures } from "@/lib/summary/verify";

const filler = " ".repeat(10) + "Market overview and strategy. ".repeat(12);
const crDeck =
  "EBITDA Positive Achieved in FY 2025-26. Amount in INR Cr. 1,407 1,538 2,080 3,032 4,228 5,880 " +
  "-198.2 -150.3 +3.3 +59.8 +135.5 +246.6 Operating EBITDA% -9.0% 0.2% 2.0% 10 lakh+ unique visitors" + filler;

const fin = (rows: { label: string; values: (string | null)[] }[]) => ({
  financials: { unit: "₹ Cr", columns: ["FY24", "FY25", "FY26"], rows, growth: null },
});

describe("figure parsing", () => {
  it("reads numbers with separators, brackets and percent signs", () => {
    expect(deckNumbers("Rev 2,080 cr; EBITDA (150.3); 1,00,000")).toEqual([2080, 150.3, 100000]);
    expect(parseFigure("(198.2)")).toBe(198.2);
    expect(parseFigure("12.8%")).toBe(12.8);
    expect(parseFigure("₹ 2,080")).toBe(2080);
    expect(parseFigure(null)).toBeNull();
    expect(parseFigure("–")).toBeNull();
  });

  it("allows rescaling only for rupee units the deck states", () => {
    expect(allowedScales(crDeck)).toEqual([1]); // "10 lakh+ visitors" is not a rupee unit
    expect(allowedScales("Figures in INR Mn")).toContain(0.1);
    expect(allowedScales("₹ in Lakhs")).toContain(0.01);
  });
});

describe("unverifiedFigures", () => {
  it("flags revenue that was divided by 10 when the deck is already in Cr", () => {
    const j = fin([{ label: "Revenue", values: ["140.7", "153.8", "208.0"] }]);
    expect(unverifiedFigures(j, crDeck)).toEqual(["FY24 Revenue 140.7", "FY25 Revenue 153.8", "FY26 Revenue 208.0"]);
  });

  it("accepts figures copied from the deck, including losses and printed margins", () => {
    const j = fin([
      { label: "Revenue", values: ["1,407", "1,538", "2,080"] },
      { label: "EBITDA", values: ["(198.2)", "(150.3)", "3.3"] },
      { label: "EBITDA %", values: [null, "(9.0%)", "0.2%"] },
    ]);
    expect(unverifiedFigures(j, crDeck)).toEqual([]);
  });

  it("accepts margins computed from two rows in the same column", () => {
    const j = fin([
      { label: "Revenue", values: ["1,407", "1,538", "2,080"] },
      { label: "EBITDA", values: ["(198.2)", "(150.3)", "3.3"] },
      { label: "EBITDA %", values: ["(14.1%)", null, null] },
    ]);
    expect(unverifiedFigures(j, crDeck)).toEqual([]);
  });

  it("accepts Mn → Cr conversion when the deck is in INR Mn", () => {
    const deck = "Financials (INR Mn): revenue 236 and 1,450" + filler;
    const j = fin([{ label: "Revenue", values: ["23.6", "145.0", null] }]);
    expect(unverifiedFigures(j, deck)).toEqual([]);
  });

  it("lists unmatched figures under the financials table", () => {
    const md = buildMarkdown(fin([{ label: "Revenue", values: ["1,407", "1,538", "208.0"] }]), ["FY26 Revenue 208.0"]);
    expect(md).toContain("| Revenue | 1,407 | 1,538 | 208.0 |");
    expect(md).toContain("Check against the deck (not found in its text): FY26 Revenue 208.0");
    expect(buildMarkdown(fin([{ label: "Revenue", values: ["1,407", null, null] }]))).not.toContain("Check against");
  });

  it("skips checking when the deck has almost no text (scanned PDF)", () => {
    expect(unverifiedFigures(fin([{ label: "Revenue", values: ["1"] }]), "Page 1")).toBeNull();
  });
});
