import { expect, test, type Page } from "@playwright/test";
import { madeUpRead } from "./madeUpRead";

// Analyst read (SPEC §17.10, §17.11), on the made-up read from auth.setup.ts. No AI runs here.
const VOLTARIS = "Voltaris Grid Systems";
const FIXED = "Ranks deals after outside research. It is not a recommendation.";
/** The words a read's copy may never use (SPEC §17). Only the fixed line may carry one ("recommendation"). */
const VERDICT = /\b(invest(?!ors?\b)\w*|pass(?:es|ed|ing)?|reject\w*|recommend\w*|buy(?:s|ing)?|bought|avoid\w*)\b/i;

const rowOf = (page: Page, name: string) => page.locator("tr", { has: page.getByRole("button", { name, exact: true }) });

test("read: the column, the sort and the highlights filter", async ({ page }) => {
  await page.goto("/");
  const head = page.locator("table.grid thead");
  await expect(head.getByRole("columnheader", { name: "Read" })).toHaveCount(1);
  await expect(head.getByRole("columnheader", { name: /^(Fit|Promise)$/ })).toHaveCount(0);
  const row = rowOf(page, VOLTARIS);
  await expect(row.getByRole("button", { name: `Read for ${VOLTARIS}: 7.0 out of 10, medium confidence` })).toBeVisible();
  await expect(row.getByText("Sweet spot (supported)")).toBeVisible();
  await expect(row.getByText("Priority theme")).toBeVisible();
  await expect(rowOf(page, "Kestrel Foods").getByRole("button", { name: "Read for Kestrel Foods: no read yet" })).toBeVisible();

  await page.getByRole("combobox", { name: "Sort" }).selectOption("read-high");
  await expect(page.locator("tbody tr").first()).toContainText(VOLTARIS);
  await expect(page).toHaveURL(/sort=read-high/);

  await page.getByRole("button", { name: "Highlights" }).click();
  await page.getByRole("checkbox", { name: "Sweet spot" }).check();
  await expect(page.locator("tbody tr")).toHaveCount(1);
  await page.keyboard.press("Escape");
});

test("read: the Read tab renders a read as text, in order; team scores change the table", async ({ page }) => {
  await page.goto("/");
  const row = rowOf(page, VOLTARIS);
  await row.getByRole("button", { name: /^Read for / }).click();
  await expect(page.getByRole("tab", { name: "Read" })).toHaveAttribute("aria-selected", "true");
  const tab = page.locator(".dbody");
  await expect(tab.locator(".rd-big")).toHaveText("7.0");
  await expect(tab.getByText("Medium confidence")).toBeVisible();
  await expect(tab.getByText(FIXED)).toBeVisible();
  await expect(tab.getByText("Makes smart meter enclosures for state utilities.")).toBeVisible();
  for (const h of ["Scores", "Who else does this", "How hard is it", "Where it ranks", "Market", "Public record", "Deck against the public record", "Against the thesis", "Things to know", "Questions for the founder", "Not checked", "Sources"]) {
    await expect(tab.getByRole("heading", { name: h, exact: true })).toBeVisible();
  }
  // The headings come in the order of SPEC §17.10.
  const order = await tab.locator("h3.sec-title").allTextContents();
  expect(order.slice(0, 5)).toEqual(["Scores", "Who else does this", "How hard is it", "Where it ranks", "Market"]);
  await expect(tab.getByText("What stops a well-funded rival, and what outside the deck shows it?")).toBeVisible();
  await expect(tab.getByText("From the deck")).toBeVisible();
  await expect(tab.getByText("Contradicted")).toBeVisible();
  await expect(tab.getByText("Test principle about proof over claims.")).toBeVisible();
  await expect(tab.getByText("Read by Test reader on", { exact: false })).toBeVisible();
  // Source links: validated, new tab, no opener
  const link = tab.getByRole("link", { name: "Annual report" });
  await expect(link).toHaveAttribute("href", "https://rival.example/annual-report");
  await expect(link).toHaveAttribute("target", "_blank");
  await expect(link).toHaveAttribute("rel", "noopener noreferrer");
  await expect(tab.getByRole("link", { name: /^Source 2:/ }).first()).toHaveAttribute("rel", "noopener noreferrer");

  // No verdict words in the rendered copy, except the fixed line.
  const copy = (await tab.innerText()).replace(FIXED, "");
  expect(copy).not.toMatch(VERDICT);

  // Team score on the overall: the table follows it; Remove restores the read's.
  await tab.getByRole("button", { name: "Team score for overall" }).click();
  const form = tab.getByRole("form", { name: "Team score for overall" });
  await form.getByRole("combobox").selectOption("8.5");
  await form.getByRole("textbox").fill("too short");
  await expect(form.getByRole("button", { name: "Save score" })).toBeDisabled();
  await form.getByRole("textbox").fill("Met both utilities' vendor cells.");
  await form.getByRole("button", { name: "Save score" }).click();
  await expect(tab.locator(".rd-big")).toHaveText("8.5");
  await expect(tab.getByText("Team 8.5 · Read 7", { exact: false }).first()).toBeVisible();
  await expect(row.getByRole("button", { name: `Read for ${VOLTARIS}: 8.5 out of 10, team score, medium confidence` })).toBeVisible();

  // Team score on one of the five
  await tab.getByRole("button", { name: "Team score for moat" }).click();
  const moat = tab.getByRole("form", { name: "Team score for moat" });
  await moat.getByRole("combobox").selectOption("8");
  await moat.getByRole("textbox").fill("Visited the plant, approvals seen.");
  await moat.getByRole("button", { name: "Save score" }).click();
  await expect(tab.getByText("Team 8 · Read 6", { exact: false })).toBeVisible();

  // Sweet spot checked, with a note
  await tab.getByRole("button", { name: "Mark sweet spot as checked" }).click();
  await tab.getByRole("textbox").fill("Called both utilities' vendor cells.");
  await tab.getByRole("button", { name: "Mark as checked" }).click();
  await expect(tab.getByText("Sweet spot (checked)")).toBeVisible();
  await expect(row.getByText("Sweet spot (checked)")).toBeVisible();

  // History records it all
  await page.getByRole("tab", { name: "History" }).click();
  await expect(tab).toContainText(/read: overall set to 8\.5/i);
  await expect(tab).toContainText(/read: moat set to 8/i);
  await expect(tab).toContainText(/sweet spot marked as checked/i);

  // Remove both team scores: the read's scores stand again (other specs expect 7.0)
  await page.getByRole("tab", { name: "Read" }).click();
  for (const name of ["overall", "moat"]) {
    await tab.locator(".rd-team", { has: page.getByRole("button", { name: `Team score for ${name}` }) }).getByRole("button", { name: "Remove" }).click();
  }
  await expect(tab.locator(".rd-big")).toHaveText("7.0");
  await expect(row.getByRole("button", { name: `Read for ${VOLTARIS}: 7.0 out of 10, medium confidence` })).toBeVisible();
});

test("read: POST /api/reads refuses a read for each code check, and checks where it came from", async ({ page, baseURL }) => {
  await page.goto("/");
  const origin = new URL(baseURL ?? "http://127.0.0.1:3100").origin;
  const post = (data: unknown, headers: Record<string, string> = { Origin: origin, "Content-Type": "application/json" }) => page.request.post("/api/reads", { data: JSON.stringify(data), headers });
  type Result = { company: string | null; ok: boolean; reasons?: { code: string }[] };
  const refused = async (data: unknown): Promise<string[]> => {
    const res = await post(data);
    expect(res.status()).toBe(200);
    const r = ((await res.json()) as { results: Result[] }).results[0];
    expect(r?.ok).toBe(false);
    return (r?.reasons ?? []).map((x) => x.code);
  };
  const base = () => madeUpRead("Voltaris Grid Systems");
  type R = ReturnType<typeof base>;
  const edit = (f: (r: R) => void) => {
    const r = base();
    f(r);
    return r;
  };

  expect(await refused(edit((r) => (r.scores[1].score = 6.3)))).toContain("HALF_POINTS");
  expect(await refused(edit((r) => r.scores.reverse()))).toContain("SCORE_KEYS");
  expect(await refused(edit((r) => (r.overall.score = 9.5)))).toContain("OVERALL_RANGE");
  expect(await refused(edit((r) => (r.scores[1] = { ...r.scores[1], score: 7, sources: ["s1"] })))).toContain("NEEDS_OUTSIDE_SOURCE");
  expect(await refused(edit((r) => (r.flags[0].sources = ["s99"])))).toContain("UNKNOWN_SOURCE");
  expect(await refused(edit((r) => (r.sources[0].url = "javascript:alert(1)")))).toContain("BAD_URL");
  expect(await refused(edit((r) => (r.notChecked = [])))).toContain("NOT_CHECKED_EMPTY");
  expect(await refused(edit((r) => (r.oneLine = "We recommend a closer look.")))).toContain("BANNED_WORD");
  expect(await refused(edit((r) => (r.openQuestions = ["When — and how?"])))).toContain("EM_DASH");
  expect(await refused(edit((r) => (r.thesis[0].code = "PR99")))).toContain("UNKNOWN_PRINCIPLE");
  expect(await refused(edit((r) => (r.theme.code = "T03")))).toContain("UNKNOWN_THEME"); // cross-sector
  expect(await refused({ ...base(), extra: true })).toContain("SHAPE");
  expect(await refused(madeUpRead("No Such Company Pvt Ltd"))).toContain("NO_COMPANY");
  expect(await refused(madeUpRead("Mokobara"))).toContain("NO_COMPANY"); // Invested: reads are for Pipeline and Rejected

  // A list: one result per read, a refused one does not stop the other
  const res = await post([edit((r) => (r.notChecked = [])), madeUpRead("No Such Company Pvt Ltd")]);
  expect(((await res.json()) as { results: Result[] }).results.map((r) => r.ok)).toEqual([false, false]);

  // Same origin and JSON only
  expect((await post(base(), { "Content-Type": "application/json" })).status()).toBe(403);
  expect((await post(base(), { Origin: "https://elsewhere.example", "Content-Type": "application/json" })).status()).toBe(403);
  expect((await post(base(), { Origin: origin, "Content-Type": "text/plain" })).status()).toBe(415);

  // Nothing was loaded: the table still shows the fixture's read
  await page.reload();
  await expect(rowOf(page, VOLTARIS).getByRole("button", { name: `Read for ${VOLTARIS}: 7.0 out of 10, medium confidence` })).toBeVisible();
});

test("read: the waiting list, and Load a read from a file", async ({ page }) => {
  await page.goto("/?view=thesis");
  // Other specs may add pipeline deals with decks, so the count is read, not assumed.
  const chip = page.getByRole("tab", { name: /^Waiting for a read \d+$/ });
  await expect(chip).toBeVisible();
  const before = Number(/(\d+)\s*$/.exec((await chip.textContent()) ?? "")?.[1]);
  expect(before).toBeGreaterThanOrEqual(1);
  await chip.click();
  const list = page.getByRole("region", { name: "Waiting for a read" });
  await expect(list).toContainText("Kestrel Foods");
  await expect(list).toContainText("No read yet");
  await expect(list).not.toContainText(VOLTARIS); // no deck uploaded, and its read is current

  const file = { name: "kestrel.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(madeUpRead("Kestrel Foods", { overall: 6, theme: "T02" }))) };
  await list.locator('input[type="file"]').setInputFiles(file);
  await expect(list.getByRole("status", { name: "Load results" })).toContainText("Kestrel Foods: loaded");
  await expect(page.getByRole("tab", { name: `Waiting for a read ${before - 1}` })).toBeVisible();
  await expect(list.getByRole("button", { name: "Kestrel Foods" })).toHaveCount(0);

  // The same file again is stored once and still loads
  await list.locator('input[type="file"]').setInputFiles(file);
  await expect(list.getByRole("status", { name: "Load results" })).toContainText("Kestrel Foods: loaded");

  // The table shows it, and the read set the theme (no person had set one)
  await page.goto("/");
  const row = rowOf(page, "Kestrel Foods");
  await expect(row.getByRole("button", { name: "Read for Kestrel Foods: 6.0 out of 10, medium confidence" })).toBeVisible();
  await row.getByRole("button", { name: /^Read for / }).click();
  await expect(page.locator(".dbody").getByRole("button", { name: "Snacks test" })).toBeVisible();
  await page.getByRole("tab", { name: "History" }).click();
  await expect(page.locator(".dbody")).toContainText(/read loaded: 6\.0 out of 10/i);
});

test.describe("read on a phone, in dark mode, by keyboard", () => {
  test.use({ viewport: { width: 390, height: 844 }, colorScheme: "dark" });
  test("no sideways page scroll; the Read cell opens the Read tab from the keyboard", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("button", { name: VOLTARIS, exact: true }).first()).toBeVisible();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(0);
    const bg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
    expect(bg).not.toBe("rgb(255, 255, 255)");
    const cell = page.getByRole("button", { name: /^Read for Voltaris Grid Systems/ });
    await cell.focus();
    await expect(cell).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(page.getByRole("tab", { name: "Read" })).toHaveAttribute("aria-selected", "true");
    await expect(page.getByText(FIXED)).toBeVisible();
    await page.getByRole("heading", { name: "Sources", exact: true }).scrollIntoViewIfNeeded();
    const drawerOverflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(drawerOverflow).toBeLessThanOrEqual(0);
    const panel = await page.locator(".dbody").evaluate((el) => el.scrollWidth - el.clientWidth);
    expect(panel).toBeLessThanOrEqual(0);
  });
});
