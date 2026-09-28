import { expect, test as setup } from "@playwright/test";

setup("sign in with the dev login", async ({ page }) => {
  await page.goto("/");
  await expect(page).toHaveURL(/\/signin/);
  await page.getByRole("button", { name: /Developer login/ }).click();
  await expect(page.locator("table.grid, .empty").first()).toBeVisible();
  await page.context().storageState({ path: "tests/e2e/.auth.json" });
});
