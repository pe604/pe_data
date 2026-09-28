import { expect, type Page } from "@playwright/test";

export const uniq = (p: string) => `${p} ${Date.now().toString(36).slice(-5)}`;

export async function openTab(page: Page, name: "Pipeline" | "Rejected" | "Invested") {
  await page.getByRole("tab", { name: new RegExp("^" + name) }).click();
}

export function row(page: Page, company: string) {
  return page.locator("table.grid tbody tr").filter({ has: page.getByRole("button", { name: company, exact: true }) });
}

/** Adds a company by name through the Add company modal. */
export async function addByName(page: Page, name: string, target: "Pipeline" | "Invested" = "Pipeline") {
  await page.getByRole("button", { name: "Add company" }).first().click();
  const dlg = page.getByRole("dialog");
  await dlg.getByRole("button", { name: `Add to ${target}` }).click();
  await dlg.getByLabel("Company name").fill(name);
  await dlg.getByRole("button", { name: "Continue" }).click();
  await dlg.getByRole("button", { name: target === "Pipeline" ? "Add to pipeline" : "Add to Invested" }).click();
  await expect(page.getByRole("status")).toContainText(name);
}

export async function openCompany(page: Page, name: string) {
  await page.getByRole("button", { name, exact: true }).click();
  await expect(page.locator(".drawer.open .dh-name")).toHaveText(name);
}
