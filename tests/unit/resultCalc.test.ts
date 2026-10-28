import { describe, expect, it } from "vitest";
import { periodValue } from "@/lib/domain/resultCalc";
import { buildResult, changePct, columnHeader, recommendedFormat, refPeriod, resultQuarters, type LineData, type ResultFormat } from "@/lib/domain/resultFormat";

// Figures here are made up (tests are public; never use a portfolio company's real numbers).
const m = (o: Record<string, number>) => new Map(Object.entries(o));

describe("period calculator (SPEC §15.12)", () => {
  it("takes a saved figure as is", () => {
    expect(periodValue("FLOW", m({ "FY27-Q2": 250 }), "FY27-Q2")).toEqual({ value: 250, how: null });
  });

  it("adds months into a quarter and quarters into a half and a year", () => {
    const months = m({ "2026-07": 80, "2026-08": 90, "2026-09": 100 });
    expect(periodValue("FLOW", months, "FY27-Q2")).toEqual({ value: 270, how: "Jul 2026 + Aug 2026 + Sep 2026" });
    expect(periodValue("FLOW", m({ "FY27-Q1": 200, "FY27-Q2": 250 }), "FY27-H1")?.value).toBe(450);
    const fy = periodValue("FLOW", m({ "FY26-Q1": 1, "FY26-Q2": 2, "FY26-Q3": 3, "FY26-Q4": 4 }), "FY26");
    expect(fy?.value).toBe(10);
  });

  it("works a quarter out by difference: Q2 = YTD Sep − YTD Jun, Q4 = FY − 9M", () => {
    // An MIS with only year-to-date figures.
    const ytd = m({ "YTD-2026-06": 70.5, "YTD-2026-09": 190 });
    const q2 = periodValue("FLOW", ytd, "FY27-Q2");
    expect(q2?.value).toBeCloseTo(119.5, 6);
    expect(q2?.how).toBe("YTD Sep 2026 − YTD Jun 2026");
    expect(periodValue("FLOW", ytd, "FY27-Q1")).toEqual({ value: 70.5, how: "as YTD Jun 2026" });
    expect(periodValue("FLOW", ytd, "FY27-H1")).toEqual({ value: 190, how: "as YTD Sep 2026" });
    const q4 = periodValue("FLOW", m({ FY26: 1000, "YTD-2025-12": 720 }), "FY26-Q4");
    expect(q4?.value).toBe(280);
  });

  it("takes balances at the period end and never adds up ratios", () => {
    expect(periodValue("STOCK", m({ "2026-09": 55 }), "FY27-Q2")).toEqual({ value: 55, how: "as at Sep 2026" });
    expect(periodValue("STOCK", m({ "FY27-Q4": 50 }), "FY27")).toEqual({ value: 50, how: "as at Q4 FY27" });
    expect(periodValue("STOCK", m({ "2026-08": 1 }), "FY27-Q2")).toBeNull();
    expect(periodValue("RATIO", m({ "2026-07": 30, "2026-08": 31, "2026-09": 32 }), "FY27-Q2")).toBeNull();
  });

  it("returns null when it can't be worked out", () => {
    expect(periodValue("FLOW", m({ "2026-07": 1, "2026-08": 2 }), "FY27-Q2")).toBeNull();
    expect(periodValue("FLOW", m({}), "FY27")).toBeNull();
  });
});

const lines: LineData[] = [
  { id: "rev", section: "P&L", label: "Revenue", unit: "INR_CR", kind: "FLOW", values: { "FY27-Q2": 250, "FY27-Q1": 200, "FY26-Q2": 400 } },
  { id: "cogs", section: "P&L", label: "COGS", unit: "INR_CR", kind: "FLOW", values: { "FY27-Q2": 150, "FY27-Q1": 120, "FY26-Q2": 260 } },
  { id: "ebitda", section: "P&L", label: "EBITDA", unit: "INR_CR", kind: "FLOW", values: { "FY27-Q2": -10, "FY27-Q1": -12, "FY26-Q2": 60 } },
];

describe("result format (SPEC §15.12)", () => {
  it("resolves columns relative to the result's quarter", () => {
    expect(refPeriod({ type: "quarter", back: 1 }, "FY27-Q1")).toBe("FY26-Q4");
    expect(refPeriod({ type: "quarter", back: 4 }, "FY27-Q2")).toBe("FY26-Q2");
    expect(refPeriod({ type: "half", back: 0 }, "FY27-Q3")).toBe("FY27-H2");
    expect(refPeriod({ type: "half", back: 1 }, "FY27-Q2")).toBe("FY26-H2");
    expect(refPeriod({ type: "year", back: 1 }, "FY26-Q4")).toBe("FY25");
    expect(refPeriod({ type: "ytd", back: 1 }, "FY27-Q3")).toBe("YTD-2025-12");
    expect(columnHeader({ id: "y", kind: "period", ref: { type: "ytd", back: 0 }, label: null }, "FY27-Q2")).toBe("6M FY27");
  });

  it("works out changes, NM for losses", () => {
    expect(changePct(250, 200, "nm")).toBe("25.00%");
    expect(changePct(-10, -12, "nm")).toBe("NM");
    expect(changePct(-10, -12, "calc")).toBe("16.67%");
    expect(changePct(5, 0, "calc")).toBe("NM");
  });

  it("recommends a format and builds a Q2 result from it", () => {
    const f = recommendedFormat("Example Private Limited", lines, "FY27-Q2");
    expect(f.columns.map((c) => c.kind)).toEqual(["period", "period", "change", "period", "change"]);
    const labels = f.tables[0].rows.map((r) => `${r.label}:${r.style}`);
    expect(labels).toEqual(["Revenue:key", "COGS:normal", "EBITDA:key", "EBITDA margin:key"]);
    const res = buildResult(f, lines, "FY27-Q2");
    expect(res.headers).toEqual(["Q2 FY27", "Q1 FY27", "Change (in %)", "Q2 FY26", "Change (in %)"]);
    const row = (l: string) => res.tables[0].rows.find((r) => r.label === l)?.cells.map((c) => c.text);
    expect(row("Revenue")).toEqual(["250.00", "200.00", "25.00%", "400.00", "-37.50%"]);
    expect(row("COGS")).toEqual(["150.00", "120.00", "25.00%", "260.00", "-42.31%"]);
    expect(row("EBITDA")).toEqual(["-10.00", "-12.00", "NM", "60.00", "NM"]);
    expect(row("EBITDA margin")).toEqual(["-4.00%", "-6.00%", "", "15.00%", ""]);
    expect(res.notes).toEqual(["NM = not meaningful (loss in current or base period)."]);
    expect(res.missing).toBe(0);
    // A Q4 result adds the year columns.
    expect(recommendedFormat("K", lines, "FY26-Q4").columns).toHaveLength(8);
  });

  it("formula rows add and subtract lines; missing figures are counted", () => {
    const f: ResultFormat = {
      version: 1,
      title: "K",
      columns: [{ id: "a", kind: "period", ref: { type: "quarter", back: 0 }, label: null }, { id: "b", kind: "period", ref: { type: "year", back: 0 }, label: null }],
      tables: [{ id: "t", caption: "Rs in Cr", rows: [{ id: "gp", kind: "formula", label: "Gross profit", style: "key", terms: [{ lineId: "rev", sign: 1 }, { lineId: "cogs", sign: -1 }] }, { id: "h", kind: "heading", label: "Expenses", style: "normal" }] }],
      footnote: "Source: MIS.",
      lossChange: "nm",
    };
    const res = buildResult(f, lines, "FY27-Q2");
    expect(res.tables[0].rows[0].cells.map((c) => c.text)).toEqual(["100.00", ""]);
    expect(res.tables[0].rows[0].cells[0].how).toBe("Revenue − COGS");
    expect(res.missing).toBe(1);
    expect(res.notes).toEqual(["Source: MIS."]);
  });

  it("lists quarters that have the main line", () => {
    expect(resultQuarters(lines, ["FY27-Q3", "FY27-Q2", "FY27-Q1", "FY26-Q4"])).toEqual(["FY27-Q2", "FY27-Q1"]);
  });
});
