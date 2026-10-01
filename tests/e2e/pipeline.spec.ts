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
  await expect(row(page, a)).toContainText("Added directly");
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
