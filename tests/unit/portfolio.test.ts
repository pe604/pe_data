import { describe, expect, it } from "vitest";
import { companiesInYear, companySlices, foldSlices, yearSlices, fyOf, holdingOf, OTHER_KEY, portfolioSummary, sectorSlices, splitParts, suggestedStake } from "@/lib/domain/portfolio";

const rounds = [
  { date: "2024-06-10", amount: 10, fund: "Hedgehogs" as const },
  { date: "2025-11-02", amount: 5, fund: "Sambhav" as const },
  { date: "2025-12-01", amount: 2.5, fund: "Hedgehogs" as const },
];

describe("holdings", () => {
  it("totals rounds and splits by fund", () => {
    expect(holdingOf(rounds)).toEqual({
      invested: 17.5,
      byFund: { Hedgehogs: 12.5, Sambhav: 5, Other: 0, unset: 0 },
      rounds: 3,
      firstDate: "2024-06-10",
    });
  });

  it("keeps rounds without a fund separate", () => {
    const h = holdingOf([{ date: "2024-01-01", amount: 3, fund: null }]);
    expect(h.byFund).toEqual({ Hedgehogs: 0, Sambhav: 0, Other: 0, unset: 3 });
    expect(splitParts(h.byFund)).toEqual([["unset", 3]]);
    expect(splitParts(holdingOf(rounds).byFund)).toEqual([["Hedgehogs", 12.5], ["Sambhav", 5]]);
  });

  it("has no total without rounds", () => {
    expect(holdingOf([])).toMatchObject({ invested: null, rounds: 0, firstDate: null });
  });

  it("suggests stake = amount ÷ post-money", () => {
    expect(suggestedStake(20, 380)).toBe(5);
    expect(suggestedStake(10, null)).toBeNull();
  });
});

describe("portfolio summary", () => {
  it("totals, fund split, sector and FY of first investment", () => {
    const s = portfolioSummary([
      { sector: "Consumer & Retail", holding: holdingOf(rounds) },
      { sector: "Space Tech", holding: holdingOf([{ date: "2026-02-01", amount: 5, fund: "Sambhav" }]) },
      { sector: null, holding: holdingOf([]) },
    ]);
    expect(s).toMatchObject({ companies: 3, invested: 22.5, byFund: { Hedgehogs: 12.5, Sambhav: 10, Other: 0, unset: 0 } });
    expect(s.bySector[0]).toEqual({ name: "Consumer & Retail", invested: 17.5, companies: 1 });
    expect(s.byYear).toEqual([
      { fy: "FY25", invested: 17.5, companies: 1 },
      { fy: "FY26", invested: 5, companies: 1 },
    ]);
  });

  it("FY labels", () => {
    expect(fyOf("2025-03-31")).toBe("FY25");
    expect(fyOf("2025-04-01")).toBe("FY26");
  });
});

describe("allocation pie", () => {
  const H = (amount: number, fund: "Hedgehogs" | "Sambhav") => holdingOf([{ date: "2025-01-01", amount, fund }]);
  const rows = [
    { id: "a", name: "Alpha", sector: "Consumer & Retail", holding: H(10, "Hedgehogs") },
    { id: "b", name: "Beta", sector: "Consumer & Retail", holding: H(5, "Sambhav") },
    { id: "c", name: "Gamma", sector: "Space Tech", holding: H(8, "Sambhav") },
    { id: "d", name: "Delta", sector: null, holding: H(2, "Hedgehogs") },
    { id: "e", name: "Eps", sector: "Space Tech", holding: holdingOf([]) },
  ];

  it("sums by sector, largest first, per fund", () => {
    expect(sectorSlices(rows, "all")).toEqual([
      { key: "Consumer & Retail", label: "Consumer & Retail", value: 15, companies: 2 },
      { key: "Space Tech", label: "Space Tech", value: 8, companies: 1 },
      { key: "No sector", label: "No sector", value: 2, companies: 1 },
    ]);
    expect(sectorSlices(rows, "Sambhav").map((s) => [s.key, s.value])).toEqual([["Space Tech", 8], ["Consumer & Retail", 5]]);
    expect(sectorSlices(rows, "all", ["Space Tech"]).map((s) => s.key)).toEqual(["Space Tech"]);
  });

  it("drills into a sector's companies", () => {
    expect(companySlices(rows, "Consumer & Retail", "all").map((s) => [s.label, s.value])).toEqual([["Alpha", 10], ["Beta", 5]]);
    expect(companySlices(rows, "Consumer & Retail", "Hedgehogs").map((s) => s.label)).toEqual(["Alpha"]);
  });

  it("folds small slices into Other", () => {
    const many = Array.from({ length: 10 }, (_, i) => ({ key: "s" + i, label: "S" + i, value: 10 - i, companies: 1 }));
    const f = foldSlices(many);
    expect(f).toHaveLength(8);
    expect(f[7]).toMatchObject({ key: OTHER_KEY, label: "Other (3)", value: 6, companies: 3, members: ["s7", "s8", "s9"] });
    expect(foldSlices(many.slice(0, 3))).toHaveLength(3);
  });
});

describe("allocation by year", () => {
  const rows = [
    { id: "a", name: "Alpha", holding: holdingOf([{ date: "2024-06-01", amount: 10, fund: "Hedgehogs" }]) },
    { id: "b", name: "Beta", holding: holdingOf([{ date: "2025-02-01", amount: 4, fund: "Sambhav" }]) },
    { id: "c", name: "Gamma", holding: holdingOf([{ date: "2025-05-01", amount: 6, fund: "Sambhav" }]) },
  ];
  it("groups by FY of first investment and drills into companies", () => {
    expect(yearSlices(rows, "all").map((s) => [s.key, s.value, s.companies])).toEqual([["FY25", 14, 2], ["FY26", 6, 1]]);
    expect(yearSlices(rows, "Sambhav").map((s) => [s.key, s.value])).toEqual([["FY25", 4], ["FY26", 6]]);
    expect(companiesInYear(rows, "FY25", "all").map((s) => s.label)).toEqual(["Alpha", "Beta"]);
  });
});

describe("Other fund", () => {
  it("counts money from neither fund under Other, after the two funds", () => {
    const h = holdingOf([
      { date: "2025-01-01", amount: 3, fund: "Other" },
      { date: "2025-02-01", amount: 2, fund: "Sambhav" },
    ]);
    expect(h.invested).toBe(5);
    expect(splitParts(h.byFund)).toEqual([["Sambhav", 2], ["Other", 3]]);
  });
});
