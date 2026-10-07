import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { expect, test } from "@playwright/test";

const evidenceDir = resolve(process.cwd(), "../../docs/architecture/evidence/1-d-1");
const shown = { timeout: 20_000 };

test("three tenant previews stay on /app and a spoofed host is not applied", async ({ page }) => {
  test.setTimeout(120000);
  await mkdir(evidenceDir, { recursive: true });
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto("/app?host=alpha.preview.test", { waitUntil: "networkidle" });
  expect(new URL(page.url()).pathname).toBe("/app");

  const brand = page.locator("[data-branding]");
  await expect(brand).toBeVisible(shown);
  const applied = brand.locator("[data-applied]");
  await expect(applied).toContainText("unknown host");
  await expect(applied.getByText("Alpha desk")).toHaveCount(0);
  await expect(applied.getByText("Beta desk")).toHaveCount(0);
  expect(await applied.innerText()).not.toMatch(/\bLIVE\b/);

  const previews = [
    ["tenant-alpha", "Alpha desk", "alpha.preview.test", "#0f6e56"],
    ["tenant-beta", "Beta desk", "beta.preview.test", "#1f4b99"],
    ["tenant-gamma", "Gamma desk", "gamma.preview.test", "#8d4a12"],
  ] as const;
  for (const [id, logo, host, color] of previews) {
    const card = brand.locator(`[data-preview="${id}"]`);
    await expect(card).toContainText(logo);
    await expect(card).toContainText(host);
    await expect(card).toContainText(color);
    await expect(card).toContainText("trading off");
    await expect(card).toContainText("orders locked");
    await expect(card).toContainText("wallet off");
    await expect(card).toContainText("credentials off");
    await card.screenshot({ path: resolve(evidenceDir, `${id}.png`) });
  }
  await expect(brand.locator("[data-preview=tenant-gamma]")).toContainText("help off");
  await expect(brand.locator("[data-preview=tenant-alpha]")).toContainText("help on");
  expect(await brand.innerText()).not.toMatch(/\bLIVE\b/);

  await page.getByRole("navigation", { name: "Sections" }).getByRole("button", { name: "Market", exact: true }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Market" })).toBeVisible(shown);
  expect(new URL(page.url()).pathname).toBe("/app");
  await expect(applied).toContainText("unknown host");

  await page.setViewportSize({ width: 360, height: 800 });
  const narrow = await page.evaluate(() => {
    const node = document.querySelector("[data-branding]");
    if (!node) return { overflow: 1 };
    return { overflow: node.scrollWidth - node.clientWidth };
  });
  expect(narrow.overflow).toBeLessThanOrEqual(1);
  expect(new URL(page.url()).pathname).toBe("/app");
});
