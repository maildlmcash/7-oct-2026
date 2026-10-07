import { expect, test } from "@playwright/test";

test("market monitor shows no fabricated price or chart values before actual exchange events", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 667 });
  await page.goto("/", { waitUntil: "networkidle" });
  await page.getByRole("button", { name: "Market", exact: true }).click();
  await expect(page.getByRole("heading", { level: 2, name: "Live market monitor" })).toBeVisible();
  await expect(page.getByRole("heading", { level: 3, name: "BTCUSDT · Top of book" })).toBeVisible();
  await expect.poll(async () => await page.getByRole("img", { name: "Recent trade price trace from live exchange events" }).count() + await page.getByText("Price trace appears after live trade events arrive.").count()).toBe(1);
  await expect(page.getByRole("cell", { name: "layout fixture" })).toHaveCount(0);
  await expect(page.getByText("LIVE ORDERS LOCKED")).toBeVisible();
  const metrics = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, client: document.documentElement.clientWidth }));
  expect(metrics.scroll).toBeLessThanOrEqual(metrics.client);
});
