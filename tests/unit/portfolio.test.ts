import { describe, expect, it } from "vitest";
import {
  fmtMoic,
  fyOf,
  holdingOf,
  latestMark,
  portfolioSummary,
  suggestedMarkStake,
  suggestedStake,
} from "@/lib/domain/portfolio";

const rounds = [
  { date: "2024-06-10", amount: 10, stakePct: 4 },
  { date: "2025-11-02", amount: 5, stakePct: 1 },
];

describe("holdings", () => {
  it("totals rounds and computes value and MOIC from the latest mark", () => {
    const h = holdingOf(rounds, { date: "2026-03-31", valuation: 600, stakePct: 4.5 });
    expect(h).toEqual({ invested: 15, rounds: 2, firstDate: "2024-06-10", currentValue: 27, moic: 1.8, markDate: "2026-03-31" });
  });

  it("has no value or MOIC without a mark, and no total without rounds", () => {
    expect(holdingOf(rounds, null)).toMatchObject({ invested: 15, currentValue: null, moic: null });
    expect(holdingOf([], null)).toMatchObject({ invested: null, rounds: 0, firstDate: null });
  });

  it("picks the latest mark by date", () => {
    const m = latestMark([{ date: "2025-03-31", v: 1 }, { date: "2026-03-31", v: 2 }, { date: "2025-09-30", v: 3 }]);
    expect(m?.v).toBe(2);
    expect(latestMark([])).toBeNull();
  });
});

describe("suggestions", () => {
  it("stake = amount ÷ post-money", () => {
    expect(suggestedStake(20, 380)).toBe(5);
    expect(suggestedStake(10, null)).toBeNull();
  });

  it("mark stake = previous mark, else sum of stakes bought", () => {
    expect(suggestedMarkStake(rounds, null)).toBe(5);
    expect(suggestedMarkStake(rounds, { date: "2026-03-31", valuation: 1, stakePct: 4.2 })).toBe(4.2);
    expect(suggestedMarkStake([{ date: "2024-01-01", amount: 1, stakePct: null }], null)).toBeNull();
  });
});

describe("portfolio summary", () => {
  it("values unmarked companies at cost and splits by sector and FY of first investment", () => {
    const s = portfolioSummary([
      { sector: "Consumer & Retail", holding: holdingOf(rounds, { date: "2026-03-31", valuation: 600, stakePct: 4.5 }) },
      { sector: "Space Tech", holding: holdingOf([{ date: "2026-02-01", amount: 5, stakePct: null }], null) },
      { sector: null, holding: holdingOf([], null) },
    ]);
    expect(s).toMatchObject({ companies: 3, invested: 20, currentValue: 32, moic: 1.6, unmarked: 1 });
    expect(s.bySector[0]).toEqual({ name: "Consumer & Retail", invested: 15, companies: 1 });
    expect(s.byYear).toEqual([
      { fy: "FY25", invested: 15, companies: 1 },
      { fy: "FY26", invested: 5, companies: 1 },
    ]);
  });

  it("formats FY and MOIC", () => {
    expect(fyOf("2025-03-31")).toBe("FY25");
    expect(fyOf("2025-04-01")).toBe("FY26");
    expect(fmtMoic(1.8)).toBe("1.80x");
    expect(fmtMoic(null)).toBeNull();
  });
});
