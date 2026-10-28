import { describe, expect, it } from "vitest";
import {
  defaultMisDue,
  groupMeetings,
  isQuarterKey,
  lastEndedQuarter,
  meetingSummary,
  misState,
  quarterLabel,
  quarterOf,
  quarterOptions,
  quarterRange,
  resultsPeriod,
  shiftQuarter,
} from "@/lib/domain/quarters";

describe("Indian FY quarters", () => {
  it("maps dates to quarters", () => {
    expect(quarterOf("2026-04-01")).toBe("FY27-Q1");
    expect(quarterOf("2026-09-30")).toBe("FY27-Q2");
    expect(quarterOf("2026-10-16")).toBe("FY27-Q3");
    expect(quarterOf("2027-03-31")).toBe("FY27-Q4");
    expect(quarterOf("2027-04-01")).toBe("FY28-Q1");
  });

  it("gives ranges, labels and shifts", () => {
    expect(quarterRange("FY27-Q2")).toEqual({ start: "2026-07-01", end: "2026-09-30" });
    expect(quarterRange("FY27-Q3")).toEqual({ start: "2026-10-01", end: "2026-12-31" });
    expect(quarterRange("FY27-Q4")).toEqual({ start: "2027-01-01", end: "2027-03-31" });
    expect(quarterLabel("FY27-Q2")).toBe("Q2 FY27");
    expect(shiftQuarter("FY27-Q1", -1)).toBe("FY26-Q4");
    expect(shiftQuarter("FY27-Q4", 1)).toBe("FY28-Q1");
    expect(isQuarterKey("FY27-Q2")).toBe(true);
    expect(isQuarterKey("FY27-Q5")).toBe(false);
  });

  it("defaults to the last ended quarter, with MIS due 45 days after it ends", () => {
    expect(lastEndedQuarter("2026-10-16")).toBe("FY27-Q2");
    expect(defaultMisDue("FY27-Q2")).toBe("2026-11-14");
    expect(resultsPeriod("FY27-Q2")).toEqual({ start: "2026-10-01", end: "2026-12-31" });
    expect(quarterOptions("2026-10-16", 2)).toEqual(["FY27-Q3", "FY27-Q2", "FY27-Q1"]);
  });
});

describe("tracker and meetings", () => {
  it("MIS state", () => {
    expect(misState("2026-11-01", "2026-11-14", "2026-12-01")).toBe("received");
    expect(misState(null, "2026-11-14", "2026-11-14")).toBe("pending");
    expect(misState(null, "2026-11-14", "2026-11-15")).toBe("overdue");
  });

  it("groups meetings into overdue, upcoming and past", () => {
    const m = [
      { id: "a", date: "2026-10-10", status: "PLANNED" as const },
      { id: "b", date: "2026-10-20", status: "PLANNED" as const },
      { id: "c", date: "2026-10-18", status: "PLANNED" as const },
      { id: "d", date: "2026-09-01", status: "DONE" as const },
      { id: "e", date: "2026-10-01", status: "CANCELLED" as const },
    ];
    const g = groupMeetings(m, "2026-10-16");
    expect(g.overdue.map((x) => x.id)).toEqual(["a"]);
    expect(g.upcoming.map((x) => x.id)).toEqual(["c", "b"]);
    expect(g.past.map((x) => x.id)).toEqual(["e", "d"]);
  });

  it("summarises meetings in a period, ignoring cancelled", () => {
    const m = [
      { date: "2026-10-05", status: "DONE" as const },
      { date: "2026-11-20", status: "PLANNED" as const },
      { date: "2026-11-21", status: "CANCELLED" as const },
      { date: "2027-01-05", status: "DONE" as const },
    ];
    expect(meetingSummary(m, "2026-10-01", "2026-12-31")).toBe("1 done · 1 planned");
    expect(meetingSummary(m, "2026-07-01", "2026-09-30")).toBeNull();
  });
});

import { splitUploads } from "@/lib/domain/quarters";

describe("splitUploads (quarterly tracker multi-file / folder upload)", () => {
  const f = (name: string, size = 10) => ({ name, size });
  it("keeps MIS-type files and skips the rest", () => {
    const r = splitUploads([f("Sep MIS.xlsx"), f("Q2.PDF"), f("notes.docx"), f(".DS_Store"), f("~$Sep MIS.xlsx"), f("empty.pdf", 0), f("data.csv")], "MIS");
    expect(r.upload.map((x) => x.name)).toEqual(["Sep MIS.xlsx", "Q2.PDF", "data.csv"]);
    expect(r.skipped.map((x) => x.name)).toEqual(["notes.docx", ".DS_Store", "~$Sep MIS.xlsx", "empty.pdf"]);
  });
  it("result notes take Word, PowerPoint and images (past results) too", () => {
    expect(splitUploads([f("note.docx"), f("deck.pptx"), f("img.png"), f("old.JPG"), f("notes.txt")], "RESULT_NOTE").upload.map((x) => x.name)).toEqual([
      "note.docx",
      "deck.pptx",
      "img.png",
      "old.JPG",
    ]);
  });
});
