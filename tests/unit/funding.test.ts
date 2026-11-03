import { describe, expect, it } from "vitest";
import {
  allowedFigures,
  cleanRound,
  dollarFigures,
  fundingKey,
  lastFullWeek,
  linkPieces,
  mergeDeal,
  money,
  parseBenchmark,
  percentFigures,
  periodStats,
  rejectReason,
  sameRound,
  stageFor,
  toDealRow,
  toUsdM,
  uncheckedFigures,
  weekLabel,
  weekOf,
  weekRange,
  type ExtractedDeal,
  type FundingDealItem,
} from "@/lib/domain/funding";

// Made-up companies and figures only.
const deal = (p: Partial<FundingDealItem>): FundingDealItem => ({
  id: p.company ?? "x",
  company: "Acme",
  amountUsdM: 10,
  round: "Series A",
  stage: "EARLY",
  kind: "EQUITY",
  sector: "AI and software",
  what: null,
  lead: null,
  investors: [],
  date: "2026-10-05",
  sources: [{ outlet: "Inc42", url: "https://example.com/a" }],
  hidden: false,
  ours: null,
  ...p,
});

const ex = (p: Partial<ExtractedDeal>): ExtractedDeal => ({
  key: "H1",
  company: "Acme",
  amount: 100,
  currency: "INR_CR",
  round: "Series A",
  kind: "EQUITY",
  status: "DONE",
  indian: true,
  listed: false,
  startup: true,
  investors: ["Fund One", "Fund Two"],
  lead: "Fund One",
  sector: "Fintech",
  what: "lending app",
  ...p,
});

describe("funding: amounts and stages", () => {
  it("converts crore at 90 to the dollar and keeps dollars", () => {
    expect(toUsdM(90, "INR_CR")).toBe(10);
    expect(toUsdM(12.5, "USD")).toBe(12.5);
    expect(toUsdM(null, "USD")).toBeNull();
    expect(toUsdM(5, "NONE")).toBeNull();
  });
  it("maps rounds to stages", () => {
    expect(stageFor("Seed")).toBe("SEED");
    expect(stageFor("Pre-Series A")).toBe("EARLY");
    expect(stageFor("Series A")).toBe("EARLY");
    expect(stageFor("Series B")).toBe("GROWTH");
    expect(stageFor("Series D")).toBe("LATE");
    expect(stageFor("Pre-IPO")).toBe("LATE");
    expect(stageFor("Undisclosed round")).toBe("OTHER");
    expect(cleanRound("Unspecified")).toBe("Undisclosed round");
  });
  it("formats money", () => {
    expect(money(66)).toBe("$66M");
    expect(money(5.55)).toBe("$5.6M");
    expect(money(1160)).toBe("$1.16bn");
    expect(money(277.8)).toBe("$278M");
    expect(money(null)).toBe("Undisclosed");
  });
});

describe("funding: weeks", () => {
  it("numbers ISO weeks and gives Monday to Monday", () => {
    expect(weekOf("2026-11-02")).toBe("2026-W45");
    expect(weekOf("2026-11-01")).toBe("2026-W44");
    expect(weekRange("2026-W44")).toEqual(["2026-10-26", "2026-11-02"]);
    expect(weekOf("2027-01-01")).toBe("2026-W53");
    expect(lastFullWeek("2026-11-02")).toBe("2026-W44");
    expect(lastFullWeek("2026-11-08")).toBe("2026-W44");
    expect(weekLabel("2026-W44")).toBe("26 Oct – 1 Nov");
  });
});

describe("funding: reading the news", () => {
  it("drops talks, listed companies, foreign companies and roundups", () => {
    expect(rejectReason(ex({}), "Acme raises Rs 100 Cr in Series A")).toBeNull();
    expect(rejectReason(ex({ status: "TALKS" }), "Acme in talks to raise")).toBe("not_done");
    expect(rejectReason(ex({}), "Acme in talks to raise $20M")).toBe("not_a_round");
    expect(rejectReason(ex({ listed: true }), "Acme QIP")).toBe("listed");
    expect(rejectReason(ex({ indian: false }), "US firm raises")).toBe("not_indian");
    expect(rejectReason(ex({}), "Indian startups raised $300M this week")).toBe("roundup");
    expect(rejectReason(ex({ kind: "ACQUISITION" }), "Fund acquires stake in Acme in block deal")).toBeNull();
    expect(rejectReason(ex({ company: "Pine Labs" }), "Pine Labs raises $100M")).toBe("listed");
    expect(rejectReason(ex({ startup: false }), "Big Corp JV gets Rs 600 Cr")).toBe("not_startup");
    expect(rejectReason(ex({ amount: 1000, currency: "USD", investors: [], lead: null }), "Acme gets $1 Bn")).toBe("implausible");
    expect(rejectReason(ex({ amount: 1000, currency: "USD" }), "Acme raises $1 Bn led by Fund One")).toBeNull();
    expect(rejectReason(ex({}), "Acme bags order for 40 aircraft")).toBe("not_a_round");
  });
  it("builds a row and merges a second report of the same round", () => {
    const a = toDealRow(ex({}), { url: "https://example.com/1", outlet: "The Economic Times", title: "t1", date: "2026-10-04" });
    expect(a).toMatchObject({ amountUsdM: 11.1, stage: "EARLY", sector: "Fintech", lead: "Fund One", key: "acme" });
    expect(a.sources[0].outlet).toBe("ET");
    const b = toDealRow(ex({ company: "Acme Technologies", amount: null, currency: "NONE", round: "Unspecified", investors: ["Fund Three"] }), { url: "https://example.com/2", outlet: "Inc42", title: "t2", date: "2026-10-02" });
    expect(sameRound(a, b)).toBe(true);
    const m = mergeDeal({ ...a, edited: false }, b);
    expect(m.sources).toHaveLength(2);
    expect(m.date).toBe("2026-10-02");
    expect(m.investors).toEqual(["Fund One", "Fund Two", "Fund Three"]);
    expect(m.amountUsdM).toBeUndefined(); // keeps the disclosed amount
    expect(mergeDeal({ ...a, edited: true }, b)).toEqual({ sources: m.sources });
    expect(sameRound(a, { ...b, date: "2026-12-20" })).toBe(false);
    expect(fundingKey("Zeta.ai")).toBe(fundingKey("Zeta AI"));
    // Outlets naming one company two ways: same amount, sector and kind within 10 days.
    const c = { ...a, company: "Other Name", key: "othername" };
    expect(sameRound(a, c)).toBe(true);
    expect(sameRound(a, { ...c, sector: "Consumer" })).toBe(false);
    expect(sameRound(a, { ...c, amountUsdM: 3 })).toBe(false);
  });
  it("reads a monthly report headline", () => {
    expect(parseBenchmark("Indian startup funding nosedives 47.5% to $678 Mn in October", "2026-10")).toEqual({ totalUsdM: 678, changePct: -47.5 });
    expect(parseBenchmark("Startup funding jumps 12% to $1.2 Bn in September", "2026-09")).toEqual({ totalUsdM: 1200, changePct: 12 });
    expect(parseBenchmark("Startup funding nosedives to $678 Mn in October", "2026-11")).toBeNull();
  });
});

describe("funding: figures", () => {
  const deals = [
    deal({ company: "A", amountUsdM: 50, stage: "GROWTH", lead: "Fund One" }),
    deal({ company: "B", amountUsdM: 30, lead: "Fund One Capital" }),
    deal({ company: "C", amountUsdM: 4, sector: "Consumer", stage: "SEED", lead: "Fund Two" }),
    deal({ company: "D", amountUsdM: null, sector: "Consumer" }),
    deal({ company: "E", amountUsdM: 200, kind: "DEBT", sector: "Energy transition" }),
    deal({ company: "F", amountUsdM: 900, hidden: true }),
  ];
  it("counts visible equity only", () => {
    const s = periodStats(deals);
    expect(s).toMatchObject({ total: 84, count: 4, disclosed: 3, median: 30, under5: 1 });
    expect(s.largest?.company).toBe("A");
    expect(s.sectors.map((x) => [x.name, x.amount, x.count])).toEqual([
      ["AI and software", 80, 2],
      ["Consumer", 4, 2],
    ]);
    expect(s.growth.amount).toBe(50);
    expect(s.investors[0]).toMatchObject({ amount: 80, count: 2 }); // "Fund One" and "Fund One Capital" are one investor
  });
  it("finds figures the data doesn't support", () => {
    expect(dollarFigures("raised $66M, then $1.16bn and $2.5 million")).toEqual([66, 1160, 2.5]);
    expect(percentFigures("down 47.5% and 12 per cent")).toEqual([47.5, 12]);
    const allowed = allowedFigures(deals, periodStats(deals), 100, null);
    expect(uncheckedFigures(["[[A]] raised $50M, [[B]] $30M, together $80M, about $84M in all, under $5M, debt of $200M"], allowed)).toEqual([]);
    expect(uncheckedFigures(["[[A]] raised $57M and the market fell 16%"], allowed)).toEqual(["$57M"]);
    expect(uncheckedFigures(["equity fell 16% on last month"], allowed)).toEqual([]); // 84 vs 100
  });
  it("splits [[Company]] links", () => {
    expect(linkPieces("[[A]] led, [[Zed]] too.", (n) => (n === "A" ? "https://example.com/a" : null))).toEqual([
      { t: "A", href: "https://example.com/a" },
      { t: " led, ", href: null },
      { t: "Zed", href: null },
      { t: " too.", href: null },
    ]);
  });
});
