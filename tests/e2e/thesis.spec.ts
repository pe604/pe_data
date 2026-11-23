import { expect, test } from "@playwright/test";

// Thesis tab and a theme page (SPEC §17.3, §17.4), on the made-up thesis from auth.setup.ts.
test("thesis: the theme list, sub-views, and a theme page with its blocks", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("tab", { name: "Thesis" }).click();
  await expect(page.getByRole("heading", { name: "Thesis, version 1.0" })).toBeVisible();
  await expect(page).toHaveURL(/\?view=thesis$/);
  // Core sorts before Cautionary; counts come from the companies' themes.
  const rows = page.locator(".th-list .th-row");
  await expect(rows.first()).toContainText("Grid equipment test");
  await expect(rows.first()).toContainText("Priority");
  await expect(rows.first()).toContainText("1 holding");
  await expect(rows.first()).toContainText("1 in the pipeline");

  await page.getByRole("tab", { name: "Parameters" }).click();
  await expect(page.getByText("Is there proof?")).toBeVisible();
  await expect(page.getByText("No anchor yet").first()).toBeVisible();
  await page.getByRole("tab", { name: "Themes" }).click();

  await page.getByRole("button", { name: "Grid equipment test" }).click();
  await expect(page).toHaveURL(/view=thesis&theme=T01/);
  for (const block of ["Holdings", "In the pipeline", "Rejected", "Money raised in this theme", "Events coming up"]) {
    await expect(page.getByRole("heading", { name: block, exact: true })).toBeVisible();
  }
  await expect(page.getByRole("region", { name: "Holdings" })).toContainText("Mokobara");
  await expect(page.getByRole("region", { name: "In the pipeline" })).toContainText("Voltaris Grid Systems");
  const money = page.getByRole("region", { name: "Money raised in this theme" });
  await expect(money).toContainText("Voltaris Grid Systems");
  await expect(money).toContainText("In our pipeline");
  await expect(money).not.toContainText("Zentrix Robotics");

  // The address opens the same page directly.
  await page.reload();
  await expect(page.getByRole("heading", { name: /Grid equipment test/ })).toBeVisible();
  await page.getByRole("button", { name: "All themes" }).click();
  await expect(page).toHaveURL(/\?view=thesis$/);
});

test("theme: set from the company file, shown in History, and filtered in the toolbar", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Voltaris Grid Systems" }).first().click();
  await page.getByRole("button", { name: "Theme: Grid equipment test" }).click();
  // Cross-sector themes are not offered
  await expect(page.getByRole("menuitemradio", { name: /Cross-sector test/ })).toHaveCount(0);
  await page.getByRole("menuitemradio", { name: /Snacks test/ }).click();
  await expect(page.getByRole("button", { name: "Theme: Snacks test" })).toBeVisible();
  await page.getByRole("tab", { name: "History" }).click();
  await expect(page.locator(".dbody")).toContainText("Theme");
  await page.keyboard.press("Escape");

  await page.getByRole("button", { name: "Theme", exact: true }).click();
  await page.getByRole("checkbox", { name: "Grid equipment test" }).check();
  await expect(page).toHaveURL(/theme=T01/);
  await expect(page.getByText("Voltaris Grid Systems")).toHaveCount(0);
  await page.getByRole("checkbox", { name: "Grid equipment test" }).uncheck();
  await page.getByRole("checkbox", { name: "Snacks test" }).check();
  await expect(page.getByRole("button", { name: "Voltaris Grid Systems" }).first()).toBeVisible();
});
