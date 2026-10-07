import { expect, test } from "@playwright/test";

const VIEWPORTS = [
  { name: "mobile", width: 375, height: 667 },
  { name: "tablet", width: 768, height: 1024 },
  { name: "desktop", width: 1280, height: 800 },
] as const;

async function expectNoOverflow(page: import("@playwright/test").Page) {
  const metrics = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, client: document.documentElement.clientWidth }));
  expect(metrics.scroll).toBeLessThanOrEqual(metrics.client);
}

for (const viewport of VIEWPORTS) {
  test(`${viewport.name} dashboard and market monitor fit the viewport`, async ({ page }) => {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await page.goto("/", { waitUntil: "networkidle" });
    await expect(page.getByRole("heading", { level: 1, name: "Dashboard" })).toBeVisible();
    await expect(page.getByRole("heading", { level: 2, name: "Read-only market intelligence" })).toBeVisible();
    await expectNoOverflow(page);
    await page.getByRole("button", { name: "Market", exact: true }).click();
    await expect(page.getByRole("heading", { level: 2, name: "Live market monitor" })).toBeVisible();
    await expect(page.getByRole("heading", { level: 3, name: "BTCUSDT · Top of book" })).toBeVisible();
    await expect.poll(async () => await page.getByRole("img", { name: "Recent trade price trace from live exchange events" }).count() + await page.getByText("Price trace appears after live trade events arrive.").count()).toBe(1);
    await expect(page.getByText("LIVE ORDERS LOCKED", { exact: true })).toBeVisible();
    await expectNoOverflow(page);
  });
}

test("DEX search and wallet activity render source responses without labelling addresses as whales", async ({ page }) => {
  await page.route("**/api/dex/search**", async (route) => route.fulfill({ json: { ok: true, pairs: [{ chain: "ethereum", dex: "uniswap", pairAddress: "0xpair", base: "WETH", quote: "USDC", priceUsd: "3200", liquidityUsd: 1200000, volume24hUsd: 300000, url: "https://dexscreener.com/ethereum/0xpair" }] } }));
  await page.route("**/api/wallets/activity**", async (route) => route.fulfill({ json: { ok: true, source: "mock explorer response", transactions: [{ hash: "0xabc", from: "0x1111111111111111111111111111111111111111", to: "0x2222222222222222222222222222222222222222", timestamp: "2026-10-07T10:00:00.000Z", status: "ok", method: "transfer" }] } }));
  await page.goto("/", { waitUntil: "networkidle" });
  await page.getByRole("button", { name: "DEX", exact: true }).click();
  await page.getByRole("button", { name: "Search pools" }).click();
  await expect(page.getByRole("cell", { name: "WETH/USDC" })).toBeVisible();
  await expect(page.getByText("DEX search returns a bounded list of indexed pairs.")).toBeVisible();

  await page.getByRole("button", { name: "Wallets", exact: true }).click();
  await page.getByLabel("Address").fill("0x1111111111111111111111111111111111111111");
  await page.getByRole("button", { name: "Inspect activity" }).click();
  await expect(page.getByText("Whale verification: NOT ESTABLISHED")).toBeVisible();
  await expect(page.getByText("UNVERIFIED", { exact: true })).toBeVisible();
  await expect(page.getByText("mock explorer response")).toBeVisible();
});
