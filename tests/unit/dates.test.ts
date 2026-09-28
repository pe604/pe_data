import { describe, expect, it } from "vitest";
import { addDays, ageClass, daysBetween, daysFor, fmtDate, todayISO } from "@/lib/domain/dates";

describe("todayISO", () => {
  it("uses the India calendar date, not UTC", () => {
    // 20:00 UTC on 1 Mar is 01:30 on 2 Mar in India.
    expect(todayISO(new Date("2026-03-01T20:00:00Z"))).toBe("2026-03-02");
    expect(todayISO(new Date("2026-03-01T10:00:00Z"))).toBe("2026-03-01");
  });
});

describe("daysBetween / addDays", () => {
  it("counts whole days", () => {
    expect(daysBetween("2026-01-01", "2026-01-31")).toBe(30);
    expect(daysBetween("2024-02-28", "2024-03-01")).toBe(2); // leap year
  });
  it("is never negative and handles blanks", () => {
    expect(daysBetween("2026-02-01", "2026-01-01")).toBe(0);
    expect(daysBetween(null, "2026-01-01")).toBe(0);
  });
  it("adds days across month ends", () => {
    expect(addDays("2026-01-30", 3)).toBe("2026-02-02");
    expect(addDays("2026-03-01", -1)).toBe("2026-02-28");
  });
});

describe("daysFor", () => {
  const today = "2026-06-30";
  it("returns null when there is no date", () => {
    expect(daysFor({ dateReceived: null, status: "PIPELINE", exitAt: null }, today)).toBeNull();
  });
  it("counts to today for pipeline companies", () => {
    expect(daysFor({ dateReceived: "2026-06-01", status: "PIPELINE", exitAt: null }, today)).toBe(29);
  });
  it("freezes at exitAt for rejected and invested companies", () => {
    expect(daysFor({ dateReceived: "2026-06-01", status: "REJECTED", exitAt: "2026-06-11" }, today)).toBe(10);
    expect(daysFor({ dateReceived: "2026-06-01", status: "INVESTED", exitAt: "2026-06-21" }, today)).toBe(20);
  });
});

describe("ageClass", () => {
  it("uses the ≤30 / 31–60 / >60 thresholds", () => {
    expect(ageClass(30, "PIPELINE")).toBe("a1");
    expect(ageClass(31, "PIPELINE")).toBe("a2");
    expect(ageClass(60, "PIPELINE")).toBe("a2");
    expect(ageClass(61, "PIPELINE")).toBe("a3");
    expect(ageClass(90, "REJECTED")).toBe("frozen");
  });
});

describe("fmtDate", () => {
  it("formats as day month year", () => {
    expect(fmtDate("2026-03-12")).toBe("12 Mar 2026");
    expect(fmtDate(null)).toBe("");
  });
});
