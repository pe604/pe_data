import { expect, test } from "@playwright/test";

test("pages send a nonce-based CSP and the dashboard runs without CSP violations", async ({ page }) => {
  const violations: string[] = [];
  page.on("console", (m) => {
    if (m.type() === "error" && /Content Security Policy|CSP/i.test(m.text())) violations.push(m.text());
  });
  const res = await page.goto("/");
  const csp = res?.headers()["content-security-policy"] ?? "";
  expect(csp).toMatch(/script-src 'self' 'nonce-[A-Za-z0-9+/=]+' 'strict-dynamic'/);
  expect(csp).toContain("object-src 'none'");
  expect(res?.headers()["x-content-type-options"]).toBe("nosniff");
  await expect(page.locator("table.grid")).toBeVisible();
  // Exercise the drawer, a popover and a modal.
  await page.locator("table.grid .co-name").first().click();
  await expect(page.locator(".drawer.open")).toBeVisible();
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Add company" }).first().click();
  await expect(page.getByRole("dialog")).toBeVisible();
  expect(violations).toEqual([]);
});

test("the open-access portal asks search engines not to index it", async ({ request }) => {
  const r = await request.get("/");
  expect(r.headers()["x-robots-tag"]).toContain("noindex");
  expect(await (await request.get("/robots.txt")).text()).toContain("Disallow: /");
});

test("file routes reject unknown ids", async ({ request }) => {
  for (const path of ["/api/files/abc", "/api/companies/abc/download-all"]) {
    expect([400, 404], path).toContain((await request.get(path)).status());
  }
});
