import { expect, test } from "@playwright/test";

// Fit rating in the table and the company file (SPEC §17.9, §17.10), on the made-up rating from auth.setup.ts.
// No AI runs here: the rating is a fixture.
const VOLTARIS = "Voltaris Grid Systems";

test("fit: shown in the table, sorted and filtered; the Fit tab; a person's scores move the means", async ({ page }) => {
  await page.goto("/");
  const row = page.locator("tr", { has: page.getByRole("button", { name: VOLTARIS, exact: true }) });
  await expect(row.getByRole("button", { name: `Fit for ${VOLTARIS}: 4.3, 4 of 4 scored` })).toBeVisible();
  await expect(row.getByRole("button", { name: `Promise for ${VOLTARIS}: not rated` })).toBeVisible();
  await expect(row.getByText("Sweet spot (claimed)")).toBeVisible();
  await expect(row.getByText("Priority theme")).toBeVisible();

  // Sort by Fit: the rated deal first; the default sort is untouched.
  await page.getByRole("combobox", { name: "Sort" }).selectOption("fit-high");
  await expect(page.locator("tbody tr").first()).toContainText(VOLTARIS);
  await expect(page).toHaveURL(/sort=fit-high/);

  // Highlights filter: Sweet spot
  await page.getByRole("button", { name: "Highlights" }).click();
  await page.getByRole("checkbox", { name: "Sweet spot" }).check();
  await expect(page.locator("tbody tr")).toHaveCount(1);
  await page.keyboard.press("Escape");

  // The Fit tab
  await row.getByRole("button", { name: /^Fit for / }).click();
  await expect(page.getByRole("tab", { name: "Fit" })).toHaveAttribute("aria-selected", "true");
  const tab = page.locator(".dbody");
  await expect(tab.getByText("Fit 4.3 · 4 of 4")).toBeVisible();
  await expect(tab.getByText("Promise: not enough in the deck · 1 of 2")).toBeVisible();
  await expect(tab.getByText("Ranks fit with the thesis. It is not a recommendation.")).toBeVisible();
  await expect(tab.getByText("Approved vendor to two state utilities since 2022").first()).toBeVisible();
  await expect(tab.getByText("Closest to: Example Co")).toBeVisible();
  await expect(tab.getByText("Fill in after the founder meeting")).toBeVisible();
  await expect(tab.getByText("Revenue ₹ 42 Cr (FY25)")).toBeVisible();
  await expect(tab.getByText("Rated from voltaris-deck.pdf, thesis version 1.0", { exact: false })).toBeVisible();

  // Founder meeting score: Promise appears
  const p4 = tab.locator(".fit-row", { hasText: "Founder execution" });
  await p4.getByRole("button", { name: "Fill in" }).click();
  await p4.getByText("4", { exact: true }).click();
  await p4.getByRole("textbox").fill("Met the founders twice; they shipped what they promised.");
  await p4.getByRole("button", { name: "Save score" }).click();
  await expect(tab.getByText("Promise 3.5 · 2 of 2")).toBeVisible();

  // Change a deck score: Fit moves, the deck reading stays visible
  const f2 = tab.locator(".fit-row", { hasText: "Own plant" });
  await f2.getByRole("button", { name: "Change score" }).click();
  await f2.getByText("5", { exact: true }).click();
  await f2.getByRole("textbox").fill("Visited the plant, it is owned and running.");
  await f2.getByRole("button", { name: "Save score" }).click();
  await expect(tab.getByText("Fit 4.8 · 4 of 4")).toBeVisible();
  await expect(f2.getByText("Deck reading: 3")).toBeVisible();
  await expect(row.getByRole("button", { name: `Fit for ${VOLTARIS}: 4.8, 4 of 4 scored` })).toBeVisible();

  // A reason is required
  await f2.getByRole("button", { name: "Change score" }).click();
  await f2.getByText("4", { exact: true }).click();
  await f2.getByRole("textbox").fill("too short");
  await expect(f2.getByRole("button", { name: "Save score" })).toBeDisabled();
  await f2.getByRole("button", { name: "Cancel" }).click();

  // Remove brings the deck reading back
  await f2.getByRole("button", { name: "Remove" }).click();
  await expect(tab.getByText("Fit 4.3 · 4 of 4")).toBeVisible();

  // Sweet spot checked, with a note
  await tab.getByRole("button", { name: "Mark sweet spot as checked" }).click();
  await tab.getByRole("textbox").fill("Called both utilities' vendor cells.");
  await tab.getByRole("button", { name: "Mark as checked" }).click();
  await expect(tab.getByText("Sweet spot (checked)")).toBeVisible();

  // History records it all
  await page.getByRole("tab", { name: "History" }).click();
  // (History lower-cases a note's first letter after the person's name: "Team fit: …")
  await expect(tab).toContainText(/fit: founder execution set to 4/i);
  await expect(tab).toContainText(/fit: own plant set to 5/i);
  await expect(tab).toContainText(/fit: own plant score removed/i);
  await expect(tab).toContainText(/sweet spot marked as checked/i);
});

test.describe("fit on a phone, in dark mode, by keyboard", () => {
  test.use({ viewport: { width: 390, height: 844 }, colorScheme: "dark" });
  test("no sideways page scroll; the Fit cell opens the Fit tab from the keyboard", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("button", { name: VOLTARIS, exact: true }).first()).toBeVisible();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(0);
    const bg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
    expect(bg).not.toBe("rgb(255, 255, 255)");
    const cell = page.getByRole("button", { name: /^Fit for Voltaris Grid Systems/ });
    await cell.focus();
    await expect(cell).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(page.getByRole("tab", { name: "Fit" })).toHaveAttribute("aria-selected", "true");
    await expect(page.getByText("Ranks fit with the thesis. It is not a recommendation.")).toBeVisible();
    const drawerOverflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(drawerOverflow).toBeLessThanOrEqual(0);
  });
});
