import { expect, test } from "@playwright/test";
import { addByName, uniq } from "./helpers";

// Desktop: scrolling the table folds the stage bar and PE team away so the list gets the height; the top of the list
// brings them back. A short window and a few made-up deals make the list long enough to scroll.
test.use({ viewport: { width: 1440, height: 520 } });

test("scrolling the pipeline table folds the stage bar and PE team away, and back at the top", async ({ page }) => {
  test.setTimeout(150_000);
  await page.goto("/");
  const wrap = page.locator(".table-wrap");
  const room = () => wrap.evaluate((el) => el.scrollHeight - el.clientHeight);
  for (let i = 0; i < 8 && (await room()) <= 400; i++) await addByName(page, uniq("Foldco"));
  expect(await room()).toBeGreaterThan(320);

  const stages = page.getByRole("group", { name: "Stages" });
  const pe = page.getByRole("group", { name: "PE team" });
  await expect(stages).toBeVisible();
  await wrap.evaluate((el) => el.scrollTo({ top: 200 }));
  await expect(stages).toBeHidden();
  await expect(pe).toBeHidden();
  await expect(page.getByLabel("Search")).toBeVisible(); // the filters stay

  await wrap.evaluate((el) => el.scrollTo({ top: 0 }));
  await expect(stages).toBeVisible();
  await expect(pe).toBeVisible();
});
