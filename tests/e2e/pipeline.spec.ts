import { expect, test } from "@playwright/test";
import path from "node:path";
import { addByName, openCompany, openTab, row, uniq } from "./helpers";
import { addDays, todayISO } from "../../src/lib/domain/dates";
import { lastEndedQuarter, quarterLabel } from "../../src/lib/domain/quarters";
import ExcelJS from "exceljs";

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

test("Invested tab: rounds with fund give total invested with a Hedgehogs / Sambhav split", async ({ page }) => {
  const a = uniq("Portco");
  await page.goto("/");
  await openTab(page, "Invested");
  const head = page.locator("table.grid thead");
  await expect(head.getByRole("columnheader", { name: /^Invested/ })).toHaveCount(1);
  for (const h of ["Priority", "Stage at exit", "Via", "Current value", "MOIC"]) {
    await expect(head.getByRole("columnheader", { name: new RegExp(`^${h}`) })).toHaveCount(0);
  }
  await expect(page.locator(".pf-line")).not.toContainText("MOIC");

  await page.getByRole("button", { name: "Add company" }).first().click();
  const dlg = page.getByRole("dialog");
  await dlg.getByText("Add several portfolio companies at once").click();
  await dlg.locator("textarea").fill(a);
  await dlg.locator("details").getByRole("button", { name: "Add to Invested" }).click();
  await expect(row(page, a)).toContainText("Add rounds");

  await row(page, a).locator("td.c-amt").first().click();
  const drawer = page.locator(".drawer.open");
  await expect(drawer.getByRole("tab", { name: /Overview/ })).toHaveAttribute("aria-selected", "true");
  await expect(drawer.getByRole("heading", { name: "Valuation" })).toHaveCount(0);

  // Round 1: fund is required; stake suggested from amount and pre-money.
  let form = drawer.getByRole("form", { name: "Add round" });
  await form.getByLabel("Date").fill("2024-06-10");
  await form.getByLabel("Round", { exact: true }).fill("Seed");
  await form.getByLabel("Amount invested (₹ Cr)").fill("10");
  await form.getByLabel("Pre-money valuation (₹ Cr)").fill("190");
  await expect(form.getByRole("button", { name: "Add round" })).toBeDisabled();
  await form.getByLabel("Fund").selectOption("Hedgehogs");
  await form.getByRole("button", { name: /Use 5% \(amount ÷ post-money\)/ }).click();
  await form.getByRole("button", { name: "Add round" }).click();
  await expect(page.getByRole("status")).toContainText("Round added.");

  // Round 2 from the other fund.
  await drawer.getByRole("button", { name: "Add round", exact: true }).click();
  form = drawer.getByRole("form", { name: "Add round" });
  await form.getByLabel("Fund").selectOption("Sambhav");
  await form.getByLabel("Date").fill("2025-11-02");
  await form.getByLabel("Amount invested (₹ Cr)").fill("5");
  await form.getByRole("button", { name: "Add round" }).click();
  await expect(drawer.locator(".inv-sum")).toContainText("₹ 15 Cr");
  await expect(drawer.locator(".inv-sum")).toContainText("Hedgehogs ₹ 10 Cr · Sambhav ₹ 5 Cr");

  await drawer.getByRole("tab", { name: "History" }).click();
  await expect(page.locator(".hist")).toContainText("added investment Seed (Hedgehogs): ₹ 10 Cr on 10 Jun 2024");
  await page.keyboard.press("Escape");

  const r = row(page, a);
  await expect(r.locator("td.c-amt")).toContainText("₹ 15 Cr");
  await expect(r.locator("td.c-amt")).toContainText("Hedgehogs ₹ 10 Cr · Sambhav ₹ 5 Cr");
  await expect(page.locator(".pf-line")).toContainText("Hedgehogs");
  await expect(page.locator("tfoot .total-row")).toContainText("₹ 15 Cr");

  // Removing a round updates the totals.
  await r.locator("td.c-amt").first().click();
  await drawer.getByRole("row", { name: /2 Nov 2025/ }).getByRole("button", { name: "Remove" }).click();
  await drawer.getByRole("button", { name: "Confirm remove" }).click();
  await expect(drawer.locator(".inv-sum")).toContainText("₹ 10 Cr");
  await expect(drawer.locator(".inv-sum")).not.toContainText("Sambhav");
});
test("bulk add to Rejected with one reason and date, skipping duplicates", async ({ page }) => {
  const a = uniq("Rejone");
  const b = uniq("Rejtwo");
  await page.goto("/");
  await openTab(page, "Rejected");
  await expect(page.getByRole("combobox", { name: "Sort" })).toHaveValue("rejected-old");
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

test("quarterly tracker: upload MIS and result note from the table, view them in the company file; contacts show as POC", async ({ page }) => {
  await page.goto("/");
  await openTab(page, "Invested");

  // Contacts on Mokobara: the first is primary and shows as POC.
  await page.getByRole("button", { name: "Mokobara", exact: true }).click();
  const drawer = page.locator(".drawer.open");
  await drawer.getByRole("tab", { name: /Overview/ }).click();
  await drawer.getByRole("button", { name: "Add contact" }).click();
  let cf = drawer.getByRole("form", { name: "Add contact" });
  await cf.getByLabel("Name").fill("Priya Shah");
  await cf.getByLabel("Designation").fill("CFO");
  await cf.getByLabel("Email").fill("not-an-email");
  await expect(cf.getByRole("button", { name: "Add contact" })).toBeDisabled();
  await cf.getByLabel("Email").fill("priya@example.com");
  await cf.getByRole("button", { name: "Add contact" }).click();
  await expect(drawer.locator(".contacts")).toContainText("Priya Shah");
  await expect(drawer.locator(".contacts")).toContainText("Primary");
  await drawer.getByRole("button", { name: "Add contact" }).click();
  cf = drawer.getByRole("form", { name: "Add contact" });
  await cf.getByLabel("Name").fill("Rahul Mehta");
  await cf.getByRole("button", { name: "Add contact" }).click();
  await expect(drawer.locator(".contacts li")).toHaveCount(2);
  await page.keyboard.press("Escape");

  await page.getByRole("tab", { name: "Quarterly tracker" }).click();
  const head = page.locator("table.qgrid thead");
  for (const h of ["Result update", "Quarterly calls", "Shared with BDO"]) await expect(head).not.toContainText(h);
  const tr = page.locator("table.qgrid tbody tr", { hasText: "Mokobara" });
  await expect(tr.locator("td").nth(2)).toHaveText("Priya Shah");

  // MIS: upload from the cell; it ticks with the date.
  const mis = page.getByRole("button", { name: "MIS received for Mokobara" });
  await expect(mis).toContainText("Upload");
  await mis.click();
  const pop = page.locator(".pop");
  await pop.locator('input[aria-label="Upload MIS file"]').setInputFiles({
    name: "mokobara-mis.pdf",
    mimeType: "application/pdf",
    buffer: Buffer.from("%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF"),
  });
  await expect(page.getByRole("status").first()).toContainText("MIS for");
  await expect(mis).toContainText("✓");
  await expect(pop).toContainText("mokobara-mis.pdf");
  await expect(pop.getByRole("button", { name: "View" })).toBeVisible();
  await expect(pop.getByRole("button", { name: "Download" })).toBeVisible();
  await pop.getByRole("button", { name: "Close" }).click();
  await expect(page.locator(".q-progress")).toContainText("MIS received: 1/");

  // Result note: "Not made" until a file is uploaded.
  const note = page.getByRole("button", { name: "Result note for Mokobara" });
  await expect(note).toContainText("Not made");
  await note.click();
  await page.locator(".pop").locator('input[aria-label="Upload result note file"]').setInputFiles({
    name: "mokobara-result-note.pdf",
    mimeType: "application/pdf",
    buffer: Buffer.from("%PDF-1.4\n%%EOF"),
  });
  await expect(note).toContainText("✓ Made");
  await page.locator(".pop").getByRole("button", { name: "Close" }).click();

  // Remarks (far-right column: scroll first, popovers close on scroll).
  const remarks = page.getByRole("button", { name: "Remarks for Mokobara" });
  await remarks.scrollIntoViewIfNeeded();
  await page.waitForTimeout(300);
  await remarks.click();
  await page.locator(".pop").getByLabel("Remarks").fill("Raghav will visit this month");
  await page.locator(".pop").getByRole("button", { name: "Save" }).click();
  await expect(remarks).toHaveText("Raghav will visit this month");

  // MIS due date is editable.
  await page.getByRole("button", { name: /MIS due .*\(default\) · Edit/ }).click();
  await page.locator(".pop").getByLabel("Date").fill("2030-01-31");
  await page.locator(".pop").getByRole("button", { name: "Save" }).click();
  await expect(page.getByRole("button", { name: /MIS due 31 Jan 2030 · Edit/ })).toBeVisible();

  // Company file: both files listed under the quarter, viewable and downloadable.
  await page.getByRole("button", { name: "Mokobara", exact: true }).click();
  await expect(drawer.getByRole("tab", { name: /MIS & results/ })).toHaveAttribute("aria-selected", "true");
  const q = drawer.locator(".qfiles-q").first();
  await expect(q).toContainText(quarterLabel(lastEndedQuarter(todayISO())));
  await expect(q).toContainText("mokobara-mis.pdf");
  await expect(q).toContainText("mokobara-result-note.pdf");
  await q.getByRole("button", { name: "View" }).first().click();
  await expect(page.locator(".pdf-frame")).toBeVisible();
  await page.keyboard.press("Escape");
  await drawer.getByRole("tab", { name: "History" }).click();
  await expect(page.locator(".hist")).toContainText("uploaded mokobara-mis.pdf (MIS,");
  await expect(page.locator(".hist")).toContainText("added contact Priya Shah (CFO)");
});

test("meetings: plan, mark done, listed in the Meetings view and the company file", async ({ page }) => {
  const today = todayISO();
  const yesterday = addDays(today, -1);
  await page.goto("/");
  await openTab(page, "Invested");
  await page.getByRole("tab", { name: "Meetings" }).click();
  for (const [date, type] of [[today, "Plant visit"], [yesterday, "Management meeting"]] as const) {
    await page.getByRole("button", { name: "Add meeting" }).click();
    const form = page.getByRole("form", { name: "Add meeting" });
    await form.getByLabel("Company").selectOption({ label: "Mokobara" });
    await form.getByLabel("Meeting date").fill(date);
    await form.getByLabel("Type").selectOption(type);
    const who = form.getByRole("textbox", { name: "Who is going" });
    await who.fill("Keyur");
    await who.press("Enter");
    await who.press("Escape");
    await form.getByRole("button", { name: "Add meeting" }).click();
    await expect(page.getByRole("status")).toContainText("Meeting planned.");
  }
  const needs = page.locator(".mtg-group", { hasText: "Needs updating" });
  await expect(needs).toContainText("Not marked done");
  await needs.getByRole("button", { name: "Mark done" }).click();
  const edit = page.getByRole("form", { name: "Edit meeting" });
  await expect(edit.getByLabel("Status")).toHaveValue("DONE");
  await edit.getByLabel("Notes and next steps").fill("Met the CFO, Q2 numbers due next week");
  await edit.getByRole("button", { name: "Save meeting" }).click();
  await expect(page.locator(".mtg-group", { hasText: "Past" })).toContainText("Met the CFO");
  await page.locator(".mtg-group", { hasText: "Past" }).getByRole("button", { name: "Mokobara" }).click();
  const drawer = page.locator(".drawer.open");
  await expect(drawer.getByRole("tab", { name: /Meetings/ })).toHaveAttribute("aria-selected", "true");
  await expect(drawer).toContainText("Met the CFO");
});

test("MIS figures: upload from the company file, enter figures (AI off in tests), see the financials table", async ({ page }) => {
  const a = uniq("Misco");
  await page.goto("/");
  await openTab(page, "Invested");
  await page.getByRole("button", { name: "Add company" }).first().click();
  const dlg = page.getByRole("dialog");
  await dlg.getByText("Add several portfolio companies at once").click();
  await dlg.locator("textarea").fill(a);
  await dlg.locator("details").getByRole("button", { name: "Add to Invested" }).click();
  await row(page, a).locator("td.c-amt").first().click();
  const drawer = page.locator(".drawer.open");
  await drawer.getByRole("tab", { name: /MIS & results/ }).click();
  await expect(drawer.getByRole("heading", { name: "Quarterly MIS and results" })).toBeVisible();

  const wb = new ExcelJS.Workbook();
  wb.addWorksheet("P&L").addRow(["Revenue", 410.2, 431.8, 455.6]);
  const buffer = Buffer.from(await wb.xlsx.writeBuffer());
  const q = quarterLabel(lastEndedQuarter(todayISO()));
  await drawer.locator('input[aria-label="MIS file"]').setInputFiles({
    name: "mis.xlsx",
    mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    buffer,
  });
  const form = drawer.getByRole("form", { name: "MIS figures" });
  await expect(form).toContainText("AI reading is not set up");
  await form.getByLabel(/^Revenue/).fill("12.98");
  await form.getByLabel(/^EBITDA/).fill("1.22");
  await form.getByLabel(/^PAT/).fill("(0.5)");
  await form.getByLabel(/^Cash and bank/).fill("5.89");
  await expect(form).toContainText("EBITDA margin 9.4%");
  await form.getByRole("button", { name: "Save figures" }).click();
  await expect(page.getByRole("status").first()).toContainText(`${q} figures saved.`);
  const table = drawer.locator(".mis-table");
  await expect(table).toContainText("12.98");
  await expect(table).toContainText("(0.5)");
  await expect(table).toContainText("9.4%");
  await expect(drawer.locator(".qfiles-q").first()).toContainText("mis.xlsx");
  await page.keyboard.press("Escape");

  // The MIS uploaded from the company file ticks the tracker for that quarter.
  await page.getByRole("tab", { name: "Quarterly tracker" }).click();
  await expect(page.getByRole("button", { name: `MIS received for ${a}` })).toContainText("✓");
});

test("company updates replace the comment column on Invested; sector allocation pie drills into companies", async ({ page }) => {
  const a = uniq("Updco");
  await page.goto("/");
  await openTab(page, "Invested");
  const head = page.locator("table.grid thead");
  await expect(head.getByRole("columnheader", { name: "Latest update" })).toHaveCount(1);
  await expect(head.getByRole("columnheader", { name: "Comment" })).toHaveCount(0);

  await page.getByRole("button", { name: "Add company" }).first().click();
  const dlg = page.getByRole("dialog");
  await dlg.getByText("Add several portfolio companies at once").click();
  await dlg.locator("textarea").fill(a);
  await dlg.locator("details").getByRole("button", { name: "Add to Invested" }).click();

  // Update from the table cell.
  await expect(row(page, a).locator("td.c-cm")).toContainText("Add update");
  await row(page, a).locator("td.c-cm").click();
  const drawer = page.locator(".drawer.open");
  await expect(drawer.getByRole("tab", { name: /Updates/ })).toHaveAttribute("aria-selected", "true");
  await drawer.getByRole("button", { name: "Add update" }).click();
  const form = drawer.getByRole("form", { name: "Add update" });
  await form.getByLabel("New update").fill("Raised ₹40 Cr Series B led by X");
  await form.getByLabel("Update date").fill("2026-09-15");
  await form.getByRole("button", { name: "Add update" }).click();
  await expect(drawer.locator(".updates")).toContainText("Raised ₹40 Cr Series B led by X");
  await expect(form).toHaveCount(0);
  await drawer.getByRole("button", { name: "Add update" }).click();
  await form.getByLabel("New update").fill("New plant in Hosur commissioned");
  await form.getByRole("button", { name: "Add update" }).click();
  await expect(drawer.locator(".updates li").first()).toContainText("New plant in Hosur commissioned");

  // A round so the company shows in the allocation pie.
  await drawer.getByRole("tab", { name: /Overview/ }).click();
  const rf = drawer.getByRole("form", { name: "Add round" });
  await rf.getByLabel("Fund").selectOption("Sambhav");
  await rf.getByLabel("Amount invested (₹ Cr)").fill("7");
  await rf.getByRole("button", { name: "Add round" }).click();
  await expect(page.getByRole("status")).toContainText("Round added.");
  await page.keyboard.press("Escape");
  await expect(row(page, a).locator("td.c-cm")).toContainText("New plant in Hosur commissioned");
  await expect(row(page, a).locator("td.c-cm")).toContainText("2 updates");

  // Pie: sectors → this company's sector ("No sector") → the company → opens it.
  await page.getByRole("button", { name: "Sector allocation" }).click();
  const modal = page.getByRole("dialog", { name: "Portfolio allocation" });
  await expect(modal.locator(".alloc-pie svg")).toBeVisible();
  await modal.getByRole("button", { name: /^No sector:/ }).click();
  await expect(modal.locator(".alloc-crumbs")).toContainText("No sector");
  await expect(modal.getByRole("button", { name: new RegExp(`^${a}:`) })).toBeVisible();
  await modal.getByRole("tab", { name: "Hedgehogs" }).click();
  await expect(modal.getByRole("button", { name: new RegExp(`^${a}:`) })).toHaveCount(0);
  await modal.getByRole("tab", { name: "Sambhav" }).click();
  await modal.getByRole("button", { name: new RegExp(`^${a}:`) }).click();
  await expect(modal).toHaveCount(0);
  await expect(page.locator(".drawer.open .dh-name")).toHaveText(a);
});

test("Reminders panel: save a WhatsApp number per PE, reject a bad one", async ({ page }) => {
  await page.goto("/");
  await page.locator(".pe-lab").getByRole("button", { name: "Reminders" }).click();
  const dlg = page.getByRole("dialog");
  await expect(dlg.getByRole("heading", { name: "WhatsApp reminders" })).toBeVisible();
  await expect(dlg).toContainText("WhatsApp isn’t connected");
  const person = dlg.locator(".rm-row").filter({ hasText: "Arvind Sir" });
  const num = person.getByLabel("WhatsApp number for Arvind Sir");
  await num.fill("12345");
  await num.press("Enter");
  await expect(page.locator(".toast")).toContainText("Enter the WhatsApp number with country code");
  await num.fill("98765 43210");
  await person.getByRole("button", { name: "Save" }).click();
  await expect(page.locator(".toast")).toContainText("Saved for Arvind Sir.");
  await expect(num).toHaveValue("+91 98765 43210");
  // Send test stays off while WhatsApp isn't connected.
  await expect(person.getByRole("button", { name: "Send test" })).toBeDisabled();
});
