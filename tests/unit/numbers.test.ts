import { describe, expect, it } from "vitest";
import { chartRows, latestChange, numbersView } from "@/lib/domain/numbers";
import { recommendedFormat, type LineData } from "@/lib/domain/resultFormat";

// Figures here are made up (tests are public; never use a portfolio company's real numbers).
const lines: LineData[] = [
  { id: "rev", section: "P&L", label: "Revenue", unit: "INR_CR", kind: "FLOW", values: { "FY26-Q3": 90, "FY26-Q4": 100, "FY27-Q1": 110, "2026-07": 40, "2026-08": 40, "2026-09": 40 } },
  { id: "ebitda", section: "P&L", label: "EBITDA", unit: "INR_CR", kind: "FLOW", values: { "FY26-Q3": -5, "FY26-Q4": 4, "FY27-Q1": 8, "FY27-Q2": 12 } },
  { id: "aum", section: "Operating metrics", label: "AUM", unit: "INR_CR", kind: "STOCK", values: { "2026-06": 500, "2026-09": 560 } },
  { id: "old", section: "Operating metrics", label: "Retired metric", unit: "NUM", kind: "STOCK", values: { "FY20-Q1": 3 } },
];
const fmt = recommendedFormat("Testco", lines, "FY27-Q2");

describe("numbers dashboard (SPEC §15.13)", () => {
  it("shows the last quarters up to the base, working out a quarter from its months, and drops empty ones", () => {
    const v = numbersView(fmt, lines, "FY27-Q2", "quarters");
    expect(v.periods).toEqual(["FY26-Q3", "FY26-Q4", "FY27-Q1", "FY27-Q2"]);
    expect(v.headers[3]).toBe("Q2 FY27");
    const rev = v.result.find((r) => r.label === "Revenue");
    expect(rev?.values).toEqual([90, 100, 110, 120]);
    expect(rev?.key).toBe(true);
  });

  it("adds a margin row from the recommended format as a percentage", () => {
    const v = numbersView(fmt, lines, "FY27-Q2", "quarters");
    const margin = v.result.find((r) => r.label === "EBITDA margin");
    expect(margin?.unit).toBe("PCT");
    expect(margin?.values[3]).toBeCloseTo(10, 6);
  });

  it("lists lines outside the format and the P&L as operating metrics, without ones that have no figure here", () => {
    const v = numbersView(fmt, lines, "FY27-Q2", "quarters");
    expect(v.metrics.map((r) => r.label)).toEqual(["AUM"]);
    expect(v.metrics[0].values).toEqual([null, null, 500, 560]);
  });

  it("shows full years only", () => {
    const year: LineData[] = [{ id: "rev", section: "P&L", label: "Revenue", unit: "INR_CR", kind: "FLOW", values: { FY25: 300, FY26: 380, "FY27-Q1": 110 } }];
    const v = numbersView(recommendedFormat("Testco", year, "FY27-Q1"), year, "FY27-Q1", "years");
    expect(v.periods).toEqual(["FY25", "FY26"]);
  });

  it("works out the latest change: NM on a loss, points for percentages", () => {
    const v = numbersView(fmt, lines, "FY27-Q2", "quarters");
    const ebitda = v.result.find((r) => r.label === "EBITDA");
    expect(ebitda && latestChange(ebitda, 1, "nm")).toBe("50.00%");
    expect(ebitda && latestChange(ebitda, 3, "nm")).toBe("NM");
    expect(ebitda && latestChange(ebitda, 4, "nm")).toBeNull();
    const margin = v.result.find((r) => r.label === "EBITDA margin");
    expect(margin && latestChange(margin, 1, "nm")).toBe("+2.7 pts");
  });

  it("charts the key rows", () => {
    const v = numbersView(fmt, lines, "FY27-Q2", "quarters");
    expect(chartRows(v).map((r) => r.label)).toEqual(["Revenue", "EBITDA", "EBITDA margin"]);
  });
});
