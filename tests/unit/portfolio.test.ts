import { describe, expect, it } from "vitest";
import { fyOf, holdingOf, portfolioSummary, splitParts, suggestedStake } from "@/lib/domain/portfolio";

const rounds = [
  { date: "2024-06-10", amount: 10, fund: "Hedgehogs" as const },
  { date: "2025-11-02", amount: 5, fund: "Sambhav" as const },
  { date: "2025-12-01", amount: 2.5, fund: "Hedgehogs" as const },
];

describe("holdings", () => {
  it("totals rounds and splits by fund", () => {
    expect(holdingOf(rounds)).toEqual({
      invested: 17.5,
      byFund: { Hedgehogs: 12.5, Sambhav: 5, unset: 0 },
      rounds: 3,
      firstDate: "2024-06-10",
    });
  });

  it("keeps rounds without a fund separate", () => {
    const h = holdingOf([{ date: "2024-01-01", amount: 3, fund: null }]);
    expect(h.byFund).toEqual({ Hedgehogs: 0, Sambhav: 0, unset: 3 });
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
    expect(s).toMatchObject({ companies: 3, invested: 22.5, byFund: { Hedgehogs: 12.5, Sambhav: 10, unset: 0 } });
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
