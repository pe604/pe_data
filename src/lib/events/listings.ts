import "server-only";
import { EVENTBRITE_PAGES, EVENTSEYE_PAGES, parseEventbrite, parseEventsEye, parseTradeIndia, TRADEINDIA_PAGES, type ListingItem } from "@/lib/domain/eventListings";

// Reads event listing sites (SPEC §15.14): free, a page at a time with a pause. Logs counts and error codes only.

const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function page(url: string): Promise<string | null> {
  const res = await fetch(url, {
    headers: { "User-Agent": "Mozilla/5.0 (compatible; NiveshaayPipeline/1.0)", Accept: "text/html" },
    signal: AbortSignal.timeout(25_000),
  });
  return res.ok ? res.text() : null; // EventsEye answers 404 past its last page
}

async function read(site: string, urls: readonly string[], parse: (html: string) => ListingItem[], stopAtGap: boolean): Promise<ListingItem[]> {
  const out: ListingItem[] = [];
  for (const u of urls) {
    try {
      const html = await page(u);
      if (html === null && stopAtGap) break;
      if (html) out.push(...parse(html));
    } catch (e) {
      console.error("[events] listing failed", site, (e as Error).name);
    }
    await pause(1500);
  }
  console.log(`[events] ${site}: ${out.length} listed`);
  return out;
}

export async function fetchListings(): Promise<ListingItem[]> {
  const [eye, trade, brite] = await Promise.all([
    read("EventsEye", EVENTSEYE_PAGES, parseEventsEye, true),
    read("TradeIndia", TRADEINDIA_PAGES, parseTradeIndia, false),
    read("Eventbrite", EVENTBRITE_PAGES, parseEventbrite, false),
  ]);
  return [...eye, ...trade, ...brite];
}
