import { describe, expect, it } from "vitest";
import { dueSlot, googleNewsUrl, isShortCode, newsText, normaliseLinkedinUrl, normaliseWebsite, parseGoogleNewsRss, shortCode } from "@/lib/domain/news";

const RSS = `<?xml version="1.0" encoding="UTF-8"?><rss version="2.0"><channel><title>x</title>
<item><title>Kimbal wins &#8377;120 crore smart meter order from MSEDCL - The Economic Times</title>
<link>https://news.google.com/rss/articles/CBMiabc?oc=5</link><guid isPermaLink="false">CBMiabc</guid>
<pubDate>Fri, 23 Oct 2026 09:30:00 GMT</pubDate>
<description>&lt;a href="https://news.google.com/rss/articles/CBMiabc?oc=5"&gt;Kimbal wins order&lt;/a&gt;&amp;nbsp;&amp;nbsp;&lt;font color="#6f6f6f"&gt;The Economic Times&lt;/font&gt;</description>
<source url="https://economictimes.indiatimes.com">The Economic Times</source></item>
<item><title><![CDATA[Smallcase & partners launch new product - Mint]]></title><link>https://news.google.com/rss/articles/CBMixyz</link>
<pubDate>not a date</pubDate><source url="https://www.livemint.com">Mint</source></item>
<item><title>No link here</title></item>
</channel></rss>`;

describe("news agent helpers (SPEC §15.10)", () => {
  it("parses Google News RSS: title without the outlet, link, date, outlet, snippet", () => {
    const items = parseGoogleNewsRss(RSS);
    expect(items).toHaveLength(2);
    expect(items[0]).toMatchObject({
      title: "Kimbal wins ₹120 crore smart meter order from MSEDCL",
      url: "https://news.google.com/rss/articles/CBMiabc?oc=5",
      publishedAt: "2026-10-23T09:30:00.000Z",
      outlet: "The Economic Times",
    });
    expect(items[0].text).toContain("Kimbal wins order");
    expect(items[0].text).not.toContain("<");
    expect(items[1]).toMatchObject({ title: "Smallcase & partners launch new product", outlet: "Mint", publishedAt: null });
  });

  it("builds a Google News search for any of the names, India edition", () => {
    const u = new URL(googleNewsUrl(["Kimbal", ' Kimbal "Technologies" '], 2));
    expect(u.searchParams.get("q")).toBe('"Kimbal" OR "Kimbal Technologies" when:2d');
    expect(u.searchParams.get("gl")).toBe("IN");
  });

  it("normalises LinkedIn company pages and websites", () => {
    expect(normaliseLinkedinUrl("linkedin.com/company/Kimbal/posts/?feedView=all")).toBe("https://www.linkedin.com/company/kimbal");
    expect(normaliseLinkedinUrl("https://in.linkedin.com/company/smallcase")).toBe("https://www.linkedin.com/company/smallcase");
    expect(normaliseLinkedinUrl("https://www.linkedin.com/in/someone")).toBeNull();
    expect(normaliseWebsite("www.kimbal.io/about")).toBe("https://kimbal.io");
    expect(normaliseWebsite("not a site")).toBeNull();
  });

  it("runs the latest due check slot", () => {
    expect(dueSlot(7)).toBeNull();
    expect(dueSlot(8)).toBe(8);
    expect(dueSlot(15)).toBe(12);
    expect(dueSlot(23)).toBe(20);
  });

  it("writes one message per item, with Big news for high importance and the short link", () => {
    const base = { company: "Kimbal", summary: "Won a ₹120 Cr smart meter order from MSEDCL.", category: "BIG_ORDER", link: "https://pe.test/n/Ab3xK9q", date: "2026-10-23" };
    expect(newsText({ ...base, importance: "high" })).toBe(
      "*Big news: Kimbal* (Big order)\nWon a ₹120 Cr smart meter order from MSEDCL.\n23 Oct 2026\nhttps://pe.test/n/Ab3xK9q",
    );
    expect(newsText({ ...base, importance: "medium", date: null })).toBe(
      "*Portfolio news: Kimbal* (Big order)\nWon a ₹120 Cr smart meter order from MSEDCL.\nhttps://pe.test/n/Ab3xK9q",
    );
  });

  it("makes 7-character short link codes", () => {
    // Each byte picks a character mod 62: 0→"0", 61→"Z", 62→"0", 255→"7", 10→"a", 36→"A", 7→"7".
    const c = shortCode(new Uint8Array([0, 61, 62, 255, 10, 36, 7]));
    expect(c).toBe("0Z07aA7");
    expect(isShortCode(c)).toBe(true);
    expect(isShortCode("abc")).toBe(false);
    expect(isShortCode("abc/def")).toBe(false);
  });
});
