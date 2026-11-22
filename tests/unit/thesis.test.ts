import { describe, expect, it } from "vitest";
import {
  anchorsFor,
  currentRows,
  dealsForTheme,
  diffIsEmpty,
  diffThesis,
  eventsForTheme,
  evidenceDate,
  isStale,
  rowsAt,
  themeByCode,
  themeScore,
  thesisRowZ,
  thesisSeedZ,
  type StoredThesisRow,
  type ThemeData,
  type ThesisRow,
} from "@/lib/domain/thesis";

// Made-up rows only: the real seed is confidential and never read by tests.
const theme = (code: string, d: Partial<ThemeData> = {}): ThesisRow => ({
  kind: "THEME",
  code,
  evidence: "Test note, Jan 2026",
  decision: null,
  data: { name: `Theme ${code}`, status: "CORE", priority: false, crossSector: false, latestEvidence: "Jan 2026", basis: "b", exceptions: null, sectors: [], fundingSectors: [], eventSectors: [], keywords: [], ...d },
});
const param = (code: string): ThesisRow => ({ kind: "PARAMETER", code, evidence: "e", decision: null, data: { name: "Moat", question: "How deep is it?", group: "FIT", source: "DECK", weight: 1 } });
const anchor = (code: string, p: string, score: number): ThesisRow => ({ kind: "ANCHOR", code, evidence: "e", decision: null, data: { param: p, score, label: "Example Co", shows: "what good looks like" } });
const principle = (code: string, text: string, decision: string | null = null): ThesisRow => ({ kind: "PRINCIPLE", code, evidence: "e", decision, data: { text } });
const stored = (r: ThesisRow, fromVersion: number, toVersion: number | null = null, id = `${r.code}@${fromVersion}`): StoredThesisRow => ({ ...r, id, fromVersion, toVersion });

describe("thesis rows", () => {
  it("validates each kind and rejects unknown kinds, extra fields and bad scores", () => {
    expect(thesisRowZ.safeParse(theme("T01")).success).toBe(true);
    expect(thesisRowZ.safeParse(anchor("F1:5:1", "F1", 5)).success).toBe(true);
    expect(thesisRowZ.safeParse({ ...principle("PR01", "x"), kind: "OTHER" }).success).toBe(false);
    expect(thesisRowZ.safeParse({ ...principle("PR01", "x"), data: { text: "x", extra: 1 } }).success).toBe(false);
    expect(thesisRowZ.safeParse(anchor("F1:6:1", "F1", 6)).success).toBe(false);
    expect(thesisRowZ.safeParse({ ...theme("T01"), data: { ...(theme("T01").data as ThemeData), status: "MAYBE" } }).success).toBe(false);
  });

  it("checks the seed file as a whole: unique codes, known parameters, holdings on company themes", () => {
    const ok = { label: "1.0", note: "n", holdingThemes: { "Example Co": "T01", Other: null }, rows: [theme("T01"), param("F1"), anchor("F1:5:1", "F1", 5)] };
    expect(thesisSeedZ.safeParse(ok).success).toBe(true);
    expect(thesisSeedZ.safeParse({ ...ok, rows: [...ok.rows, theme("T01")] }).success).toBe(false);
    expect(thesisSeedZ.safeParse({ ...ok, rows: [...ok.rows, anchor("F9:5:1", "F9", 5)] }).success).toBe(false);
    expect(thesisSeedZ.safeParse({ ...ok, holdingThemes: { "Example Co": "T99" } }).success).toBe(false);
    expect(thesisSeedZ.safeParse({ ...ok, rows: [theme("T01", { crossSector: true }), param("F1")] }).success).toBe(false);
  });
});

describe("versions", () => {
  const rows = [stored(principle("PR01", "old"), 1, 2), stored(principle("PR01", "new"), 2), stored(principle("PR02", "gone"), 1, 3), stored(principle("PR03", "added"), 3)];
  it("current rows are the open ones", () => {
    expect(currentRows(rows).map((r) => r.id)).toEqual(["PR01@2", "PR03@3"]);
  });
  it("rebuilds any past version", () => {
    expect(rowsAt(rows, 1).map((r) => r.id)).toEqual(["PR01@1", "PR02@1"]);
    expect(rowsAt(rows, 2).map((r) => r.id)).toEqual(["PR01@2", "PR02@1"]);
    expect(rowsAt(rows, 3).map((r) => r.id)).toEqual(["PR01@2", "PR03@3"]);
  });
});

describe("lookups", () => {
  const rows = [theme("T01"), theme("T02", { status: "CAUTIONARY" }), param("F1"), anchor("F1:3:1", "F1", 3), anchor("F1:5:2", "F1", 5), anchor("F1:5:1", "F1", 5), anchor("F2:4:1", "F2", 4)];
  it("finds a theme by code", () => {
    expect(themeByCode(rows, "T02")?.data.status).toBe("CAUTIONARY");
    expect(themeByCode(rows, "T99")).toBeUndefined();
    expect(themeByCode(rows, null)).toBeUndefined();
  });
  it("lists a parameter's anchors, highest score first", () => {
    expect(anchorsFor(rows, "F1").map((a) => a.code)).toEqual(["F1:5:1", "F1:5:2", "F1:3:1"]);
    expect(anchorsFor(rows, "F7")).toEqual([]);
  });
  it("scores the theme status lookup (F4)", () => {
    expect(themeScore("CORE")).toBe(5);
    expect(themeScore("EMERGING")).toBe(3);
    expect(themeScore("NO_VIEW")).toBe(3);
    expect(themeScore("UNRESOLVED")).toBe(3);
    expect(themeScore("CAUTIONARY")).toBe(1);
    expect(themeScore(null)).toBe(3);
  });
});

describe("joins", () => {
  const deals = [
    { company: "Volt Meters", sector: "Energy transition", what: "smart meters for utilities" },
    { company: "SunRoof", sector: "Energy transition", what: "rooftop solar installer" },
    { company: "Every Brand", sector: "Consumer", what: "snacks" },
    { company: "Zap", sector: "Mobility and EV", what: "EV chargers" },
  ];
  it("matches funding rounds by sector, and by keyword when the theme has some", () => {
    expect(dealsForTheme({ fundingSectors: ["Energy transition"], keywords: ["meter"] }, deals).map((d) => d.company)).toEqual(["Volt Meters"]);
    expect(dealsForTheme({ fundingSectors: ["Energy transition"], keywords: [] }, deals).map((d) => d.company)).toEqual(["Volt Meters", "SunRoof"]);
    // Short keywords match whole words only: "ev" is not "every"
    expect(dealsForTheme({ fundingSectors: ["Consumer", "Mobility and EV"], keywords: ["ev"] }, deals).map((d) => d.company)).toEqual(["Zap"]);
    expect(dealsForTheme({ fundingSectors: [], keywords: ["meter"] }, deals)).toEqual([]);
  });
  it("matches events by event sector", () => {
    const events = [{ name: "A", sector: "Space" }, { name: "B", sector: "Water" }, { name: "C", sector: null }];
    expect(eventsForTheme({ eventSectors: ["Space", "Defence and aerospace"] }, events).map((e) => e.name)).toEqual(["A"]);
  });
});

describe("stale evidence", () => {
  it("reads the latest date a note mentions, generously", () => {
    expect(evidenceDate("22 Nov 2026")).toBe("2026-11-22");
    expect(evidenceDate("Oct 2025")).toBe("2025-10-31");
    expect(evidenceDate("September 2025")).toBe("2025-09-30");
    expect(evidenceDate("Mid 2026")).toBe("2026-06-30");
    expect(evidenceDate("Early 2026")).toBe("2026-03-31");
    expect(evidenceDate("2026")).toBe("2026-12-31");
    expect(evidenceDate("Sep 2026 (CN); stance stated 22 Nov 2026")).toBe("2026-11-22");
    expect(evidenceDate("Undated")).toBeNull();
    expect(evidenceDate("a decision 2026")).toBe("2026-12-31"); // "decision" is not December
  });
  it("is stale only when more than 12 months old and parseable", () => {
    const today = "2026-11-22";
    expect(isStale("Oct 2025", today)).toBe(true);
    expect(isStale("Jan 2024 (stale)", today)).toBe(true);
    expect(isStale("Nov 2025", today)).toBe(false); // counts as 30 Nov 2025
    expect(isStale("Dec 2025", today)).toBe(false);
    expect(isStale("Mid 2026", today)).toBe(false);
    expect(isStale("Undated", today)).toBe(false);
  });
});

describe("import diff", () => {
  /** What the import does with a diff, so a second run can be checked against the result. */
  function apply(rows: StoredThesisRow[], incoming: ThesisRow[], version: number): StoredThesisRow[] {
    const d = diffThesis(currentRows(rows), incoming);
    const close = new Set([...d.changed.map((c) => c.old.id), ...d.closed.map((r) => r.id)]);
    return [...rows.map((r) => (close.has(r.id) ? { ...r, toVersion: version } : r)), ...[...d.added, ...d.changed.map((c) => c.next)].map((r) => stored(r, version))];
  }

  it("sorts rows into added, changed, closed and unchanged by kind and code", () => {
    const now = [stored(principle("PR01", "same"), 1), stored(principle("PR02", "old text"), 1), stored(principle("PR03", "dropped"), 1), stored(theme("T01"), 1)];
    const file = [principle("PR01", "same"), principle("PR02", "new text"), principle("PR04", "brand new"), theme("T01")];
    const d = diffThesis(now, file);
    expect(d.added.map((r) => r.code)).toEqual(["PR04"]);
    expect(d.changed.map((c) => c.old.code)).toEqual(["PR02"]);
    expect(d.closed.map((r) => r.code)).toEqual(["PR03"]);
    expect(d.unchanged.map((r) => r.code)).toEqual(["PR01", "T01"]);
  });

  it("treats a changed evidence line or decision as a change, but not the order of fields", () => {
    const now = [stored(principle("PR01", "x"), 1), stored(principle("PR02", "y"), 1), stored(theme("T01", { keywords: ["a"] }), 1)];
    const reordered = theme("T01", { keywords: ["a"] });
    const t = reordered.data as ThemeData;
    const shuffled = { ...reordered, data: Object.fromEntries(Object.entries(t).reverse()) } as ThesisRow;
    const d = diffThesis(now, [{ ...principle("PR01", "x"), evidence: "new source" }, principle("PR02", "y", "D9"), shuffled]);
    expect(d.changed.map((c) => c.old.code)).toEqual(["PR01", "PR02"]);
    expect(d.unchanged.map((r) => r.code)).toEqual(["T01"]);
  });

  it("does not treat the same code under another kind as the same row", () => {
    const d = diffThesis([stored(principle("X1", "a"), 1)], [{ ...param("X1") }]);
    expect(d.added).toHaveLength(1);
    expect(d.closed).toHaveLength(1);
  });

  it("is idempotent: a second run with the same file changes nothing", () => {
    const file = [principle("PR01", "a"), theme("T01"), param("F1"), anchor("F1:5:1", "F1", 5)];
    const v1 = apply([], file, 1);
    expect(v1).toHaveLength(4);
    expect(diffIsEmpty(diffThesis(currentRows(v1), file))).toBe(true);
    const v2 = apply(v1, [principle("PR01", "b"), theme("T01"), param("F1")], 2);
    expect(currentRows(v2).map((r) => `${r.code}@${r.fromVersion}`).sort()).toEqual(["F1@1", "PR01@2", "T01@1"]);
    expect(rowsAt(v2, 1).map((r) => r.code).sort()).toEqual(["F1", "F1:5:1", "PR01", "T01"]);
    expect(diffIsEmpty(diffThesis(currentRows(v2), [principle("PR01", "b"), theme("T01"), param("F1")]))).toBe(true);
  });
});
