import { expect, test } from "@playwright/test";
import path from "node:path";
import { addByName, openCompany, openTab, row, uniq } from "./helpers";
import { addDays, todayISO } from "../../src/lib/domain/dates";
import { lastEndedQuarter, quarterLabel, shiftQuarter } from "../../src/lib/domain/quarters";
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
  // The cells update optimistically, so wait for each save to finish before reloading.
  const saved = () => page.waitForResponse((res) => res.request().method() === "POST" && res.url().endsWith("/"));
  await Promise.all([saved(), r.locator(".stage-sel").selectOption("SCUTTLEBUTT")]);
  await Promise.all([saved(), r.locator(".pri-sel").selectOption("2")]);
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

  await drawer.getByRole("tab", { name: /Files/ }).click();
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

  // Show filter: MIS not received / received.
  const show = page.getByLabel("Show", { exact: true });
  await show.selectOption("mis-received");
  await expect(tr).toHaveCount(0);
  await show.selectOption("mis-missing");
  await expect(tr).toHaveCount(1);
  await show.selectOption("all");

  // MIS: an upload icon until received; several files at once, wrong types skipped; then a tick with the date.
  const mis = page.getByRole("button", { name: "MIS received for Mokobara" });
  await expect(mis.locator(".q-upload")).toBeVisible();
  await mis.click();
  const pop = page.locator(".pop");
  const pdf = Buffer.from("%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF");
  await pop.locator('input[aria-label="Upload MIS files"]').setInputFiles([
    { name: "mokobara-mis.pdf", mimeType: "application/pdf", buffer: pdf },
    { name: "mokobara-mis-annexure.pdf", mimeType: "application/pdf", buffer: pdf },
    { name: "readme.txt", mimeType: "text/plain", buffer: Buffer.from("hello") },
  ]);
  await expect(page.locator(".toast")).toContainText("Uploaded 2 MIS files");
  await expect(page.locator(".toast")).toContainText("skipped 1");
  await expect(mis).toContainText("✓");
  await expect(mis).toContainText("2 files");
  await expect(pop).toContainText("mokobara-mis.pdf");
  await expect(pop).toContainText("mokobara-mis-annexure.pdf");
  await expect(pop.getByRole("button", { name: "View" }).first()).toBeVisible();
  await expect(pop.getByRole("button", { name: "Download" }).first()).toBeVisible();
  await expect(pop.getByRole("button", { name: "Upload a folder" })).toBeVisible();
  await pop.getByRole("button", { name: "Close" }).click();
  await expect(page.locator(".q-progress")).toContainText("MIS received: 1/");
  await show.selectOption("mis-received");
  await expect(tr).toHaveCount(1);
  await show.selectOption("mis-missing");
  await expect(tr).toHaveCount(0);
  await show.selectOption("all");

  // Result note: an upload icon until a file is uploaded.
  const note = page.getByRole("button", { name: "Result note for Mokobara" });
  await expect(note.locator(".q-upload")).toBeVisible();
  await note.click();
  await page.locator(".pop").locator('input[aria-label="Upload result note files"]').setInputFiles({
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

  // No MIS due date in the tracker any more.
  await expect(page.getByRole("button", { name: /MIS due/ })).toHaveCount(0);

  // Company file: both files listed under the quarter, viewable and downloadable.
  await page.getByRole("button", { name: "Mokobara", exact: true }).click();
  await expect(drawer.getByRole("tab", { name: "Numbers" })).toHaveAttribute("aria-selected", "true");
  const q = drawer.locator(".qfiles-q").first();
  await expect(q).toContainText(quarterLabel(lastEndedQuarter(todayISO())));
  await expect(q).toContainText("mokobara-mis.pdf");
  await expect(q).toContainText("mokobara-result-note.pdf");
  await q.getByRole("button", { name: "View" }).first().click();
  await expect(page.locator(".pdf-frame")).toBeVisible();
  await page.keyboard.press("Escape");
  await drawer.getByRole("tab", { name: /Files/ }).click();
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
  await expect(drawer.getByRole("tab", { name: /Updates/ })).toHaveAttribute("aria-selected", "true");
  await expect(drawer.getByRole("heading", { name: "Company updates" })).toBeVisible();
  await expect(drawer).toContainText("Met the CFO");
});

test("MIS figures: upload from the company file, build the figures history by hand (AI off in tests)", async ({ page }) => {
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
  // Four tabs for an Invested company (SPEC §15.5).
  await expect(drawer.getByRole("tab")).toHaveText(["Overview", "Numbers", "Updates", /Files/]);
  await drawer.getByRole("tab", { name: "Numbers" }).click();
  await expect(drawer.getByRole("heading", { name: "Quarterly files" })).toBeVisible();
  await expect(drawer.locator(".nb-empty")).toContainText("No figures yet");

  const wb = new ExcelJS.Workbook();
  wb.addWorksheet("P&L").addRow(["Revenue", 410.2, 431.8, 455.6]);
  const buffer = Buffer.from(await wb.xlsx.writeBuffer());
  const q = quarterLabel(lastEndedQuarter(todayISO()));
  await drawer.locator('input[aria-label="MIS file"]').setInputFiles({
    name: "mis.xlsx",
    mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    buffer,
  });
  // Without an AI key the upload is kept and the reader says so; figures can still be entered by hand.
  await expect(page.locator(".toast")).toContainText("AI reading is not set up");
  await expect(drawer.locator(".qfiles-q").first()).toContainText("mis.xlsx");
  await drawer.locator("summary", { hasText: "Edit figures" }).click();
  await expect(drawer.locator(".mf")).toContainText("No figures yet");

  // A file uploaded as MIS by mistake moves to Other files, and back.
  await drawer.getByLabel("Move mis.xlsx to").selectOption("OTHER");
  await expect(page.locator(".toast")).toContainText("Moved to Other files.");
  await expect(drawer.locator(".qfiles-q").first().locator(".qfiles-row", { hasText: "Other files" })).toContainText("mis.xlsx");
  await drawer.getByLabel("Move mis.xlsx to").selectOption("MIS");
  await expect(page.locator(".toast")).toContainText("Moved to MIS.");

  // Add a line and a quarter, then type figures into the grid.
  const pop = page.locator(".pop");
  await drawer.getByRole("button", { name: "Add line" }).click();
  await pop.getByLabel("Name").fill("Revenue");
  await pop.getByLabel("Section").fill("P&L");
  await pop.getByRole("button", { name: "Add line" }).click();
  await expect(page.locator(".toast")).toContainText("Line added.");
  const qKey = lastEndedQuarter(todayISO());
  await drawer.getByRole("button", { name: "Add period" }).click();
  await pop.getByLabel("Period").fill(qKey);
  await pop.getByRole("button", { name: "Add column" }).click();
  const cell = drawer.getByRole("button", { name: `Revenue, ${q}` });
  await cell.click();
  await pop.getByLabel("Figure").fill("(12.98)");
  await pop.getByRole("button", { name: "Save" }).click();
  await expect(cell).toHaveText("(12.98)");

  // Rename the line; the figure stays with it.
  await drawer.getByRole("button", { name: "Revenue", exact: true }).click();
  await pop.getByLabel("Name").fill("Net revenue");
  await pop.getByRole("button", { name: "Save" }).click();
  await expect(drawer.getByRole("button", { name: `Net revenue, ${q}` })).toHaveText("(12.98)");

  // Paste a table from Excel: periods are recognised, growth columns left out, the review saves it (no AI).
  await drawer.getByRole("button", { name: "Paste from Excel" }).click();
  const paste = page.getByRole("dialog", { name: "Paste from Excel" });
  await paste.getByLabel("Table").fill(["Rs Cr\tFY25\tFY26\tYoY %", "Net revenue\t820.5\t1,150.2\t15%", "EBITDA margin\t-4.8%\t-3.4%\t"].join("\n"));
  await paste.getByRole("button", { name: "Review figures" }).click();
  const review = page.getByRole("dialog", { name: /Review figures/ });
  await expect(review).toContainText("Columns left out: YoY %");
  await expect(review).toContainText("1,150.20");
  await review.getByRole("button", { name: "Save 2 lines" }).click();
  await expect(page.locator(".toast")).toContainText("Saved 4 figures from the pasted table.");

  await drawer.getByRole("tab", { name: /Files/ }).click();
  await expect(page.locator(".hist")).toContainText("from a pasted table");
  await expect(page.locator(".hist")).toContainText(`set Revenue for ${q} to -12.98`);
  await expect(page.locator(".hist")).toContainText("edited MIS line Revenue (now Net revenue)");
  await page.keyboard.press("Escape");

  // The MIS uploaded from the company file ticks the tracker for that quarter.
  await page.getByRole("tab", { name: "Quarterly tracker" }).click();
  await expect(page.getByRole("button", { name: `MIS received for ${a}` })).toContainText("✓");
});

test("results: figures pasted in the company file build a live preview; the format is saved and locked", async ({ page }) => {
  const a = uniq("Resco");
  await page.goto("/");
  await openTab(page, "Invested");
  await page.getByRole("button", { name: "Add company" }).first().click();
  const dlg = page.getByRole("dialog");
  await dlg.getByText("Add several portfolio companies at once").click();
  await dlg.locator("textarea").fill(a);
  await dlg.locator("details").getByRole("button", { name: "Add to Invested" }).click();
  await row(page, a).locator("td.c-amt").first().click();
  const drawer = page.locator(".drawer.open");
  await drawer.getByRole("tab", { name: "Numbers" }).click();

  // Made-up figures (tests are public), pasted for the last two ended quarters.
  const q = lastEndedQuarter(todayISO());
  const prev = shiftQuarter(q, -1);
  await drawer.locator("summary", { hasText: "Edit figures" }).click();
  await drawer.getByRole("button", { name: "Paste from Excel" }).click();
  const paste = page.getByRole("dialog", { name: "Paste from Excel" });
  await paste
    .getByLabel("Table")
    .fill([`Rs Cr\t${quarterLabel(prev)}\t${quarterLabel(q)}`, "Revenue\t200\t250", "COGS\t120\t150", "EBITDA\t-12\t-10"].join("\n"));
  await paste.getByRole("button", { name: "Review figures" }).click();
  await page.getByRole("dialog", { name: /Review figures/ }).getByRole("button", { name: "Save 3 lines" }).click();
  await expect(page.locator(".toast")).toContainText("Saved 6 figures");

  // Numbers dashboard (SPEC §15.13): the new figures redraw the charts and the table, margin worked out.
  const revCard = drawer.locator(".nb-card", { hasText: "Revenue" });
  await expect(revCard).toContainText("250.00");
  await expect(revCard).toContainText("25.00% QoQ");
  await expect(revCard.getByRole("img")).toHaveAttribute("aria-label", `Revenue: ${quarterLabel(prev)} 200.00, ${quarterLabel(q)} 250.00`);
  await expect(drawer.locator(".nb-card", { hasText: "EBITDA margin" })).toContainText("(4.0%)");
  await expect(drawer.locator(".nb-table").first()).toContainText("COGS");  await drawer.getByRole("tab", { name: "Overview" }).click();
  await expect(drawer.locator(".nb-keys")).toContainText("250.00");
  await drawer.getByRole("button", { name: "All numbers" }).click();

  // Make result opens the Results view on this company, at the latest quarter with figures.
  await drawer.getByRole("button", { name: "Make result" }).click();
  await expect(page.locator(".drawer.open")).toHaveCount(0);
  await expect(page.getByLabel("Result quarter")).toHaveValue(q);
  const preview = page.getByLabel(`Result preview: ${a}`);
  await expect(preview).toContainText("250.00");
  await expect(preview).toContainText("25.00%");
  await expect(preview).toContainText("EBITDA margin");
  await expect(preview).toContainText("-4.00%");
  await expect(preview).toContainText("NM = not meaningful");
  await expect(page.locator(".rv-status")).toHaveText("Recommended format, not saved yet");

  // Edits redraw the preview at once.
  await page.locator(".rb").getByLabel("Title").fill(`${a} Private Limited`);
  await expect(page.getByLabel(`Result preview: ${a} Private Limited`)).toBeVisible();
  await page.getByLabel("Column 1 header").fill("This quarter");
  await expect(page.getByLabel(`Result preview: ${a} Private Limited`)).toContainText("This quarter");
  await expect(page.locator(".rv-status")).toHaveText("Unsaved changes");

  await page.getByRole("button", { name: "Save format" }).click();
  await expect(page.locator(".toast")).toContainText("Format saved.");
  await page.getByRole("button", { name: "Lock format" }).click();
  await expect(page.locator(".toast")).toContainText("Format locked");
  await expect(page.locator(".rv-status")).toHaveText("Format locked");
  await expect(page.locator(".rb").getByLabel("Title")).toBeDisabled();

  // Reloaded, the saved format comes back.
  await page.reload();
  await openTab(page, "Invested");
  await page.getByRole("tablist", { name: "Invested views" }).getByRole("tab", { name: "Results" }).click();
  await page.getByLabel("Company", { exact: true }).selectOption({ label: a });
  await expect(page.getByLabel(`Result preview: ${a} Private Limited`)).toContainText("This quarter");

  // Downloads save nothing: an image and an Excel with real numbers.
  const [png] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: "Download image" }).click()]);
  expect(png.suggestedFilename()).toBe(`${a} result ${quarterLabel(q)}.png`);  const [xlsx] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: "Download Excel" }).click()]);
  expect(xlsx.suggestedFilename()).toBe(`${a} result ${quarterLabel(q)}.xlsx`);
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(await xlsx.path());
  const ws = wb.worksheets[0];
  expect(ws.getCell("A1").value).toBe(`${a} Private Limited`);
  expect(ws.getCell("A3").value).toBe("Revenue");
  expect(ws.getCell("B3").value).toBe(250);
  expect(ws.getCell("D3").value).toBe("25.00%");

  // Only Save as result note saves: both files go to the quarter's result note (tracker tick).
  await page.getByRole("button", { name: `Save as result note (${quarterLabel(q)})` }).click();
  await expect(page.locator(".toast")).toContainText(`Saved the result as ${quarterLabel(q)}'s result note`);
  // A second save asks first.
  await page.getByRole("button", { name: `Save as result note (${quarterLabel(q)})` }).click();
  const ask = page.getByRole("dialog", { name: `Add to ${quarterLabel(q)}'s result note?` });
  await expect(ask).toContainText(`${a} result ${quarterLabel(q)}.png`);
  await ask.getByRole("button", { name: "Cancel" }).click();
  await page.getByRole("tablist", { name: "Invested views" }).getByRole("tab", { name: "Quarterly tracker" }).click();
  await expect(page.getByRole("button", { name: `Result note for ${a}` })).toContainText("✓");
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

test("WhatsApp panel: save a number per person, reject a bad one, Research team listed", async ({ page }) => {
  await page.goto("/");
  await page.locator(".pe-lab").getByRole("button", { name: "WhatsApp" }).click();
  const dlg = page.getByRole("dialog");
  await expect(dlg.getByRole("heading", { name: "WhatsApp", exact: true })).toBeVisible();
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
  // Research people are listed too, for assignment messages.
  await expect(dlg.getByRole("heading", { name: "Research team" })).toBeVisible();
  await expect(dlg.locator(".rm-row").filter({ hasText: "Riya" })).toContainText("won’t get assignment messages");
});

test("WhatsApp panel: rename a person everywhere, delete them and their assignments", async ({ page }) => {
  const name = uniq("Ppl");
  const person = "Rs" + uniq("x").replace(/\W/g, "").toLowerCase();
  const display = person.charAt(0).toUpperCase() + person.slice(1);
  const renamed = display + " Two";
  await page.goto("/");
  await addByName(page, name);
  const pop = page.locator(".pop");
  // Popovers close on scroll, so let the cell settle in view before clicking.
  const cell = row(page, name).locator("td.c-re");
  await cell.scrollIntoViewIfNeeded();
  await page.waitForTimeout(300);
  await cell.click();
  await pop.getByRole("textbox", { name: "Assigned Research" }).fill(person);
  await pop.getByRole("option", { name: /as a new team member/ }).click();
  await pop.getByRole("button", { name: "Done" }).click();
  await expect(row(page, name).locator("td.c-re")).toContainText(display);

  const open = async () => {
    await page.locator(".pe-lab").getByRole("button", { name: "WhatsApp" }).click();
    return page.getByRole("dialog");
  };
  let dlg = await open();
  await dlg.locator(".rm-row").filter({ hasText: display }).getByRole("button", { name: "Rename" }).click();
  await dlg.getByLabel(`New name for ${display}`).fill(renamed);
  await dlg.getByRole("button", { name: "Save name" }).click();
  await expect(page.locator(".toast")).toContainText(`Renamed ${display}.`);
  await expect(dlg.locator(".rm-row").filter({ hasText: renamed })).toBeVisible();
  await dlg.getByRole("button", { name: "Close" }).last().click();
  await expect(row(page, name).locator("td.c-re")).toContainText(renamed);

  dlg = await open();
  const r = dlg.locator(".rm-row").filter({ hasText: renamed });
  await r.getByRole("button", { name: "Delete" }).click();
  await expect(r.locator(".rm-confirm")).toContainText("will be removed from 1 company");
  await r.locator(".rm-confirm").getByRole("button", { name: "Delete" }).click();
  await expect(page.locator(".toast")).toContainText(`Deleted ${renamed}.`);
  await expect(dlg.locator(".rm-row").filter({ hasText: renamed })).toHaveCount(0);
  await dlg.getByRole("button", { name: "Close" }).last().click();
  await expect(row(page, name).locator("td.c-re")).not.toContainText(renamed);
  await openCompany(page, name);
  await page.getByRole("tab", { name: "History" }).click();
  await expect(page.locator(".hist")).toContainText(`renamed ${display} to ${renamed}`);
  await expect(page.locator(".hist")).toContainText("Assigned Research");
});

test("WhatsApp panel: Scuttlebutt team with one head; add a person into a team", async ({ page }) => {
  const head = "Sbh" + uniq("x").replace(/\W/g, "").toLowerCase();
  const member = "Sbm" + uniq("x").replace(/\W/g, "").toLowerCase();
  const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
  await page.goto("/");
  await page.locator(".pe-lab").getByRole("button", { name: "WhatsApp" }).click();
  const dlg = page.getByRole("dialog");
  const team = dlg.locator("div").filter({ has: page.getByRole("heading", { name: "Scuttlebutt team" }) }).last();

  await dlg.getByLabel("Name of the person to add").fill(head);
  await dlg.getByLabel("Team for the new person").selectOption("SCUTTLEBUTT_HEAD");
  await dlg.locator(".rm-add").getByRole("button", { name: "Add" }).click();
  await expect(page.locator(".toast")).toContainText(`Added ${head}.`);
  await expect(team.locator(".rm-row").filter({ hasText: cap(head) })).toContainText("Head");

  await dlg.getByLabel("Name of the person to add").fill(member);
  await dlg.getByLabel("Team for the new person").selectOption("SCUTTLEBUTT");
  await dlg.locator(".rm-add").getByRole("button", { name: "Add" }).click();
  const m = team.locator(".rm-row").filter({ hasText: cap(member) });
  await expect(m).toBeVisible();
  await expect(m.locator(".rm-tag")).toHaveCount(0);

  // Making the member head replaces the old head.
  await dlg.getByLabel(`Team for ${cap(member)}`).selectOption("SCUTTLEBUTT_HEAD");
  await expect(page.locator(".toast")).toContainText(`${cap(member)} is now in charge of Scuttlebutt.`);
  await expect(team.locator(".rm-row").filter({ hasText: cap(member) })).toContainText("Head");
  await expect(team.locator(".rm-row").filter({ hasText: cap(head) }).locator(".rm-tag")).toHaveCount(0);

  // Back to plain Research: leaves the Scuttlebutt section.
  await dlg.getByLabel(`Team for ${cap(head)}`).selectOption("");
  await expect(team.locator(".rm-row").filter({ hasText: cap(head) })).toHaveCount(0);
  await expect(dlg.locator(".rm-row").filter({ hasText: cap(head) })).toBeVisible();
});

test("news short links redirect to the article; unknown or malformed codes are 404", async ({ request }) => {
  const res = await request.get("/n/E2eTst1", { maxRedirects: 0 });
  expect(res.status()).toBe(302);
  expect(res.headers()["location"]).toBe("http://127.0.0.1:3100/robots.txt");
  expect((await request.get("/n/Zzzzzz9", { maxRedirects: 0 })).status()).toBe(404);
  expect((await request.get("/n/bad", { maxRedirects: 0 })).status()).toBe(404);
});
