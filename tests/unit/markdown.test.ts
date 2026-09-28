import { describe, expect, it } from "vitest";
import { buildMarkdown, cleanStr, wordCount } from "@/lib/summary/markdown";
import { renderMarkdown } from "@/lib/summary/render";

const full = {
  company: "FreshBus",
  sector: "Mobility & Logistics",
  subSector: "Intercity electric buses",
  round: "Series B",
  advisor: "Avendus",
  location: "Bengaluru",
  deckDate: "May 2026",
  business: ["Runs electric intercity bus routes in South India", "Sells tickets direct and via OTAs"],
  revenueMix: "Ticketing 92%, ancillary 8%.",
  financials: {
    unit: "₹ Cr",
    columns: ["FY24", "FY25", "FY26", "FY27E"],
    rows: [
      { label: "Revenue", values: ["15.9", "23.6", "49.2", "234"] },
      { label: "EBITDA %", values: ["(87%)", "(86%)", "(78%)", "(10%)"] },
    ],
    growth: "76% CAGR actual (FY24–26) vs 132% projected (FY26–31)",
  },
  dealAsk: "Raising ₹250 Cr Series B for fleet expansion.",
  founders: "Sudhakar Chirra (ex-Ola). Existing investors: Shepherd's Hill.",
  customers: "2.1 lakh riders a month.",
  differentiation: "Claims the lowest cost per km among intercity operators.",
  sectorPoints: ["Intercity bus market of ₹60,000 Cr", "Fragmented, mostly diesel"],
  tailwinds: ["FAME subsidies", "Falling battery prices"],
};

describe("buildMarkdown (SPEC §9.4)", () => {
  it("renders every section in order", () => {
    const md = buildMarkdown(full);
    const order = ["## Snapshot", "## Business", "## Revenue mix", "## Financials (₹ Cr)", "## Deal ask", "## Founders & cap table", "## Customers", "## Differentiation (claimed)", "## Sector", "## Tailwinds"];
    let last = -1;
    for (const h of order) {
      const i = md.indexOf(h);
      expect(i, h).toBeGreaterThan(last);
      last = i;
    }
    expect(md).toContain("Round: Series B");
    expect(md).toContain("| Revenue | 15.9 | 23.6 | 49.2 | 234 |");
    expect(md).toContain("Growth: 76% CAGR actual");
    expect(md).toContain("FY27E");
  });

  it("omits empty sections entirely", () => {
    const md = buildMarkdown({ business: ["Makes widgets"], round: null, financials: null, tailwinds: [] });
    expect(md).toBe("## Business\n- Makes widgets");
  });

  it("drops placeholder text like 'not in deck'", () => {
    const md = buildMarkdown({ round: "Not disclosed", advisor: "N/A", location: "not in deck", deckDate: "Mar 2026" });
    expect(md).toBe("## Snapshot\nDeck date: Mar 2026");
  });

  it("skips financials without rows or columns and pads short rows", () => {
    expect(buildMarkdown({ financials: { unit: "₹ Cr", columns: [], rows: [] } })).toBe("");
    const md = buildMarkdown({ financials: { columns: ["FY24", "FY25"], rows: [{ label: "Revenue", values: ["10"] }] } });
    expect(md).toContain("| Revenue | 10 | – |");
  });

  it("limits to 6 columns and 3 rows and escapes pipes", () => {
    const md = buildMarkdown({
      financials: {
        unit: "₹ Cr",
        columns: ["A", "B", "C", "D", "E", "F", "G"],
        rows: [1, 2, 3, 4].map((n) => ({ label: "R" + n, values: ["1|2", "2", "3", "4", "5", "6", "7"] })),
      },
    });
    expect(md).not.toContain("| G");
    expect(md).not.toContain("R4");
    expect(md).toContain("| R1 | 1/2 |");
  });

  it("stays within the word budget for a full summary", () => {
    expect(wordCount(buildMarkdown(full))).toBeLessThan(220);
  });
});

describe("cleanStr", () => {
  it("nulls blanks and placeholders", () => {
    expect(cleanStr("  ")).toBeNull();
    expect(cleanStr("None")).toBeNull();
    expect(cleanStr("Not mentioned.")).toBeNull();
    expect(cleanStr(" Series A ")).toBe("Series A");
    expect(cleanStr(12)).toBeNull();
  });
});

describe("renderMarkdown", () => {
  it("escapes HTML in edited summaries", () => {
    const html = renderMarkdown('## Business\n- <img src=x onerror="alert(1)">');
    expect(html).not.toContain("<img");
    expect(html).toContain("&lt;img");
  });
  it("renders the snapshot grid and tables", () => {
    const html = renderMarkdown(buildMarkdown(full));
    expect(html).toContain('<dl class="snap">');
    expect(html).toContain("<table>");
    expect(html).toContain('<td class="num">15.9</td>');
  });
});
