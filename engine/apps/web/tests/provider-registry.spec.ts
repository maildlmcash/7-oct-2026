import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { expect, test, type Page } from "@playwright/test";

const evidenceDir = resolve(process.cwd(), "../../docs/architecture/evidence/1-c-1");
const shown = { timeout: 20_000 };

async function openSection(page: Page, name: string) {
  const button = page.getByRole("navigation", { name: "Sections" }).getByRole("button", { name, exact: true });
  await expect(button).toBeVisible(shown);
  await button.click();
  await expect(page.getByRole("heading", { level: 1, name })).toBeVisible(shown);
}

async function openRegistry(page: Page) {
  await page.goto("/app", { waitUntil: "networkidle" });
  await page.getByRole("button", { name: "Admin login" }).click();
  await expect(page.getByRole("heading", { level: 2, name: "Provider registry" })).toBeVisible({ timeout: 45_000 });
  await openSection(page, "Admin");
}

test("admin inspects every provider list and edits permitted metadata", async ({ page }) => {
  test.setTimeout(120000);
  await mkdir(evidenceDir, { recursive: true });
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto("/app", { waitUntil: "networkidle" });
  await openSection(page, "Admin");
  await expect(page.getByRole("heading", { name: "Admin login required" })).toBeVisible(shown);
  await expect(page.getByRole("heading", { name: "Provider registry" })).toHaveCount(0);

  await openRegistry(page);
  const registry = page.locator("[data-registry]");
  await expect(registry.getByText("NOT_TESTED").first()).toBeVisible();
  await expect(registry.getByText("NOT_CONFIGURED").first()).toBeVisible();
  await expect(registry.getByText("not verified").first()).toBeVisible();
  expect(await registry.innerText()).not.toMatch(/\bLIVE\b/);

  for (const name of ["CEX", "DEX", "data vendor", "wallet-monitoring"]) {
    await registry.getByRole("button", { name, exact: true }).click();
    await expect(registry.locator("caption")).toHaveText(name);
  }
  await registry.getByRole("button", { name: "CEX", exact: true }).click();
  await registry.getByRole("button", { name: "Status" }).click();
  await registry.getByLabel("Filter providers").fill("binance");
  await expect(registry.getByRole("button", { name: "Binance Spot" })).toBeVisible();
  await expect(registry.getByRole("button", { name: "CEX adapter not named" })).toHaveCount(0);

  await registry.getByRole("button", { name: "Binance Spot" }).click();
  for (const tab of ["REST", "WebSocket", "chain/RPC", "fields", "calculations", "permissions"]) {
    await registry.getByRole("tab", { name: tab }).click();
    await expect(registry.getByRole("tab", { name: tab })).toHaveAttribute("aria-selected", "true");
  }
  const labels = registry.getByRole("list", { name: "Capability labels" });
  await expect(labels.getByText("public-read-only:")).toBeVisible();
  await expect(labels.getByText("account-read: unavailable")).toBeVisible();
  await expect(labels.getByText("trade: unavailable")).toBeVisible();

  await registry.getByLabel("Product").fill("Binance Spot public");
  await registry.getByRole("button", { name: "Save metadata" }).click();
  await expect(registry.getByRole("status")).toContainText("NOT_TESTED");
  await expect(registry.getByRole("button", { name: "Binance Spot public" })).toBeVisible();
  await expect(registry.getByText("not verified").first()).toBeVisible();

  const box = await registry.boundingBox();
  expect(box?.width).toBeLessThanOrEqual(1280);
  await registry.screenshot({ path: resolve(evidenceDir, "registry-1280.png") });

  await page.setViewportSize({ width: 360, height: 800 });
  await expect(registry.getByRole("heading", { name: "Provider registry" })).toBeVisible();
  const narrow = await page.evaluate(() => {
    const node = document.querySelector("[data-registry]");
    if (!node) return { overflow: 1 };
    return { overflow: node.scrollWidth - node.clientWidth };
  });
  expect(narrow.overflow).toBeLessThanOrEqual(1);
  await registry.screenshot({ path: resolve(evidenceDir, "registry-360.png") });
  await writeFile(resolve(evidenceDir, "ui-test.json"), `${JSON.stringify({
    task: "1.C.1",
    date: "2026-10-07",
    truth: "MOCK",
    viewports: [1280, 360],
    registryOverflowAt360: narrow.overflow,
    statuses: ["NOT_CONFIGURED", "NOT_TESTED"],
  }, null, 2)}\n`);
});
