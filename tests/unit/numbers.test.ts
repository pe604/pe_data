import { describe, expect, it } from "vitest";
import { changeAt, findSplits, numbersTsv, numbersView } from "@/lib/domain/numbers";
import { recommendedFormat, type LineData } from "@/lib/domain/resultFormat";

// Figures here are made up (tests are public; never use a portfolio company's real numbers).
const L = (id: string, section: string, label: string, values: Record<string, number>, unit: LineData["unit"] = "INR_CR", kind: LineData["kind"] = "FLOW"): LineData => ({
  id,
  section,
  label,
  unit,
  kind,
  values,
});
const lines: LineData[] = [
  L("rev", "P&L", "Revenue", { "FY26-Q2": 80, "FY26-Q3": 90, "FY26-Q4": 100, "FY27-Q1": 110, "2026-07": 40, "2026-08": 40, "2026-09": 40 }),
  L("on", "P&L", "Online", { "FY26-Q2": 50, "FY26-Q3": 55, "FY26-Q4": 60, "FY27-Q1": 70, "FY27-Q2": 75 }),
  L("off", "P&L", "Offline", { "FY26-Q2": 30, "FY26-Q3": 35, "FY26-Q4": 40, "FY27-Q1": 40, "FY27-Q2": 45 }),
  L("cogs", "P&L", "COGS", { "FY27-Q1": 66, "FY27-Q2": 72 }),
  L("gp", "P&L", "Gross profit", { "FY27-Q1": 44, "FY27-Q2": 48 }),
  L("ebitda", "P&L", "EBITDA", { "FY26-Q2": -8, "FY26-Q3": -5, "FY26-Q4": 4, "FY27-Q1": 8, "FY27-Q2": 12 }),
  L("pat", "P&L", "PAT", { "FY27-Q1": 2, "FY27-Q2": 5 }),
  L("cash", "Balance sheet", "Cash and bank balances", { "2026-09": 61.5, "2026-06": 70 }, "INR_CR", "STOCK"),
  L("assets", "Assets", "Total assets", { "2026-06": 500, "2026-09": 560 }, "INR_CR", "STOCK"),
  L("fee", "Assets", "Fee-based assets", { "2026-06": 150, "2026-09": 170 }, "INR_CR", "STOCK"),
  L("nonfee", "Assets", "Non-fee assets", { "2026-06": 350, "2026-09": 390 }, "INR_CR", "STOCK"),
  L("users", "Users", "Active users", { "2026-06": 1200, "2026-09": 1350 }, "NUM", "STOCK"),
];
const fmt = recommendedFormat("Testco", lines, "FY27-Q2");
const v = numbersView(fmt, lines, "FY27-Q2");

describe("numbers dashboard (SPEC §15.13)", () => {
  it("shows the quarters up to the base, working out a quarter from its months, dropping empty ones", () => {
    expect(v.periods).toEqual(["FY26-Q2", "FY26-Q3", "FY26-Q4", "FY27-Q1", "FY27-Q2"]);
    expect(v.headers[4]).toBe("Q2 FY27");
    expect(v.result.find((r) => r.label === "Revenue")?.values).toEqual([80, 90, 100, 110, 120]);
  });

  it("finds splits whose parts add up to the total, but never costs and profits", () => {
    const s = findSplits(lines, (l) => ["FY27-Q1", "FY27-Q2"].map((p) => l.values[p] ?? null));
    const revSplit = v.splits.find((x) => x.revenue);
    expect(revSplit?.parts.map((p) => p.label)).toEqual(["Online", "Offline"]);
    expect(v.splits.find((x) => x.label === "Total assets")?.parts.map((p) => p.label)).toEqual(["Fee-based assets", "Non-fee assets"]);
    // Revenue = COGS + Gross profit in Q1 and Q2 here, but that isn't a split of revenue.
    expect(s.some((x) => x.parts.some((p) => p.id === "cogs"))).toBe(false);
  });

  it("finds parts labelled with their total, in any order", () => {
    const named = [
      L("t", "KPIs", "Orders", { "FY27-Q1": 100 }, "NUM"),
      L("x", "KPIs", "Something else", { "FY27-Q1": 7 }, "NUM"),
      L("a", "KPIs", "Orders – App", { "FY27-Q1": 64 }, "NUM"),
      L("b", "KPIs", "Orders – Web", { "FY27-Q1": 36 }, "NUM"),
    ];
    const s = findSplits(named, (l) => [l.values["FY27-Q1"] ?? null]);
    expect(s.map((x) => [x.total.id, x.parts.map((p) => p.id)])).toEqual([["t", ["a", "b"]]]);
  });

  it("lists the revenue split under revenue in the table, and other metrics after", () => {
    const i = v.result.findIndex((r) => r.label === "Revenue");
    expect(v.result.slice(i + 1, i + 3).map((r) => [r.label, r.part])).toEqual([
      ["Online", true],
      ["Offline", true],
    ]);
    expect(v.metrics.map((r) => r.label)).toEqual(["Cash and bank balances", "Total assets", "Fee-based assets", "Non-fee assets", "Active users"]);
  });

  it("charts key figures with their margin as a line, not as a chart of its own", () => {
    const e = v.charts.find((c) => c.label === "EBITDA");
    expect(e?.line?.label).toBe("EBITDA margin");
    expect(e?.line?.values[4]).toBeCloseTo(10, 6);
    expect(v.charts.some((c) => c.label === "EBITDA margin")).toBe(false);
    expect(v.metricCharts.map((c) => c.label)).toEqual(["Cash and bank balances", "Active users"]);
  });

  it("puts revenue, EBITDA and PAT first in the tiles, then revenue over 12 months and cash", () => {
    expect(v.tiles.map((t) => t.label)).toEqual(["Revenue", "EBITDA", "PAT", "Gross profit", "Revenue, last 12 months", "Cash and bank balances"]);
    const ttm = v.tiles.find((t) => t.id === "ttm");
    expect(ttm?.value).toBe(420);
    expect(v.tiles[1].note).toBe("EBITDA margin 10.0%");
    expect(v.tiles[1].yoy).toBe("NM");
  });

  it("works out changes: NM on a loss, points for percentages", () => {
    expect(changeAt([8, 12], "INR_CR", 1, "nm")).toBe("50.00%");
    expect(changeAt([-5, 12], "INR_CR", 1, "nm")).toBe("NM");
    expect(changeAt([12], "INR_CR", 1, "nm")).toBeNull();
    expect(changeAt([7.3, 10], "PCT", 1, "nm")).toBe("+2.7 pts");
  });

  it("copies as tab-separated text for Excel", () => {
    const tsv = numbersTsv(v).split("\n");
    expect(tsv[0]).toBe("Rs in Cr\tQ2 FY26\tQ3 FY26\tQ4 FY26\tQ1 FY27\tQ2 FY27\tQoQ\tYoY");
    expect(tsv[1]).toBe("Revenue\t80\t90\t100\t110\t120\t9.09%\t50.00%");
    expect(tsv[2]).toBe("  Online\t50\t55\t60\t70\t75\t7.14%\t50.00%");
    expect(tsv).toContain("Operating metrics");
  });
});
