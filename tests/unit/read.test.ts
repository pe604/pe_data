import { describe, expect, it } from "vitest";
import {
  canonicalRead,
  checkRead,
  hasBannedWord,
  highlightLabel,
  highlightsOf,
  parseRead,
  readStale,
  readZ,
  safeUrl,
  sameCompanyName,
  teamScoreZ,
  waitingReason,
  type Read,
  type ReadContext,
} from "@/lib/domain/read";

// A made-up read for a made-up company. Real reads are confidential and never used here.
const good = (): Read => ({
  schema: 1,
  company: "Voltaris Grid Systems",
  readAt: "2026-11-20",
  thesisLabel: "1.0",
  author: "Test reader",
  deckFile: "voltaris-deck.pdf",
  oneLine: "Makes smart meter enclosures for state utilities.",
  overall: { score: 7, why: "Strong position held back by thin numbers.", confidence: "MEDIUM", confidenceWhy: "Half the claims have outside sources." },
  scores: [
    { key: "POSITION", score: 7.5, why: "One of three approved vendors.", sources: ["s2"] },
    { key: "MOAT", score: 6, why: "Approvals take two years.", sources: ["s1"] },
    { key: "MARKET", score: 8, why: "Large rollout under way.", sources: ["s3"] },
    { key: "NUMBERS", score: 5, why: "Filings lag the plan.", sources: [] },
    { key: "THESIS", score: 8.5, why: "Proof over claims.", sources: [] },
  ],
  research: {
    whoElse: [{ name: "Example Meters", what: "Meters", scale: "Large", sources: ["s2"] }],
    howHard: [{ text: "Approvals take two years.", sources: ["s3"], deck: false }],
    rank: [{ text: "Third by volume.", sources: [], deck: true }],
    market: [{ text: "250 million meters planned.", sources: ["s3"], deck: false }],
    record: [],
  },
  deckVsPublic: [{ claim: "Approved vendor", found: "Listed on the utility site", status: "CONFIRMED", sources: ["s3"] }],
  thesis: [{ code: "PR01", side: "FOR", note: "Named approvals." }],
  theme: { code: "T01", note: "Grid equipment." },
  highlights: [{ code: "H01", state: "SUPPORTED", note: "Approved and small." }],
  flags: [{ label: "Close to listing", value: "Not before 2028", sources: [] }],
  openQuestions: ["How long is the order book?"],
  notChecked: ["Filings for FY26 were not yet public."],
  sources: [
    { id: "s1", kind: "SUBJECT", publisher: "Voltaris", title: "About us", url: "https://voltaris.example/about", date: "2026" },
    { id: "s2", kind: "RIVAL", publisher: "Example Meters", title: "Annual report", url: "https://meters.example/ar", date: "2026-03" },
    { id: "s3", kind: "GOVT", publisher: "State utility", title: "Approved vendors", url: "http://utility.example/vendors", date: "2026-03-14" },
  ],
});
/** a[i], failing the test when it is missing (instead of a non-null assertion). */
const at = <T,>(a: T[], i: number): T => {
  const x = a[i];
  if (x === undefined) throw new Error(`no item ${i}`);
  return x;
};
const ctx: ReadContext = { principleCodes: ["PR01", "PR02"], themeCodes: ["T01", "T02"] };
const codes = (r: Read) => checkRead(r, ctx).map((x) => x.code);
const edit = (f: (r: Read) => void): Read => {
  const r = good();
  f(r);
  return r;
};

describe("readZ shape and limits (SPEC §17.5)", () => {
  it("accepts a good read", () => {
    expect(readZ.safeParse(good()).success).toBe(true);
    expect(codes(good())).toEqual([]);
  });
  it("refuses unknown fields, a wrong schema, four scores, and text over the limits", () => {
    expect(readZ.safeParse({ ...good(), extra: 1 }).success).toBe(false);
    expect(readZ.safeParse({ ...good(), schema: 2 }).success).toBe(false);
    expect(readZ.safeParse({ ...good(), scores: good().scores.slice(0, 4) }).success).toBe(false);
    expect(readZ.safeParse({ ...good(), oneLine: "x".repeat(241) }).success).toBe(false);
    expect(readZ.safeParse({ ...good(), sources: Array.from({ length: 31 }, (_, i) => ({ ...good().sources[0], id: `x${i}` })) }).success).toBe(false);
    expect(readZ.safeParse({ ...good(), readAt: "2026-02-30" }).success).toBe(false);
  });
  it("allows an empty public record but not an empty list of rivals", () => {
    expect(readZ.safeParse(good()).success).toBe(true); // record is []
    expect(readZ.safeParse(edit((r) => (r.research.whoElse = []))).success).toBe(false);
  });
  it("refuses a read over 64 KB before anything else", () => {
    const big = { ...good(), padding: "x".repeat(70_000) };
    const p = parseRead(big, ctx);
    expect(p.ok).toBe(false);
    if (!p.ok) expect(p.reasons.map((r) => r.code)).toEqual(["TOO_LARGE"]);
  });
  it("turns shape errors into reasons with paths and no values", () => {
    const p = parseRead({ ...good(), oneLine: 42 }, ctx);
    expect(p.ok).toBe(false);
    if (!p.ok) expect(p.reasons[0]).toMatchObject({ code: "SHAPE", at: "oneLine" });
  });
});

describe("checkRead: one passing and one failing case per rule (SPEC §17.6, §17.7)", () => {
  it("half points", () => {
    expect(codes(edit((r) => (r.scores[1] = { ...at(r.scores, 1), score: 5.5 })))).toEqual([]);
    expect(codes(edit((r) => (r.scores[1] = { ...at(r.scores, 1), score: 6.3 })))).toContain("HALF_POINTS");
    expect(codes(edit((r) => (r.overall.score = 7.25)))).toContain("HALF_POINTS");
  });
  it("the five keys in order", () => {
    expect(codes(good())).not.toContain("SCORE_KEYS");
    expect(codes(edit((r) => r.scores.reverse()))).toContain("SCORE_KEYS");
    expect(codes(edit((r) => (r.scores[4] = { ...at(r.scores, 4), key: "MOAT" })))).toContain("SCORE_KEYS");
  });
  it("overall inside the range of the five", () => {
    expect(codes(edit((r) => (r.overall.score = 5)))).not.toContain("OVERALL_RANGE"); // lowest is 5
    expect(codes(edit((r) => (r.overall.score = 9)))).toContain("OVERALL_RANGE"); // highest is 8.5
    expect(codes(edit((r) => (r.overall.score = 4.5)))).toContain("OVERALL_RANGE");
  });
  it("an outside source behind any score above 6, except Thesis fit", () => {
    expect(codes(edit((r) => (r.scores[1] = { ...at(r.scores, 1), score: 6, sources: ["s1"] })))).not.toContain("NEEDS_OUTSIDE_SOURCE");
    expect(codes(edit((r) => (r.scores[1] = { ...at(r.scores, 1), score: 6.5, sources: ["s1"] })))).toContain("NEEDS_OUTSIDE_SOURCE");
    expect(codes(edit((r) => (r.scores[3] = { ...at(r.scores, 3), score: 7, sources: [] })))).toContain("NEEDS_OUTSIDE_SOURCE");
    expect(codes(edit((r) => (r.scores[4] = { ...at(r.scores, 4), score: 9, sources: [] })))).not.toContain("NEEDS_OUTSIDE_SOURCE");
  });
  it("source ids that resolve, once each", () => {
    expect(codes(edit((r) => (r.flags[0] = { ...at(r.flags, 0), sources: ["s1"] })))).not.toContain("UNKNOWN_SOURCE");
    expect(codes(edit((r) => (r.flags[0] = { ...at(r.flags, 0), sources: ["s9"] })))).toContain("UNKNOWN_SOURCE");
    expect(codes(edit((r) => (r.research.rank[0] = { ...at(r.research.rank, 0), sources: ["nope"] })))).toContain("UNKNOWN_SOURCE");
    expect(codes(edit((r) => r.sources.push({ ...at(r.sources, 0) })))).toContain("DUPLICATE_SOURCE");
  });
  it("http: or https: URLs only", () => {
    expect(codes(good())).not.toContain("BAD_URL");
    expect(codes(edit((r) => (r.sources[0] = { ...at(r.sources, 0), url: "javascript:alert(1)" })))).toContain("BAD_URL");
    expect(codes(edit((r) => (r.sources[0] = { ...at(r.sources, 0), url: "not a url" })))).toContain("BAD_URL");
  });
  it("notChecked is never empty", () => {
    expect(codes(good())).not.toContain("NOT_CHECKED_EMPTY");
    expect(codes(edit((r) => (r.notChecked = [])))).toContain("NOT_CHECKED_EMPTY");
  });
  it("no verdict word in judgement text; research text may report what others did", () => {
    expect(codes(edit((r) => (r.research.market[0] = { ...at(r.research.market, 0), text: "A rival is investing ₹300 Cr." })))).not.toContain("BANNED_WORD");
    expect(codes(edit((r) => (r.oneLine = "We recommend a closer look.")))).toContain("BANNED_WORD");
    expect(codes(edit((r) => (r.overall.why = "Worth avoiding for now.")))).toContain("BANNED_WORD");
    expect(codes(edit((r) => (r.scores[2] = { ...at(r.scores, 2), why: "Investors would pass on this." })))).toContain("BANNED_WORD");
    expect(codes(edit((r) => (r.thesis[0] = { ...at(r.thesis, 0), note: "Rejected before." })))).toContain("BANNED_WORD");
  });
  it("no em dash anywhere", () => {
    expect(codes(edit((r) => (r.openQuestions = ["FY24–26 plan?"])))).not.toContain("EM_DASH"); // en dash is fine
    expect(codes(edit((r) => (r.openQuestions = ["Plan — when?"])))).toContain("EM_DASH");
  });
  it("principle, theme and highlight codes the current thesis knows", () => {
    expect(codes(edit((r) => (r.theme.code = null)))).toEqual([]);
    expect(codes(edit((r) => (r.thesis[0] = { ...at(r.thesis, 0), code: "PR99" })))).toContain("UNKNOWN_PRINCIPLE");
    expect(codes(edit((r) => (r.theme.code = "T08")))).toContain("UNKNOWN_THEME");
    expect(codes(edit((r) => (r.highlights[0] = { ...at(r.highlights, 0), code: "H02" })))).toContain("UNKNOWN_HIGHLIGHT");
  });
  it("collects every reason at once", () => {
    const bad = edit((r) => {
      r.notChecked = [];
      r.oneLine = "Buy it.";
      r.sources[0] = { ...at(r.sources, 0), url: "ftp://x" };
    });
    expect(codes(bad).sort()).toEqual(["BAD_URL", "BANNED_WORD", "NOT_CHECKED_EMPTY"]);
  });
});

describe("words", () => {
  it("bans the verdict words in any form, allows investor and buyer", () => {
    for (const w of ["invest", "investment", "pass", "passed", "reject", "rejected", "recommend", "recommendation", "buy", "buying", "bought", "avoid", "avoided"]) expect(hasBannedWord(`We ${w} it`)).toBe(true);
    for (const w of ["investor", "investors", "buyer", "buyers", "passenger", "compass"]) expect(hasBannedWord(`The ${w} said so`)).toBe(false);
  });
});

describe("readStale (SPEC §17.7)", () => {
  const read = { readAt: "2026-10-01", loadedAt: "2026-10-02T10:00:00.000Z", thesisVersion: 2 };
  const now = { lastDeckAt: "2026-09-30T10:00:00.000Z", thesisVersion: 2, today: "2026-11-23" };
  it("is current when nothing changed", () => expect(readStale(read, now)).toBeNull());
  it("a deck uploaded after the read was loaded", () => expect(readStale(read, { ...now, lastDeckAt: "2026-10-03T00:00:00.000Z" })).toBe("NEW_DECK"));
  it("a newer thesis version", () => expect(readStale(read, { ...now, thesisVersion: 3 })).toBe("THESIS_CHANGED"));
  it("over 90 days old, counted from readAt", () => {
    expect(readStale(read, { ...now, today: "2026-12-30" })).toBeNull(); // 90 days
    expect(readStale(read, { ...now, today: "2026-12-31" })).toBe("OLD");
  });
  it("the waiting list: pipeline deals with a deck and no read or an out of date one", () => {
    expect(waitingReason({ status: "PIPELINE", hasDeck: true, read: null })).toBe("NO_READ");
    expect(waitingReason({ status: "PIPELINE", hasDeck: true, read: { stale: "OLD" } })).toBe("OLD");
    expect(waitingReason({ status: "PIPELINE", hasDeck: true, read: { stale: null } })).toBeNull();
    expect(waitingReason({ status: "PIPELINE", hasDeck: false, read: null })).toBeNull();
    expect(waitingReason({ status: "REJECTED", hasDeck: true, read: null })).toBeNull();
  });
});

describe("highlights (SPEC §17.8)", () => {
  it("labels claimed, supported and checked", () => {
    expect(highlightLabel({ code: "H01", state: "CLAIMED", note: null })).toBe("Sweet spot (claimed)");
    expect(highlightLabel({ code: "H01", state: "SUPPORTED", note: null })).toBe("Sweet spot (supported)");
    expect(highlightLabel({ code: "H01", state: "CHECKED", note: null })).toBe("Sweet spot (checked)");
    expect(highlightLabel({ code: "H02", state: "ON", note: null })).toBe("Priority theme");
  });
  it("H01 from the read, CHECKED when a person checked it, H02 by code", () => {
    const r = good();
    expect(highlightsOf(r, false).map((h) => `${h.code}:${h.state}`)).toEqual(["H01:SUPPORTED"]);
    expect(highlightsOf({ ...r, sweetCheck: { note: "Called them", by: "Team", at: "x" } }, true).map((h) => `${h.code}:${h.state}`)).toEqual(["H01:CHECKED", "H02:ON"]);
    expect(highlightsOf(null, true).map((h) => h.code)).toEqual(["H02"]);
    expect(highlightsOf(null, false)).toEqual([]);
  });
});

describe("helpers", () => {
  it("hashes the same read the same way whatever the field order", () => {
    const a = good();
    const b = JSON.parse(JSON.stringify(Object.fromEntries(Object.entries(a).reverse()))) as Read;
    expect(canonicalRead(a)).toBe(canonicalRead(b));
    expect(canonicalRead(a)).not.toBe(canonicalRead(edit((r) => (r.oneLine = "Something else."))));
  });
  it("matches company names ignoring case and outer spaces only", () => {
    expect(sameCompanyName("  voltaris GRID systems ", "Voltaris Grid Systems")).toBe(true);
    expect(sameCompanyName("Voltaris  Grid Systems", "Voltaris Grid Systems")).toBe(false);
  });
  it("safeUrl keeps http and https only", () => {
    expect(safeUrl("https://a.example/x")).toBe("https://a.example/x");
    expect(safeUrl("javascript:alert(1)")).toBeNull();
    expect(safeUrl("data:text/html,hi")).toBeNull();
  });
  it("team scores: half points 0 to 10 and a reason of 10 characters", () => {
    expect(teamScoreZ.safeParse({ key: "MOAT", score: 8.5, reason: "Visited the plant." }).success).toBe(true);
    expect(teamScoreZ.safeParse({ key: "OVERALL", score: 0, reason: "Checked twice." }).success).toBe(true);
    expect(teamScoreZ.safeParse({ key: "MOAT", score: 8.3, reason: "Visited the plant." }).success).toBe(false);
    expect(teamScoreZ.safeParse({ key: "MOAT", score: 11, reason: "Visited the plant." }).success).toBe(false);
    expect(teamScoreZ.safeParse({ key: "MOAT", score: 8, reason: "short" }).success).toBe(false);
    expect(teamScoreZ.safeParse({ key: "F1", score: 4, reason: "Version one code." }).success).toBe(false);
  });
});
