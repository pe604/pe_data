import { describe, expect, it } from "vitest";
import { parseEventbrite, parseEventsEye, parseTradeIndia, usableListings, type ListingItem } from "@/lib/domain/eventListings";
import { fundingText, rankSectors, sectorRegex, STARTER_SECTORS, vetProposals } from "@/lib/domain/eventSectors";
import { eventDateLabel, eventDigestText, eventNewsUrl, eventText, EVENT_KINDS, EVENT_SECTORS, groupEvents, isScanDue, looksLikeEvent, mentionsTracked, roundRobin, safeEventUrl, sameEvent, type EventItem } from "@/lib/domain/events";
import { EVENT_SEEDS } from "@/lib/domain/eventSeeds";

const ev = (p: Partial<EventItem>): EventItem => ({
  id: p.name ?? "x",
  name: "Test expo",
  kind: "SECTOR_EXPO",
  sector: null,
  organiser: null,
  city: null,
  venue: null,
  description: null,
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

  it("writes the PE Events message", () => {
    const e = ev({
      name: "Space Expo",
      tier: "TOP",
      sector: "Space",
      city: "Bengaluru",
      venue: "BIEC",
      description: "A trade show for space companies.",
      startDate: "2027-03-01",
      endDate: "2027-03-03",
      why: "Worth meeting founders.",
      url: "https://example.com/",
    });
    expect(eventText(e, true)).toBe(
      "⭐ *NEW TOP EVENT*\n*Space Expo*\n\n📅 1–3 Mar 2027 (check dates)\n🏙️ Bengaluru\n📍 BIEC\n\n🏷️ Sector expo · Space\n\nA trade show for space companies.\n\n💡 Worth meeting founders.\n\n🔗 https://example.com/",
    );
    expect(eventText(e, false).split("\n")[0]).toBe("🔄 *UPDATED EVENT*");
    expect(eventText(ev({ name: "No date" }), true)).toBe("🆕 *NEW EVENT*\n*No date*\n\n📅 Date to be confirmed\n\n🏷️ Sector expo");
  });

  it("sums up the first listing read in one message", () => {
    const text = eventDigestText([ev({ name: "B", tier: "TOP", startDate: "2027-02-01", city: "Pune" }), ev({ name: "A", tier: "TOP", startDate: "2027-01-01" }), ev({ name: "C", startDate: "2027-01-01" })]);
    expect(text).toBe("📅 *3 upcoming events added to the Events tab*\n\n⭐ 1 Jan 2027: A\n⭐ 1 Feb 2027: B, Pune\n\nFrom now on, only new events are posted here.");
  });

  it("reads EventsEye rows", () => {
    const html = `<tr><td><a href="f-solar-show-1-1.html"><b>SOLAR &amp; STORAGE SHOW</b><i>Solar and storage trade fair</i></a></td><td>every year</td>
      <td><a href="cy1_trade-shows-pune.html">Pune</a><a href="pl1_trade-shows_pune_1.html">Pune Centre</a></td><td>03/29/2027<br><i>4 days</i></td></tr><tr><td>header</td></tr>`;
    expect(parseEventsEye(html)).toEqual([
      {
        url: "https://www.eventseye.com/fairs/f-solar-show-1-1.html",
        site: "EventsEye",
        name: "SOLAR & STORAGE SHOW",
        description: "Solar and storage trade fair",
        city: "Pune",
        venue: "Pune Centre",
        startDate: "2027-03-29",
        endDate: "2027-04-01",
      },
    ]);
  });

  it("reads TradeIndia fairs, in India only", () => {
    const data = {
      props: {
        list: [
          { fair_name: "Water Expo 2027", fair_date: "Thu, 25 Feb, 2027 - Sat, 27 Feb, 2027", fair_url: "https://wwww.tradeindia.com/tradeshows/1/water.html", city: "Chennai", venue: "Trade Centre", country: "India", fair_categories: [{ category_name: "Machinery" }] },
          { fair_name: "Abroad Expo", fair_date: "Thu, 25 Feb, 2027", fair_url: "https://www.tradeindia.com/tradeshows/2/x.html", country: "China" },
        ],
      },
    };
    const got = parseTradeIndia(`<script id="__NEXT_DATA__" type="application/json">${JSON.stringify(data)}</script>`);
    expect(got.map((g) => [g.name, g.startDate, g.endDate, g.url, g.description])).toEqual([["Water Expo 2027", "2027-02-25", "2027-02-27", "https://www.tradeindia.com/tradeshows/1/water.html", "Machinery"]]);
    expect(parseTradeIndia("<html>changed</html>")).toEqual([]);
  });

  it("reads Eventbrite, in person only", () => {
    const data = {
      search_data: {
        events: {
          results: [
            { name: "Founders meet", url: "https://www.eventbrite.com/e/1?aff=x", start_date: "2027-01-05", end_date: "2027-01-05", primary_venue: { name: "Hall", address: { city: "Mumbai" } } },
            { name: "Webinar", url: "https://www.eventbrite.com/e/2", start_date: "2027-01-05", is_online_event: true },
          ],
        },
      },
    };
    const got = parseEventbrite(`window.__SERVER_DATA__ = ${JSON.stringify(data)};\n`);
    expect(got.map((g) => [g.name, g.url, g.city, g.endDate])).toEqual([["Founders meet", "https://www.eventbrite.com/e/1", "Mumbai", null]]);
  });

  it("keeps listings that are upcoming, in our sectors and not listed twice", () => {
    const item = (name: string, startDate: string, url: string, description = ""): ListingItem => ({ name, startDate, url, description, site: "EventsEye", city: null, venue: null, endDate: null });
    const got = usableListings(
      [
        item("Solar Expo 2027", "2027-03-01", "https://a.example/1"),
        item("Solar Expo", "2027-03-02", "https://b.example/2"),
        item("Battery Show", "2027-01-01", "https://a.example/3"),
        item("Wedding Fair", "2027-01-01", "https://a.example/4"),
        item("Old Solar Fair", "2026-01-01", "https://a.example/5"),
        item("Far Solar Fair", "2030-01-01", "https://a.example/6"),
      ],
      "2026-11-02",
      sectorRegex(STARTER_SECTORS),
      (a, b) => sameEvent(a, b),
    );
    expect(got.map((g) => g.name)).toEqual(["Battery Show", "Solar Expo 2027"]);
  });

  it("matches sector keywords, and short ones only as whole words", () => {
    const re = sectorRegex([{ keywords: ["ev", "batter"] }]);
    expect(re.test("India EV Show")).toBe(true);
    expect(re.test("Battery Expo")).toBe(true);
    expect(re.test("Every Wedding Fair")).toBe(false);
    expect(sectorRegex([]).test("anything")).toBe(false);
  });

  it("only adds a sector with real headlines behind it that the fund could back and we don't already cover", () => {
    const keys = new Set(["H1", "H2", "H3", "H4", "H5"]);
    const p = (name: string, evidence_keys = ["H1", "H2", "H3", "H4"], keywords = ["kw " + name.toLowerCase().slice(0, 6)]) => ({ name, keywords, query: "India show expo", why: "Money is moving.", evidence_keys });
    const existing = [{ name: "Space", keywords: ["space"] }, { name: "Switched off sector", keywords: ["other"] }];
    expect(vetProposals([p("Agri lending")], existing, keys)).toEqual([]);
    expect(vetProposals([p("Real estate tech")], existing, keys)).toEqual([]);
    expect(vetProposals([p("Biofuels", ["H1", "H2", "H3"])], existing, keys)).toEqual([]);
    expect(vetProposals([p("Biofuels", ["H1", "H1", "H1", "H1"])], existing, keys)).toEqual([]);
    expect(vetProposals([p("Biofuels", ["H1", "H2", "H3", "H99"])], existing, keys)).toEqual([]);
    expect(vetProposals([p("Sector for switched things")], existing, keys)).toEqual([]);
    expect(vetProposals([p("Biofuels", undefined, ["space"])], existing, keys)).toEqual([]);
    expect(vetProposals([p("Biofuels", undefined, ["bio.*("])], existing, keys)).toEqual([]);
    expect(vetProposals([p("Biofuels"), p("Quantum sensing"), p("Critical minerals")], existing, keys).map((s) => s.name)).toEqual(["Biofuels", "Quantum sensing"]);
  });

  it("ranks sectors by deals with real headlines, and writes the monthly message", () => {
    const top = rankSectors([{ name: "A", keys: ["H1", "H1"] }, { name: "B", keys: ["H1", "H2"] }, { name: "Made up", keys: ["H9"] }], new Set(["H1", "H2"]));
    expect(top).toEqual([{ name: "B", deals: 2 }, { name: "A", deals: 1 }]);
    expect(fundingText({ summary: "AI led.", top, added: ["Biofuels"] })).toBe(
      "📈 *WHERE THE MONEY WENT*\nLast 30 days of funding headlines\n\nAI led.\n\n• B: 2 deals\n• A: 1 deal\n\n🆕 Now tracking events for: Biofuels. Switch off in the Events tab if not useful.",
    );
  });

  it("scans twice a week, Monday and Thursday from 9 am", () => {
    expect(isScanDue("Mon", 8)).toBe(false);
    expect(isScanDue("Mon", 9)).toBe(true);
    expect(isScanDue("Thu", 9)).toBe(true);
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
