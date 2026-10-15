import { expect, test } from "@playwright/test";
import path from "node:path";
import { addByName, openCompany, openTab, row, uniq } from "./helpers";

test("add a company with a deck, review, and it appears in Pipeline", async ({ page }) => {
  const name = uniq("Deckco");
  await page.goto("/");
  await page.getByRole("button", { name: "Add company" }).first().click();
  const dlg = page.getByRole("dialog");
  await dlg.locator('input[type="file"]').setInputFiles(path.join(__dirname, "../fixtures/sample-deck.pdf"));
  // Without an AI key the review step opens after the upload; with one, skip the summary.
  const skip = dlg.getByRole("button", { name: "Skip summary and fill in by hand" });
  const review = dlg.getByRole("heading", { name: "Review and add" });
  await expect(skip.and(page.locator(":enabled")).or(review)).toBeVisible();
  if (await skip.isVisible()) await skip.click();
  await expect(review).toBeVisible();
  await dlg.locator("input.inp").first().fill(name);
  await dlg.getByRole("button", { name: "Add to pipeline" }).click();
  const r = row(page, name);
  await expect(r).toBeVisible();
  await expect(r).toContainText("1 file");
  await expect(r.locator(".stage-sel")).toHaveValue("NOT_ASSIGNED");
});

test("change stage and priority inline, and History records it", async ({ page }) => {
  const name = uniq("Inline");
  await page.goto("/");
  await addByName(page, name);
  const r = row(page, name);
  await r.locator(".stage-sel").selectOption("SCUTTLEBUTT");
  await r.locator(".pri-sel").selectOption("2");
  await expect(r.locator(".pri-sel")).toHaveClass(/p2/);
  await page.reload();
  await expect(row(page, name).locator(".stage-sel")).toHaveValue("SCUTTLEBUTT");
  await openCompany(page, name);
  await page.getByRole("tab", { name: "History" }).click();
  await expect(page.locator(".hist")).toContainText("changed Stage from Not Assigned to Scuttlebutt");
  await expect(page.locator(".hist")).toContainText("changed Priority from empty to P2");
});

test("assigning PE moves Not Assigned to Call Pending, and new names can be added", async ({ page }) => {
  const name = uniq("Assign");
  const person = uniq("Newperson").replace(/\s/g, "");
  await page.goto("/");
  await addByName(page, name);
  const r = row(page, name);
  await r.locator("td.c-pe").click();
  const pop = page.locator(".pop");
  const input = pop.getByRole("textbox", { name: "Assigned PE" });
  await input.fill("keyurr");
  await input.press("Enter");
  await input.fill(person.toLowerCase());
  await pop.getByRole("option", { name: new RegExp(`Add .* as a new team member`) }).click();
  await pop.getByRole("button", { name: "Done" }).click();
  await expect(r.locator("td.c-pe")).toContainText("Keyur");
  await expect(r.locator("td.c-pe")).toContainText(person.charAt(0).toUpperCase() + person.slice(1).toLowerCase());
  await expect(r.locator(".stage-sel")).toHaveValue("CALL_PENDING");
});

test("a new PE name joins the PE team bar; PE and Research suggest separate names; Via suggests PE names", async ({ page }) => {
  const name = uniq("Lists");
  const person = "Pe" + uniq("x").replace(/\W/g, "").toLowerCase();
  const display = person.charAt(0).toUpperCase() + person.slice(1);
  await page.goto("/");
  await addByName(page, name);
  const r = row(page, name);
  const pop = page.locator(".pop");
  const bar = page.getByRole("group", { name: "PE team" });

  await r.locator("td.c-pe").click();
  let input = pop.getByRole("textbox", { name: "Assigned PE" });
  await input.fill(person);
  await pop.getByRole("option", { name: /as a new team member/ }).click();
  await pop.getByRole("button", { name: "Done" }).click();
  await expect(bar).toContainText(display);
  await page.reload();
  await expect(page.getByRole("group", { name: "PE team" })).toContainText(display);

  // Research: no PE names, only Research names.
  await row(page, name).locator("td.c-re").click();
  input = pop.getByRole("textbox", { name: "Assigned Research" });
  await input.fill("Ke");
  await expect(pop.getByRole("option", { name: "Keyur", exact: true })).toHaveCount(0);
  await input.fill("Ri");
  await expect(pop.getByRole("option", { name: "Riya", exact: true })).toBeVisible();
  await input.fill("");
  await pop.getByRole("button", { name: "Done" }).click();
  await expect(pop).toHaveCount(0);

  // PE: no Research names. Via: PE names are suggested.
  await row(page, name).locator("td.c-pe").click();
  input = pop.getByRole("textbox", { name: "Assigned PE" });
  await input.fill("Ri");
  await expect(pop.getByRole("option", { name: "Riya", exact: true })).toHaveCount(0);
  await input.fill("");
  await pop.getByRole("button", { name: "Done" }).click();
  await expect(pop).toHaveCount(0);
  // The Via column needs a scroll; popovers close on scroll, so let it settle before clicking.
  const via = row(page, name).locator("td.c-via");
  await via.scrollIntoViewIfNeeded();
  await page.waitForTimeout(300);
  await via.click();
  await pop.getByRole("textbox", { name: "Via" }).fill("Ke");
  await expect(pop.getByRole("option", { name: "Keyur", exact: true })).toBeVisible();
});

test("reject with a reason, days freeze, then restore", async ({ page }) => {
  const name = uniq("Rejectco");
  await page.goto("/");
  await addByName(page, name);
  await openCompany(page, name);
  await page.getByRole("button", { name: "Reject", exact: true }).click();
  const dlg = page.getByRole("dialog");
  await expect(dlg.getByRole("button", { name: "Reject company" })).toBeDisabled();
  await dlg.getByLabel("Reason for rejecting").fill("Too early for us");
  await dlg.getByRole("button", { name: "Reject company" }).click();
  await expect(page.locator(".reject-note")).toContainText("Too early for us");
  await page.keyboard.press("Escape");
  await openTab(page, "Rejected");
  const r = row(page, name);
  await expect(r).toContainText("Too early for us");
  await expect(r.locator(".days")).toHaveClass(/frozen/);
  await openCompany(page, name);
  await page.getByRole("button", { name: "Restore to pipeline" }).click();
  await expect(page.locator(".badge.pipeline")).toBeVisible();
  await page.keyboard.press("Escape");
  await openTab(page, "Pipeline");
  await expect(row(page, name)).toBeVisible();
});

test("change the date received from the drawer; it shows in the table and History", async ({ page }) => {
  const name = uniq("Dateco");
  await page.goto("/");
  await addByName(page, name);
  await openCompany(page, name);
  await page.getByRole("button", { name: /^Received / }).click();
  await page.locator('input[type="date"]').fill("2026-01-15");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByRole("button", { name: "Received 15 Jan 2026" })).toBeVisible();
  await page.getByRole("tab", { name: "History" }).click();
  await expect(page.locator(".drawer.open")).toContainText("Jan 2026");
  await page.keyboard.press("Escape");
  await expect(row(page, name).locator("td.c-date")).toContainText("15 Jan 2026");
});

test("delete a company permanently, with a reason", async ({ page }) => {
  const name = uniq("Deleteco");
  await page.goto("/");
  await addByName(page, name);
  await openCompany(page, name);
  await page.getByRole("button", { name: "Delete", exact: true }).click();
  const dlg = page.getByRole("dialog");
  await expect(dlg.getByRole("button", { name: "Delete permanently" })).toBeDisabled();
  await dlg.getByLabel("Reason for deleting").fill("Duplicate entry");
  await dlg.getByRole("button", { name: "Delete permanently" }).click();
  await expect(page.getByRole("status")).toContainText(`${name} was deleted.`);
  await expect(row(page, name)).toHaveCount(0);
  await page.reload();
  await expect(page.locator("table.grid")).toBeVisible();
  await expect(row(page, name)).toHaveCount(0);
});

test("invest, then undo", async ({ page }) => {
  const name = uniq("Investco");
  await page.goto("/");
  await addByName(page, name);
  await openCompany(page, name);
  await page.getByRole("button", { name: "Invest", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("moved to Invested");
  await expect(page.locator(".badge.invested")).toBeVisible();
  await page.getByRole("status").getByRole("button", { name: "Undo" }).click();
  await expect(page.locator(".badge.pipeline")).toBeVisible();
});

test("bulk add to Invested skips duplicates", async ({ page }) => {
  const a = uniq("Bulkone");
  await page.goto("/");
  await openTab(page, "Invested");
  await page.getByRole("button", { name: "Add company" }).first().click();
  const dlg = page.getByRole("dialog");
  await expect(dlg.getByRole("button", { name: "Add to Invested" }).first()).toHaveAttribute("aria-pressed", "true");
  await dlg.getByText("Add several portfolio companies at once").click();
  await dlg.locator("textarea").fill(`1. ${a}\n- Mokobara Pvt Ltd\n`);
  await dlg.locator("details").getByRole("button", { name: "Add to Invested" }).click();
  await expect(page.getByRole("status")).toContainText("Added 1 to Invested. Skipped 1 already on the dashboard: Mokobara");
  await expect(row(page, a)).toBeVisible();
});

test("Invested tab: rounds and valuation give total invested, current value and MOIC", async ({ page }) => {
  const a = uniq("Portco");
  await page.goto("/");
  await openTab(page, "Invested");
  const head = page.locator("table.grid thead");
  // Names may carry the sort arrow ("Invested↓" is the default sort here).
  await expect(head.getByRole("columnheader", { name: /^Invested/ })).toHaveCount(1);
  // Current value and MOIC live in the company's Investment tab, not the table.
  for (const h of ["Priority", "Stage at exit", "Via", "Current value", "MOIC"]) {
    await expect(head.getByRole("columnheader", { name: new RegExp(`^${h}`) })).toHaveCount(0);
  }
  for (const b of ["Priority", "Stage", "Via"]) await expect(page.locator(".toolbar").getByRole("button", { name: b, exact: true })).toHaveCount(0);

  await page.getByRole("button", { name: "Add company" }).first().click();
  const dlg = page.getByRole("dialog");
  await dlg.getByText("Add several portfolio companies at once").click();
  await dlg.locator("textarea").fill(a);
  await dlg.locator("details").getByRole("button", { name: "Add to Invested" }).click();
  await expect(row(page, a)).toContainText("Add rounds");

  // Round 1: stake suggested from amount and pre-money.
  await row(page, a).locator("td.c-amt").first().click();
  const drawer = page.locator(".drawer.open");
  await expect(drawer.getByRole("tab", { name: /Investment/ })).toHaveAttribute("aria-selected", "true");
  await drawer.getByLabel("Date").fill("2024-06-10");
  await drawer.getByLabel("Round", { exact: true }).fill("Seed");
  await drawer.getByLabel("Amount invested (₹ Cr)").fill("10");
  await drawer.getByLabel("Pre-money valuation (₹ Cr)").fill("190");
  await drawer.getByRole("button", { name: /Use 5% \(amount ÷ post-money\)/ }).click();
  await drawer.getByRole("button", { name: "Add round", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("Round added.");

  // Round 2, no stake.
  await drawer.getByRole("button", { name: "Add round", exact: true }).click();
  await drawer.getByLabel("Date").fill("2025-11-02");
  await drawer.getByLabel("Amount invested (₹ Cr)").fill("5");
  await drawer.locator("form").getByRole("button", { name: "Add round", exact: true }).click();
  await expect(drawer.locator(".inv-sum")).toContainText("₹ 15 Cr");
  await expect(drawer.locator(".inv-sum")).toContainText("2 rounds");

  // Valuation: stake pre-filled from stakes bought (5%).
  await drawer.getByRole("button", { name: "Add valuation" }).click();
  await expect(drawer.getByLabel("Our stake (%)")).toHaveValue("5");
  await drawer.getByLabel("As of").fill("2026-03-31");
  await drawer.getByLabel("Company valuation (₹ Cr)").fill("400");
  await drawer.locator("form").getByRole("button", { name: "Add valuation" }).click();
  await expect(drawer.locator(".inv-sum")).toContainText("₹ 20 Cr");
  await expect(drawer.locator(".inv-sum")).toContainText("1.33x");

  await drawer.getByRole("tab", { name: "History" }).click();
  await expect(page.locator(".hist")).toContainText("added investment Seed: ₹ 10 Cr on 10 Jun 2024");
  await expect(page.locator(".hist")).toContainText("added valuation mark (New round): company ₹ 400 Cr, our stake 5%");
  await page.keyboard.press("Escape");

  const r = row(page, a);
  await expect(r).toContainText("₹ 15 Cr");
  await expect(r).toContainText("2 rounds");
  await expect(r).not.toContainText("1.33x");
  await expect(page.locator(".pf")).toContainText("₹ 15 Cr");
  await expect(page.locator("tfoot .total-row")).toContainText("₹ 15 Cr");

  // Removing a round updates the totals.
  await r.locator("td.c-amt").first().click();
  await drawer.getByRole("row", { name: /2 Nov 2025/ }).getByRole("button", { name: "Remove" }).click();
  await drawer.getByRole("button", { name: "Confirm remove" }).click();
  await expect(drawer.locator(".inv-sum")).toContainText("₹ 10 Cr");
  await expect(drawer.locator(".inv-sum")).toContainText("2.00x");
});

test("bulk add to Rejected with one reason and date, skipping duplicates", async ({ page }) => {
  const a = uniq("Rejone");
  const b = uniq("Rejtwo");
  await page.goto("/");
  await openTab(page, "Rejected");
  await page.getByRole("button", { name: "Add company" }).first().click();
  const dlg = page.getByRole("dialog");
  const box = dlg.locator("details", { hasText: "Add several rejected companies at once" });
  await expect(box).toHaveAttribute("open", "");
  await box.locator("textarea").fill(`1. ${a}\n- ${b}\nVoltaris Grid Systems\n`);
  const add = box.getByRole("button", { name: "Add to Rejected" });
  await expect(add).toBeDisabled();
  await box.getByLabel("Reason for rejecting (applies to all)").fill("Passed in 2025, valuation");
  await box.locator('input[type="date"]').fill("2025-11-20");
  await add.click();
  await expect(page.getByRole("status")).toContainText("Added 2 to Rejected. Skipped 1 already on the dashboard: Voltaris Grid Systems");
  await expect(row(page, a)).toContainText("Passed in 2025, valuation");
  await expect(row(page, b)).toContainText("20 Nov 2025");
});

test("OneDrive link: rejects javascript:, warns for other hosts, saves", async ({ page }) => {
  const name = uniq("Linkco");
  await page.goto("/");
  await addByName(page, name);
  const r = row(page, name);
  await r.getByRole("button", { name: `Add the OneDrive link for ${name}` }).click();
  const pop = page.locator(".pop");
  const input = pop.getByLabel("OneDrive link");
  await input.fill("javascript:alert(1)");
  await pop.getByRole("button", { name: "Save" }).click();
  await expect(pop.locator(".od-warn.bad")).toBeVisible();
  await input.fill("https://example.com/folder");
  await pop.getByRole("button", { name: "Save" }).click();
  await expect(pop.locator(".od-warn")).toContainText("does not look like a OneDrive or SharePoint link");
  await pop.getByRole("button", { name: "Save anyway" }).click();
  const link = r.getByRole("link", { name: `Open the OneDrive folder for ${name}` });
  await expect(link).toHaveAttribute("href", "https://example.com/folder");
  await expect(link).toHaveAttribute("target", "_blank");
});

test("comments and materials in the drawer", async ({ page }) => {
  const name = uniq("Drawerco");
  await page.goto("/");
  await addByName(page, name);
  await openCompany(page, name);
  await page.getByRole("tab", { name: /Comments/ }).click();
  await page.getByLabel("New comment").fill("First call booked");
  await page.locator(".cbox").getByRole("button", { name: "Add comment" }).click();
  await expect(page.locator(".clist")).toContainText("First call booked");
  await page.getByRole("tab", { name: /Materials/ }).click();
  await page.locator(".upl input[type=file]").setInputFiles(path.join(__dirname, "../fixtures/model.csv"));
  await expect(page.locator(".files")).toContainText("model.csv");
  await page.keyboard.press("Escape");
  await expect(row(page, name)).toContainText("First call booked");
  await expect(row(page, name)).toContainText("1 file");
});

test("filters and search update the view and the URL", async ({ page }) => {
  await page.goto("/");
  await page.getByLabel("Search").fill("Voltaris");
  await expect(page.locator("table.grid tbody tr")).toHaveCount(1);
  await expect(page).toHaveURL(/q=Voltaris/);
  await page.getByRole("button", { name: "Clear all" }).click();
  await page.locator(".strip-stages .seg").nth(2).click();
  await expect(page).toHaveURL(/stage=INTERNAL_DISCUSSION/);
});

test("Excel export downloads", async ({ page }) => {
  await page.goto("/");
  const dl = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export to Excel" }).click();
  const d = await dl;
  expect(d.suggestedFilename()).toMatch(/^Niveshaay Deal Pipeline \d{4}-\d{2}-\d{2}\.xlsx$/);
});
