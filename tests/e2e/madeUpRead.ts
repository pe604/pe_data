// A made-up analyst read (SPEC §17.5) for the E2E fixtures and the POST /api/reads checks. Made-up companies only:
// real reads are confidential and never used in tests.
export function madeUpRead(company: string, o: { overall?: number; theme?: string | null; readAt?: string } = {}) {
  return {
    schema: 1,
    company,
    readAt: o.readAt ?? new Date().toISOString().slice(0, 10),
    thesisLabel: "1.0",
    author: "Test reader",
    deckFile: "made-up-deck.pdf",
    oneLine: "Makes smart meter enclosures for state utilities.",
    overall: { score: o.overall ?? 7, why: "Strong position, held back by thin public numbers.", confidence: "MEDIUM", confidenceWhy: "Half of the claims have outside sources." },
    scores: [
      { key: "POSITION", score: 7.5, why: "One of three approved vendors in its category.", sources: ["s2", "s3"] },
      { key: "MOAT", score: 6, why: "Utility approvals take about two years.", sources: ["s1"] },
      { key: "MARKET", score: 8, why: "A large meter rollout is under way.", sources: ["s3"] },
      { key: "NUMBERS", score: 5, why: "Filings lag the plan by a year.", sources: [] as string[] },
      { key: "THESIS", score: 8.5, why: "Named approvals: proof over claims.", sources: [] as string[] },
    ],
    research: {
      whoElse: [
        { name: "Example Meters Ltd", what: "Meters and enclosures", scale: "About ₹400 Cr revenue", sources: ["s2"] },
        { name: "Sample Enclosures", what: "Enclosures only", scale: "Small", sources: [] as string[] },
      ],
      howHard: [{ text: "Approvals take about two years per utility.", sources: ["s3"], deck: false }],
      rank: [{ text: "Third by volume among approved vendors.", sources: [] as string[], deck: true }],
      market: [{ text: "About 250 million meters are planned nationally.", sources: ["s3"], deck: false }],
      record: [{ text: "Credit rating reaffirmed in 2026.", sources: ["s4"], deck: false }],
    },
    deckVsPublic: [
      { claim: "Approved by two state utilities", found: "Listed on one utility's vendor page", status: "PARTLY", sources: ["s3"] },
      { claim: "Largest in the region", found: "A rival reports higher volumes", status: "CONTRADICTED", sources: ["s2"] },
    ],
    thesis: [
      { code: "PR01", side: "FOR", note: "The approvals are named and dated." },
      { code: "PR02", side: "OPEN", note: "Margins depend on one input." },
    ],
    theme: { code: o.theme === undefined ? "T01" : o.theme, note: "Grid equipment." },
    highlights: [{ code: "H01", state: "SUPPORTED", note: "Approved vendor with small revenue." }],
    flags: [{ label: "Close to listing", value: "Not before 2028", sources: [] as string[] }],
    openQuestions: ["How long is the order book?"],
    notChecked: ["Filings for the latest year were not yet public."],
    sources: [
      { id: "s1", kind: "SUBJECT", publisher: "The company", title: "About us", url: "https://subject.example/about", date: "2026" },
      { id: "s2", kind: "RIVAL", publisher: "Example Meters Ltd", title: "Annual report", url: "https://rival.example/annual-report", date: "2026-03" },
      { id: "s3", kind: "GOVT", publisher: "A state utility", title: "Approved vendors", url: "https://utility.example/vendors", date: "2026-03-14" },
      { id: "s4", kind: "RATING", publisher: "A rating agency", title: "Rating rationale", url: "https://rating.example/r", date: null },
    ],
  };
}
export type MadeUpRead = ReturnType<typeof madeUpRead>;
