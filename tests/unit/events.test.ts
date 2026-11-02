import { describe, expect, it } from "vitest";
import { eventDateLabel, eventNewsUrl, EVENT_KINDS, EVENT_SECTORS, groupEvents, isScanDue, looksLikeEvent, mentionsTracked, roundRobin, safeEventUrl, sameEvent, type EventItem } from "@/lib/domain/events";
import { EVENT_SEEDS } from "@/lib/domain/eventSeeds";

const ev = (p: Partial<EventItem>): EventItem => ({
  id: p.name ?? "x",
  name: "Test expo",
  kind: "SECTOR_EXPO",
  sector: null,
  organiser: null,
  city: null,
  startDate: null,
  endDate: null,
  dateNote: null,
  datesConfirmed: false,
  url: null,
  tier: "WORTH_A_LOOK",
  why: null,
  status: "NEW",
  attendees: [],
  notes: null,
  source: "SEED",
  ...p,
});

describe("events (SPEC §15.14)", () => {
  it("writes date ranges", () => {
    expect(eventDateLabel({ startDate: "2026-11-17", endDate: "2026-11-19" })).toBe("17–19 Nov 2026");
    expect(eventDateLabel({ startDate: "2027-02-28", endDate: "2027-03-02" })).toBe("28 Feb 2027 – 2 Mar 2027");
    expect(eventDateLabel({ startDate: "2027-02-05", endDate: null })).toBe("5 Feb 2027");
    expect(eventDateLabel({ startDate: null, endDate: null })).toBe("Date to be confirmed");
  });

  it("groups by month, then undated with Top first, then past; a running event is still upcoming", () => {
    const g = groupEvents(
      [
        ev({ name: "Later", startDate: "2027-02-08" }),
        ev({ name: "Soon", startDate: "2026-11-17", endDate: "2026-11-19" }),
        ev({ name: "Running", startDate: "2026-11-01", endDate: "2026-11-03" }),
        ev({ name: "Old", startDate: "2026-09-07" }),
        ev({ name: "A no date" }),
        ev({ name: "Z no date", tier: "TOP" }),
      ],
      "2026-11-02",
    );
    expect(g.months.map((m) => m.label)).toEqual(["November 2026", "February 2027"]);
    expect(g.months[0].items.map((e) => e.name)).toEqual(["Running", "Soon"]);
    expect(g.undated.map((e) => e.name)).toEqual(["Z no date", "A no date"]);
    expect(g.past.map((e) => e.name)).toEqual(["Old"]);
  });

  it("matches the same event across years and editions, but not a different year", () => {
    expect(sameEvent({ name: "Aero India 2027", startDate: null }, { name: "16th edition Aero India", startDate: "2027-02-08" })).toBe(true);
    expect(sameEvent({ name: "Aero India 2027", startDate: null }, { name: "Aero India 2025", startDate: null })).toBe(false);
    expect(sameEvent({ name: "Bharat Defence Tech Show 2027", startDate: null }, { name: "Battery Show India 2027", startDate: null })).toBe(false);
  });

  it("keeps links to http and https", () => {
    expect(safeEventUrl("https://aeroindia.gov.in")).toBe("https://aeroindia.gov.in/");
    expect(safeEventUrl("javascript:alert(1)")).toBeNull();
    expect(safeEventUrl("not a link")).toBeNull();
  });

  it("the keyword check drops what isn't an upcoming event, before any AI", () => {
    expect(looksLikeEvent("Battery Show India to be held in October")).toBe(true);
    expect(looksLikeEvent("Family office conclave in Mumbai on 12 March")).toBe(true);
    expect(looksLikeEvent("Solar stocks rally as tender wins rise")).toBe(false);
    expect(looksLikeEvent("Summit reached on the trek")).toBe(false);
  });

  it("spends nothing on events already tracked with a date, and gives every search a turn", () => {
    const tracked = [{ name: "Bengaluru Tech Summit 2026", startDate: "2026-11-17" }, { name: "IVCA Conclave 2027", startDate: null }];
    expect(mentionsTracked("Bengaluru Tech Summit to focus on AI", tracked)).toBe(true);
    expect(mentionsTracked("IVCA Conclave dates announced", tracked)).toBe(false);
    expect(roundRobin([[1, 2, 3], [4], [5, 6]])).toEqual([1, 4, 5, 2, 6, 3]);
  });

  it("scans once a week from Monday 9 am", () => {
    expect(isScanDue("Mon", 8)).toBe(false);
    expect(isScanDue("Mon", 9)).toBe(true);
    expect(isScanDue("Tue", 12)).toBe(false);
  });

  it("builds the search with its time window", () => {
    expect(decodeURIComponent(eventNewsUrl("India space expo", 7))).toContain("India space expo when:7d");
  });

  it("the starting list is well formed, with no event already over", () => {
    expect(new Set(EVENT_SEEDS.map((s) => s.name)).size).toBe(EVENT_SEEDS.length);
    for (const s of EVENT_SEEDS) {
      expect(EVENT_KINDS).toContain(s.kind);
      expect(EVENT_SECTORS).toContain(s.sector);
      if (s.startDate) expect(s.startDate >= "2026-11-02").toBe(true);
      if (s.endDate) expect(s.endDate >= (s.startDate as string)).toBe(true);
      if (!s.startDate) expect(s.dateNote).toBeTruthy();
      if (s.datesConfirmed) expect(s.startDate).toBeTruthy();
    }
  });
});
