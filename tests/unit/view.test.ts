import { describe, expect, it } from "vitest";
import type { CompanyRow } from "@/lib/domain/types";
import { applyFilters, defaultSortFor, emptyFilters, filtersForTab, NO_THEME, queryToView, sortRows, sortsForTab, thesisFromQuery, thesisQuery, viewToQuery } from "@/lib/domain/view";

describe("per-tab filters and sorts", () => {
  it("Invested hides Priority, Stage and Via and offers amount sorting", () => {
    expect(filtersForTab("invested")).toEqual(["sector", "theme", "pe", "research", "onedrive"]);
    // Theme is a filter on all three tabs (SPEC §17.10)
    expect(filtersForTab("pipeline")).toContain("theme");
    expect(filtersForTab("rejected")).toContain("theme");
    const inv = sortsForTab("invested").map(([k]) => k);
    expect(inv).toContain("amount-high");
    expect(inv.some((k) => k.startsWith("priority") || k.startsWith("stage"))).toBe(false);
    const pipe = sortsForTab("pipeline").map(([k]) => k);
    expect(pipe).toContain("priority");
    expect(pipe.some((k) => k.startsWith("amount"))).toBe(false);
  });
});
import { checkLink } from "@/lib/domain/onedrive";

const row = (p: Partial<CompanyRow>): CompanyRow => ({
  id: p.name ?? "x",
  name: "x",
  sectorId: null,
  sector: null,
  subSector: null,
  stage: "NOT_ASSIGNED",
  priority: null,
  status: "PIPELINE",
  dateReceived: null,
  exitAt: null,
  exitStage: null,
  directInvested: false,
  holding: null,
  rejectReason: null,
  oneDriveUrl: null,
  pe: [],
  research: [],
  via: [],
  latestComment: null,
  commentCount: 0,
  latestUpdate: null,
  updateCount: 0,
  fileCount: 0,
  commentSearch: "",
  themeCode: null,
  themeEdited: false,
  fit: null,
  fitJob: null,
  ...p,
});

const rows = [
  row({ name: "A", priority: 2, dateReceived: "2026-01-10", stage: "CALL_PENDING", pe: ["Keyur"] }),
  row({ name: "B", priority: null, dateReceived: "2026-03-01", stage: "ALLOCATION", pe: ["Arjun", "Keyur"] }),
  row({ name: "C", priority: 1, dateReceived: "2026-02-01", stage: "CALL_PENDING", sector: "Education" }),
  row({ name: "D", priority: 2, dateReceived: "2026-02-20", stage: "NOT_ASSIGNED", commentSearch: "valuation call" }),
];
const names = (l: CompanyRow[]) => l.map((c) => c.name).join("");

describe("sortRows (SPEC §6.2)", () => {
  it("defaults to priority 1→5, unset last, then newest received", () => {
    expect(names(sortRows(rows, "priority", "2026-06-01"))).toBe("CDAB");
  });
  it("priority 5→1 keeps unset last", () => {
    expect(names(sortRows(rows, "priority-desc", "2026-06-01"))).toBe("DACB");
  });
  it("sorts by days, blank dates last", () => {
    const withBlank = [...rows, row({ name: "E" })];
    expect(names(sortRows(withBlank, "days-most", "2026-06-01"))).toBe("ACDBE");
    expect(names(sortRows(withBlank, "days-least", "2026-06-01"))).toBe("BDCAE");
  });
  it("sorts by stage order", () => {
    expect(names(sortRows(rows, "stage"))[0]).toBe("D");
    expect(names(sortRows(rows, "stage-rev"))[0]).toBe("B");
  });
});

describe("applyFilters", () => {
  it("searches comments", () => {
    expect(names(applyFilters(rows, { ...emptyFilters(), q: "valuation" }))).toBe("D");
  });
  it("PE filter matches any assignee; PE counts can skip it", () => {
    const f = { ...emptyFilters(), pe: ["Arjun"], stage: ["CALL_PENDING"] };
    expect(names(applyFilters(rows, f))).toBe("");
    expect(names(applyFilters(rows, f, "pe"))).toBe("AC");
    expect(names(applyFilters(rows, f, "stage"))).toBe("B");
  });
  it("priority unset option", () => {
    expect(names(applyFilters(rows, { ...emptyFilters(), priority: ["unset"] }))).toBe("B");
  });
});

describe("URL state", () => {
  it("round-trips", () => {
    const v = { tab: "rejected" as const, sort: "name-az" as const, f: { ...emptyFilters(), q: "abc", pe: ["Keyur", "Arjun"], stage: ["ALLOCATION"] } };
    expect(queryToView(viewToQuery(v))).toEqual(v);
    expect(viewToQuery({ tab: "pipeline", sort: "priority", f: emptyFilters() })).toBe("");
  });
});

describe("checkLink (SPEC §6.4)", () => {
  it("rejects non-http protocols", () => {
    expect(checkLink("javascript:alert(1)").ok).toBe(false);
    expect(checkLink("not a url").ok).toBe(false);
  });
  it("warns for non-OneDrive hosts", () => {
    const r = checkLink("https://example.com/x");
    expect(r.ok && r.warn).toBeTruthy();
    const s = checkLink("https://niveshaay.sharepoint.com/sites/x");
    expect(s.ok && s.warn).toBeNull();
    expect(checkLink("https://1drv.ms/f/abc").ok).toBe(true);
  });
});

describe("rejected and invested sorts", () => {
  it("Rejected defaults to date rejected, oldest first, and only Rejected offers it", () => {
    expect(defaultSortFor("rejected")).toBe("rejected-old");
    expect(sortsForTab("rejected").map(([k]) => k)).toContain("rejected-new");
    expect(sortsForTab("pipeline").map(([k]) => k)).not.toContain("rejected-old");
    expect(queryToView("?tab=rejected").sort).toBe("rejected-old");
    expect(viewToQuery({ tab: "rejected", sort: "rejected-old", f: emptyFilters() })).toBe("?tab=rejected");
    const rows = [row({ name: "a", exitAt: "2026-03-01" }), row({ name: "b", exitAt: "2025-11-20" }), row({ name: "c", exitAt: null })];
    expect(sortRows(rows, "rejected-old").map((r) => r.name)).toEqual(["b", "a", "c"]);
    expect(sortRows(rows, "rejected-new").map((r) => r.name)).toEqual(["a", "b", "c"]);
  });

  it("Invested offers first-invested sorts, not date received or days", () => {
    const inv = sortsForTab("invested").map(([k]) => k);
    expect(inv).toEqual(expect.arrayContaining(["amount-high", "first-new", "first-old"]));
    expect(inv.some((k) => k.startsWith("date") || k.startsWith("days"))).toBe(false);
  });
});

describe("theme filter and the Thesis address (SPEC §17.3, §17.10)", () => {
  const themed = [row({ name: "A", themeCode: "T06" }), row({ name: "B", themeCode: "T02" }), row({ name: "C" })];
  it("filters by theme code, and by No theme", () => {
    expect(names(applyFilters(themed, { ...emptyFilters(), theme: ["T06"] }))).toBe("A");
    expect(names(applyFilters(themed, { ...emptyFilters(), theme: ["T06", NO_THEME] }))).toBe("AC");
    expect(names(applyFilters(themed, emptyFilters()))).toBe("ABC");
  });
  it("keeps the theme filter in the URL", () => {
    const v = queryToView(viewToQuery({ tab: "rejected", sort: defaultSortFor("rejected"), f: { ...emptyFilters(), theme: ["T06", NO_THEME] } }));
    expect(v.f.theme).toEqual(["T06", NO_THEME]);
  });
  it("builds and reads the Thesis tab's address", () => {
    expect(thesisQuery(null)).toBe("?view=thesis");
    expect(thesisQuery("T06")).toBe("?view=thesis&theme=T06");
    expect(thesisFromQuery("view=thesis&theme=T06")).toBe("T06");
    expect(thesisFromQuery("view=thesis")).toBeNull();
    expect(thesisFromQuery("view=thesis&theme=<script>")).toBeNull();
    expect(thesisFromQuery("tab=rejected")).toBeUndefined();
  });
});
describe("fit sorts and the highlights filter (SPEC §17.10)", () => {
  const fs = (fit: number | null, promise: number | null, codes: string[] = []) => ({
    fit, promise, fitScored: 5, fitTotal: 7, promiseScored: 2, promiseTotal: 5,
    highlights: codes.map((code) => ({ code, state: "CLAIMED" as const, note: null })),
  });
  const rated = [row({ name: "A", fit: fs(3.1, 4) }), row({ name: "B" }), row({ name: "C", fit: fs(4.5, null, ["H01"]) }), row({ name: "D", fit: fs(null, 2.5, ["H02"]) })];
  it("sorts by Fit or Promise, highest first, unrated last", () => {
    expect(names(sortRows(rated, "fit-high", "2026-06-01"))).toBe("CABD");
    expect(names(sortRows(rated, "promise-high", "2026-06-01"))).toBe("ADBC");
  });
  it("offers the fit sorts on Pipeline and Rejected, not Invested; the default sort is unchanged", () => {
    expect(sortsForTab("pipeline").map(([k]) => k)).toEqual(expect.arrayContaining(["fit-high", "promise-high"]));
    expect(sortsForTab("rejected").map(([k]) => k)).toContain("fit-high");
    expect(sortsForTab("invested").map(([k]) => k)).not.toContain("fit-high");
    expect(defaultSortFor("pipeline")).toBe("priority");
  });
  it("filters by highlight on Pipeline only", () => {
    expect(names(applyFilters(rated, { ...emptyFilters(), highlight: ["H01"] }))).toBe("C");
    expect(names(applyFilters(rated, { ...emptyFilters(), highlight: ["H01", "H02"] }))).toBe("CD");
    expect(filtersForTab("pipeline")).toContain("highlight");
    expect(filtersForTab("rejected")).not.toContain("highlight");
    expect(filtersForTab("invested")).not.toContain("highlight");
  });
});