import { describe, expect, it } from "vitest";
import type { CompanyRow } from "@/lib/domain/types";
import { applyFilters, emptyFilters, queryToView, sortRows, viewToQuery } from "@/lib/domain/view";
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
  rejectReason: null,
  oneDriveUrl: null,
  pe: [],
  research: [],
  via: [],
  latestComment: null,
  commentCount: 0,
  fileCount: 0,
  commentSearch: "",
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
