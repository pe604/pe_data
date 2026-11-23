import { describe, expect, it } from "vitest";
import {
  agree,
  checkNumbers,
  checkQuotes,
  flagsFor,
  groundWork,
  hasBannedWord,
  highlightLabel,
  highlightsFor,
  lookupRow,
  meanLabel,
  means,
  meetingRow,
  normText,
  revenueDeclines,
  type Facts,
  type FitParam,
  type FlagContext,
  type ScoreRow,
} from "@/lib/domain/fit";

// Made-up deck text and figures only.
const DECK = [
  "[Page 1]\nAcme Drives makes precision actuators for aerospace customers in Pune.",
  "[Page 2]\nWe are an approved vendor to HAL and qualified by DRDO since 2021.",
  "[Page 3]\nRevenue FY24 42.5, EBITDA 8.1, PAT 3.2 (INR Cr). Order book of 120 Cr.",
  "[Page 4]\nRaising ₹ 30 Cr at a pre-money of ₹ 240 Cr. Top customer is 38% of revenue.",
  "[Page 5]\nOur patented gear design cuts weight by 30% versus imports, protected by two Indian patents.",
].join("\n\n");

const emptyNumbers = {
  unit: null,
  lastActualYear: null,
  nextPlanYear: null,
  lastActualRevenue: null,
  lastActualEbitda: null,
  lastActualPat: null,
  nextPlanRevenue: null,
  orderBook: null,
  raise: null,
  preMoney: null,
  secondaryPct: null,
  topCustomerPct: null,
  schemeSharePct: null,
  receivableDays: null,
  capexPlanned: null,
  newDebt: null,
} satisfies Facts["numbers"];

const facts = (p: Partial<Facts> = {}): Facts => ({ theme: null, quotes: {}, qualification: [], numbers: emptyNumbers, flagQuotes: { relatedParty: [], subsidyProfit: [] }, ...p });

describe("checking the deck reading (SPEC §17.6)", () => {
  it("keeps quotes copied word for word, whatever the case, punctuation or line breaks", () => {
    const r = checkQuotes(facts({ quotes: { F1: [{ text: "our patented gear design cuts weight by 30% versus imports", page: 5 }] } }), DECK);
    expect(r.facts.quotes.F1).toHaveLength(1);
    expect(r.kept).toBe(1);
    expect(r.unchecked).toBe(false);
  });

  it("drops a paraphrased quote", () => {
    const r = checkQuotes(facts({ quotes: { F1: [{ text: "Its patented gears make it lighter than imports", page: 5 }] } }), DECK);
    expect(r.facts.quotes.F1).toEqual([]);
    expect(r.dropped).toBe(1);
  });

  it("drops quotes over 40 words, more than four per parameter, and duplicates", () => {
    const long = { text: Array(41).fill("word").join(" "), page: 1 };
    const q = { text: "approved vendor to HAL", page: 2 };
    const r = checkQuotes(facts({ quotes: { F1: [long, q, q] }, qualification: [q] }), DECK);
    expect(r.facts.quotes.F1).toHaveLength(1);
    expect(r.facts.qualification).toHaveLength(1);
  });

  it("does not match a quote that only appears inside a longer word", () => {
    const r = checkQuotes(facts({ quotes: { F2: [{ text: "ctuators for aero", page: 1 }] } }), DECK);
    expect(r.facts.quotes.F2).toEqual([]);
  });

  it("keeps quotes from a scanned deck but marks them unchecked", () => {
    const r = checkQuotes(facts({ quotes: { F1: [{ text: "anything at all", page: 1 }] } }), "[Page 1]\n");
    expect(r.unchecked).toBe(true);
    expect(r.facts.quotes.F1).toHaveLength(1);
  });

  it("nulls numbers that are not in the deck text", () => {
    const r = checkNumbers(facts({ numbers: { ...emptyNumbers, unit: "INR_CR", lastActualRevenue: 42.5, lastActualEbitda: 81, preMoney: 240, raise: 30 } }), DECK);
    expect(r.facts.numbers.lastActualRevenue).toBe(42.5);
    expect(r.facts.numbers.preMoney).toBe(240);
    expect(r.facts.numbers.lastActualEbitda).toBeNull(); // 81 is not printed; 8.1 is
    expect(r.nulled).toEqual(["lastActualEbitda"]);
  });

  it("normalises text for matching", () => {
    expect(normText("“Approved”  vendor,\nto HAL!")).toBe("approved vendor to hal");
  });
});

describe("scoring (SPEC §17.7)", () => {
  it("applies the agreement rule", () => {
    expect(agree(4, 4)).toEqual({ score: 4, agreed: true, blank: null });
    expect(agree(4, 3)).toEqual({ score: 3, agreed: false, blank: null });
    expect(agree(3, 4).score).toBe(3);
    expect(agree(5, 2)).toEqual({ score: null, agreed: false, blank: "DISAGREED" });
    expect(agree(null, 4)).toEqual({ score: null, agreed: false, blank: "DISAGREED" });
    expect(agree(null, null)).toEqual({ score: null, agreed: true, blank: "NOT_IN_DECK" });
  });

  it("rejects the words a rating may never use, in any form", () => {
    for (const w of ["We recommend this", "Avoid it", "a clear pass", "worth investing in", "an investment case", "reject", "rejected twice", "buy now", "buying"]) {
      expect(hasBannedWord(w)).toBe(true);
    }
    for (const w of ["Two named investors joined", "passive income", "bypass valves", "buyer concentration is low", "compass", "Order book covers the plan"]) {
      expect(hasBannedWord(w), w).toBe(false);
    }
  });

  it("scores the theme status as a lookup, and leaves meeting parameters for later", () => {
    expect(lookupRow("F4", "CORE").score).toBe(5);
    expect(lookupRow("F4", null).score).toBe(3);
    expect(meetingRow("P4")).toMatchObject({ score: null, blank: "MEETING" });
  });
});

describe("means (SPEC §17.5)", () => {
  const P = (code: string, group: "FIT" | "PROMISE", weight = 1): FitParam => ({ code, name: code, question: "?", group, source: "DECK", weight });
  const params = [P("F1", "FIT"), P("F2", "FIT"), P("F3", "FIT"), P("F4", "FIT"), P("F5", "FIT"), P("P1", "PROMISE"), P("P2", "PROMISE"), P("P3", "PROMISE")];
  const row = (code: string, score: number | null): ScoreRow => ({ code, score, anchor: null, why: "", readings: [], agreed: true, blank: score === null ? "NOT_IN_DECK" : null });

  it("leaves blanks out of the mean and of the coverage count", () => {
    const m = means([row("F1", 4), row("F2", 5), row("F3", null), row("F4", 3), row("F5", 4), row("P1", 2), row("P2", 3), row("P3", null)], [], params);
    expect(m).toEqual({ fit: 4, promise: 2.5, fitScored: 4, fitTotal: 5, promiseScored: 2, promiseTotal: 3 });
  });

  it("needs four Fit parameters and two Promise ones", () => {
    const m = means([row("F1", 4), row("F2", 5), row("F3", 4), row("P1", 2)], [], params);
    expect(m.fit).toBeNull();
    expect(m.fitScored).toBe(3);
    expect(m.promise).toBeNull();
    expect(meanLabel("Fit", m.fit, m.fitScored, m.fitTotal)).toBe("Fit: not enough in the deck · 3 of 5");
  });

  it("uses a person's score in place of the model's", () => {
    const scores = [row("F1", 2), row("F2", 2), row("F3", 2), row("F4", 2)];
    expect(means(scores, [{ code: "F1", score: 4 }, { code: "F5", score: 5 }], params).fit).toBe(3); // (4+2+2+2+5)/5
  });

  it("weights parameters and rounds to one decimal", () => {
    const m = means([row("F1", 5), row("F2", 4), row("F3", 4), row("F4", 4)], [], [P("F1", "FIT", 2), P("F2", "FIT"), P("F3", "FIT"), P("F4", "FIT")]);
    expect(m.fit).toBe(4.4);
    expect(meanLabel("Fit", m.fit, m.fitScored, m.fitTotal)).toBe("Fit 4.4 · 4 of 4");
  });
});

describe("flags (SPEC §17.8)", () => {
  const base: FlagContext = { facts: facts(), financials: null, unverified: 0, stage: "NOT_ASSIGNED", holdingsSameTheme: [], seenBefore: null };
  const code = (f: ReturnType<typeof flagsFor>, c: string) => f.find((x) => x.code === c)?.value ?? null;

  it("works out the price ask, stage, scale and profit from the numbers", () => {
    const f = flagsFor({ ...base, facts: facts({ numbers: { ...emptyNumbers, unit: "INR_CR", lastActualYear: "FY24", lastActualRevenue: 42.5, lastActualEbitda: 8, lastActualPat: 3.2, preMoney: 240, raise: 30 } }) });
    expect(code(f, "FL01")).toBe("Pre-money ₹ 240 Cr, 30x last actual EBITDA (FY24)");
    expect(code(f, "FL02")).toBe("Revenue ₹ 42.5 Cr (FY24)");
    expect(code(f, "FL08")).toBe("Revenue ₹ 42.5 Cr (FY24), raising ₹ 30 Cr");
    expect(code(f, "FL12")).toBe("Profitable (FY24)");
    expect(code(f, "FL15")).toBe("None yet");
  });

  it("calls a company with no revenue pre-revenue, and omits flags with nothing to show", () => {
    const f = flagsFor(base);
    expect(code(f, "FL02")).toBe("Pre-revenue");
    expect(f.map((x) => x.code)).toEqual(["FL02", "FL15"]);
  });

  it("reads loss-making and marginal profit", () => {
    const loss = flagsFor({ ...base, facts: facts({ numbers: { ...emptyNumbers, lastActualEbitda: -4, lastActualPat: -6 } }) });
    expect(code(loss, "FL12")).toBe("Loss-making");
    const marginal = flagsFor({ ...base, facts: facts({ numbers: { ...emptyNumbers, lastActualEbitda: 4, lastActualPat: -1 } }) });
    expect(code(marginal, "FL12")).toBe("Marginal: EBITDA positive, PAT negative");
  });

  it("shows deck facts only when stated, with the quotes as the note", () => {
    const f = flagsFor({
      ...base,
      facts: facts({ numbers: { ...emptyNumbers, topCustomerPct: 38, secondaryPct: 20 }, flagQuotes: { relatedParty: [{ text: "leases its plant from the promoter", page: 9 }], subsidyProfit: [] } }),
    });
    expect(code(f, "FL09")).toBe("Top customer 38% of revenue");
    expect(code(f, "FL14")).toBe("20% of the round is secondary");
    expect(f.find((x) => x.code === "FL03")?.note).toBe('"leases its plant from the promoter" (p. 9)');
    expect(code(f, "FL04")).toBeNull();
  });

  it("finds two or more years of falling revenue in the summary table, ignoring projections", () => {
    const fin = { columns: ["FY22", "FY23", "FY24", "FY25E"], rows: [{ label: "Revenue", values: ["50", "44", "40", "60"] }] };
    expect(revenueDeclines(fin)).toEqual(["FY23", "FY24"]);
    expect(code(flagsFor({ ...base, financials: fin }), "FL11")).toBe("Revenue fell in FY23 and FY24");
    expect(revenueDeclines({ columns: ["FY23", "FY24"], rows: [{ label: "Revenue", values: ["50", "44"] }] })).toEqual(["FY24"]);
  });

  it("notes holdings in the theme, unreconciled figures, earlier visits and ground work", () => {
    const f = flagsFor({ ...base, holdingsSameTheme: ["Alpha", "Beta"], unverified: 2, seenBefore: { date: "12 Mar 2025", stage: "Call Pending" }, stage: "SCUTTLEBUTT" });
    expect(code(f, "FL06")).toBe("Same theme as Alpha, Beta");
    expect(code(f, "FL16")).toBe("2 figures in the summary not found in the deck");
    expect(code(f, "FL17")).toBe("Seen before, closed on 12 Mar 2025 at Call Pending");
    expect(code(f, "FL15")).toBe("Outside checks");
    expect(groundWork("INTERNAL_DISCUSSION")).toBe("Call done");
    expect(groundWork("CALL_PENDING")).toBe("None yet");
  });

  it("never uses a banned word in a flag", () => {
    const f = flagsFor({ ...base, holdingsSameTheme: ["X"], unverified: 1, seenBefore: { date: "1 Jan 2025", stage: null }, facts: facts({ numbers: { ...emptyNumbers, preMoney: 10, lastActualRevenue: 5, capexPlanned: 3, newDebt: 2, receivableDays: 90, schemeSharePct: 40 } }) });
    for (const x of f) expect(hasBannedWord(x.value), x.value).toBe(false);
  });
});

describe("highlights (SPEC §17.8)", () => {
  const q = [{ text: "approved vendor to HAL", page: 2 }];
  it("fires the sweet spot for a qualified vendor under ₹100 Cr, in any theme", () => {
    expect(highlightsFor(facts({ qualification: q, numbers: { ...emptyNumbers, unit: "INR_CR", lastActualRevenue: 42.5 } }), null)).toEqual([{ code: "H01", state: "CLAIMED", note: null }]);
    expect(highlightsFor(facts({ qualification: q, numbers: { ...emptyNumbers, unit: "INR_CR", lastActualRevenue: 150 } }), null)).toEqual([]);
    expect(highlightsFor(facts({ numbers: { ...emptyNumbers, lastActualRevenue: 42.5 } }), null)).toEqual([]);
    // US$ 15 Mn is about ₹135 Cr
    expect(highlightsFor(facts({ qualification: q, numbers: { ...emptyNumbers, unit: "USD_MN", lastActualRevenue: 15 } }), null)).toEqual([]);
  });
  it("keeps a person's check, and marks a priority theme", () => {
    const prev = [{ code: "H01", state: "CHECKED" as const, note: "Called HAL" }];
    const h = highlightsFor(facts({ qualification: q, numbers: { ...emptyNumbers, lastActualRevenue: 42.5 } }), { priority: true }, prev);
    expect(h).toEqual([prev[0], { code: "H02", state: "ON", note: null }]);
    expect(h.map(highlightLabel)).toEqual(["Sweet spot (checked)", "Priority theme"]);
  });
});
