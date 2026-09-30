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

test.describe("signed out", () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test("API routes refuse requests without a session", async ({ request }) => {
    for (const path of ["/api/export", "/api/files/abc", "/api/companies/abc/download-all"]) {
      const r = await request.get(path);
      expect(r.status(), path).toBe(401);
    }
    const up = await request.post("/api/files", { multipart: { kind: "OTHER", file: { name: "a.csv", mimeType: "text/csv", buffer: Buffer.from("a,b") } } });
    expect(up.status()).toBe(401);
  });

  test("the dashboard redirects to sign-in", async ({ page }) => {
    await page.goto("/");
    await expect(page).toHaveURL(/\/signin/);
  });
});
