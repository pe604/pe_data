import { describe, expect, it } from "vitest";
import {
  digestText,
  dueSlot,
  googleNewsUrl,
  instantText,
  normaliseLinkedinUrl,
  normaliseWebsite,
  parseGoogleNewsRss,
} from "@/lib/domain/news";

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

  it("writes the instant alert and the clubbed message", () => {
    const k = { company: "Kimbal", summary: "Won a ₹120 Cr smart meter order from MSEDCL.", category: "BIG_ORDER", url: "https://x.test/a" };
    expect(instantText(k)).toBe("*Portfolio news: Kimbal* (Big order)\nWon a ₹120 Cr smart meter order from MSEDCL.\nhttps://x.test/a");
    const d = digestText("2026-10-23", [
      { company: "Mokobara", summary: "Opened a store in Pune.", category: "EXPANSION", url: "https://x.test/b" },
      k,
      { company: "Kimbal", summary: "Launched a new meter.", category: "PRODUCT_LAUNCH", url: "https://x.test/c" },
    ]);
    expect(d.startsWith("*Portfolio news, 23 Oct 2026*")).toBe(true);
    expect(d.indexOf("*Kimbal*")).toBeLessThan(d.indexOf("*Mokobara*"));
    expect(d).toContain("• Launched a new meter. (Product launch)\n  https://x.test/c");
  });
});
