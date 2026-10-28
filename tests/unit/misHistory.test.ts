import { describe, expect, it } from "vitest";
import {
  comparePeriods,
  fmtLineValue,
  isPeriodKey,
  lineKey,
  matchLine,
  moneyToCr,
  monthsVsTotals,
  notInText,
  parseFigure,
  periodFy,
  periodLabel,
  periodMonths,
  periodType,
} from "@/lib/domain/misHistory";

describe("periods (SPEC §15.11)", () => {
  it("recognises the five kinds of period key", () => {
    expect(["2026-07", "FY27-Q2", "FY27-H1", "FY27", "YTD-2026-09"].map(periodType)).toEqual(["month", "quarter", "half", "year", "ytd"]);
    expect(isPeriodKey("Q2FY27")).toBe(false);
    expect(isPeriodKey("2026-13")).toBe(false);
  });

  it("labels them", () => {
    expect(["2026-07", "FY27-Q2", "FY27-H1", "FY27", "YTD-2026-09"].map(periodLabel)).toEqual(["Jul 2026", "Q2 FY27", "H1 FY27", "FY27", "YTD Sep 2026"]);
  });

  it("knows the months each covers (Indian financial year)", () => {
    expect(periodMonths("FY27-Q2")).toEqual(["2026-07", "2026-08", "2026-09"]);
    expect(periodMonths("FY27-Q4")).toEqual(["2027-01", "2027-02", "2027-03"]);
    expect(periodMonths("FY27-H2")).toEqual(["2026-10", "2026-11", "2026-12", "2027-01", "2027-02", "2027-03"]);
    expect(periodMonths("FY27")).toHaveLength(12);
    expect(periodMonths("FY27")[0]).toBe("2026-04");
    expect(periodMonths("YTD-2026-09")).toEqual(["2026-04", "2026-05", "2026-06", "2026-07", "2026-08", "2026-09"]);
    expect(periodMonths("YTD-2027-02")).toHaveLength(11);
    expect(periodFy("2027-02")).toBe("FY27");
  });

  it("sorts by end month, shortest first", () => {
    const ps = ["FY27", "YTD-2026-09", "FY27-H1", "FY27-Q2", "2026-09", "2026-08", "FY27-Q1"];
    expect([...ps].sort(comparePeriods)).toEqual(["FY27-Q1", "2026-08", "2026-09", "FY27-Q2", "FY27-H1", "YTD-2026-09", "FY27"]);
  });
});

describe("figures and units", () => {
  it("parses printed figures", () => {
    expect(parseFigure("(12,127,594)")).toBe(-12127594);
    expect(parseFigure("-0.10")).toBe(-0.1);
    expect(parseFigure("−3.41%")).toBe(-3.41);
    expect(parseFigure("1,23,456.7")).toBe(123456.7);
    expect(parseFigure("0.18x")).toBe(0.18);
    expect(parseFigure("-")).toBeNull();
    expect(parseFigure("NA")).toBeNull();
    expect(parseFigure(12.5)).toBe(12.5);
  });

  it("converts money scales to ₹ Cr", () => {
    expect(moneyToCr(297614023, "Rupees")).toBeCloseTo(29.7614023, 9);
    expect(moneyToCr(1034, "Mn")).toBeCloseTo(103.4, 9);
    expect(moneyToCr(93.1, "Lakh")).toBeCloseTo(0.931, 9);
    expect(moneyToCr(2, "Bn")).toBe(200);
  });

  it("formats for display", () => {
    expect(fmtLineValue(291.3, "INR_CR")).toBe("291.30");
    expect(fmtLineValue(-9.94, "INR_CR")).toBe("(9.94)");
    expect(fmtLineValue(98, "PCT")).toBe("98.0%");
    expect(fmtLineValue(1123200, "NUM")).toBe("11,23,200");
    expect(fmtLineValue(null, "NUM")).toBe("–");
  });
});

describe("matching lines", () => {
  const lines = [
    { id: "a", section: "P&L", label: "Net Revenue", aliases: ["Revenue from operations"] },
    { id: "b", section: "Amazon.in", label: "Sales", aliases: [] },
  ];
  it("matches by section and label, ignoring case and punctuation", () => {
    expect(lineKey("Contribution Margin - 1 (CM1)")).toBe("contribution margin 1 cm1");
    expect(lineKey("Sales & Marketing")).toBe("sales and marketing");
    expect(matchLine("P & L", "net revenue", lines)?.id).toBe("a");
    expect(matchLine("p&l", "Revenue From Operations", lines)?.id).toBe("a");
    expect(matchLine("Amazon.in", "Sales", lines)?.id).toBe("b");
    expect(matchLine("Shopify", "Sales", lines)).toBeNull();
  });
});

describe("checks", () => {
  const fmt = (n: number) => n.toFixed(2);
  it("flags months that don't add up to a printed quarter (flows only)", () => {
    const v = (period: string, value: number) => ({ period, value, raw: String(value) });
    const ok = [v("2026-07", 103.4), v("2026-08", 74), v("2026-09", 114), v("FY27-Q2", 291.4)];
    expect(monthsVsTotals("FLOW", ok, fmt)).toEqual([]);
    const bad = [v("2026-07", 103.4), v("2026-08", 74), v("2026-09", 114), v("FY27-Q2", 250)];
    expect(monthsVsTotals("FLOW", bad, fmt)).toEqual(["Q2 FY27: months add up to 291.40, file shows 250.00"]);
    expect(monthsVsTotals("STOCK", bad, fmt)).toEqual([]);
    // A quarter without all its months isn't checked.
    expect(monthsVsTotals("FLOW", [v("2026-07", 1), v("FY27-Q2", 9)], fmt)).toEqual([]);
  });

  it("allows for figures rounded to the printed decimals", () => {
    const r = (period: string, raw: string) => ({ period, value: Number(raw), raw });
    // 0.7 + 0.7 + 0.7 = 2.1, printed quarter 2.2: within rounding of four one-decimal figures.
    expect(monthsVsTotals("FLOW", [r("2026-04", "0.7"), r("2026-05", "0.7"), r("2026-06", "0.7"), r("FY27-Q1", "2.2")], fmt)).toEqual([]);
    expect(monthsVsTotals("FLOW", [r("2026-04", "0.7"), r("2026-05", "0.7"), r("2026-06", "0.7"), r("FY27-Q1", "2.4")], fmt)).toHaveLength(1);
  });

  it("flags printed figures missing from the file's text", () => {
    const text = "Total revenue 499 1,522 821 1,034 740 1,140 ".repeat(10);
    const vals = [
      { period: "2026-07", value: 103.4, raw: "1,034" },
      { period: "2026-08", value: 74, raw: "(741)" },
    ];
    expect(notInText(vals, text)).toEqual(["Aug 2026 (741)"]);
  });
});

import { sameFigures, textLineFigures } from "@/lib/domain/misHistory";

describe("PDF text-layer rows", () => {
  const text = [
    "Unit Q1FY25 Q2FY25 Q3FY25",
    "Transaction-based Rs. cr 4.6 4.4 3.9",
    "Fee-based Subscription-based Rs. cr 37.9 48.9 62.0",
    "Transaction-based Rs. cr 4.5 4.4 3.8",
    "EBITDA Rs. cr -1.6 (1.0) 0.4",
    "Active Investors # (000s) 1783 1829 1,860",
    "Cash collateral",
  ].join("\n");

  it("finds a row's figures on its line, skipping units", () => {
    expect(textLineFigures(text, "EBITDA", 3)).toEqual(["-1.6", "(1.0)", "0.4"]);
    expect(textLineFigures(text, "Active Investors", 3)).toEqual(["1783", "1829", "1,860"]);
    expect(textLineFigures(text, "Platform Revenues – Fee-based Subscription-based", 3)).toEqual(["37.9", "48.9", "62.0"]);
  });

  it("picks the n-th line when a label repeats, and refuses a count mismatch", () => {
    expect(textLineFigures(text, "Net Revenues – Transaction-based", 3, 1)).toEqual(["4.5", "4.4", "3.8"]);
    expect(textLineFigures(text, "EBITDA", 4)).toBeNull();
    expect(textLineFigures(text, "Cash collateral", 1)).toBeNull();
    expect(textLineFigures(text, "Missing row", 3)).toBeNull();
  });

  it("compares figures ignoring order", () => {
    expect(sameFigures([619, 826, null], [826, 619])).toBe(true);
    expect(sameFigures([619, 826], [619, 825])).toBe(false);
  });
});
