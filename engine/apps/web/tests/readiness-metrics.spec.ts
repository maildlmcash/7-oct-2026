import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { expect, test, type Page } from "@playwright/test";

const evidenceDir = resolve(process.cwd(), "../../docs/architecture/evidence/1-c-3");
const shown = { timeout: 20_000 };

async function openSection(page: Page, name: string) {
  const button = page.getByRole("navigation", { name: "Sections" }).getByRole("button", { name, exact: true });
  await expect(button).toBeVisible(shown);
  const heading = page.getByRole("heading", { level: 1, name });
  for (let attempt = 0; attempt < 3; attempt += 1) {
    await button.click();
    try {
      await expect(heading).toBeVisible({ timeout: 5000 });
      return;
    } catch (error) {
      if (attempt === 2) throw error;
    }
  }
}

test("readiness metrics show UNKNOWN until a test event records a failure", async ({ page }) => {
  test.setTimeout(120000);
  await mkdir(evidenceDir, { recursive: true });
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto("/app", { waitUntil: "networkidle" });
  await openSection(page, "Admin");
  await expect(page.getByRole("heading", { name: "Admin login required" })).toBeVisible(shown);
  await expect(page.getByRole("heading", { name: "Operational readiness" })).toHaveCount(0);

  await page.getByRole("button", { name: "Admin login" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Admin" })).toBeVisible({ timeout: 45_000 });
  await openSection(page, "Admin");
  const panel = page.locator("[data-readiness]");
  await expect(panel.getByRole("heading", { name: "Operational readiness" })).toBeVisible(shown);
  await expect(panel.getByRole("caption").filter({ hasText: "Metric definitions" })).toBeVisible();
  for (const name of ["latency", "uptime", "rate-limit", "security", "device-error"]) {
    const row = panel.locator(`[data-metric="${name}"]`);
    await expect(row).toContainText("UNKNOWN");
    await expect(row).toContainText("not configured");
    await expect(row).toContainText("not measured");
  }
  await expect(panel.locator("[data-series=p50]")).toContainText("not measured");
  await expect(panel.locator("[data-series=rateLimitHeadroom]")).toContainText("rate limit is not configured");
  await expect(panel.locator("[data-security='secret scan']")).toContainText("UNKNOWN");
  for (const surface of ["browser", "mobile"]) {
    for (const check of ["page", "login", "resend-password", "layout"]) {
      await expect(panel.locator(`[data-synthetic="${surface}:${check}"]`)).toContainText("UNKNOWN");
    }
  }
  await expect(panel.locator("[data-breach=WITHIN]")).toHaveCount(0);
  expect(await panel.innerText()).not.toMatch(/\bLIVE\b/);

  await panel.getByRole("button", { name: "Attach test event" }).click();
  await expect(panel.locator("[data-series=p50]")).toContainText("30 · test-event");
  await expect(panel.locator("[data-series=p95]")).toContainText("100 · test-event");
  await expect(panel.locator("[data-series=p99]")).toContainText("100 · test-event");
  await expect(panel.locator("[data-series=p50] [data-breach=UNKNOWN]")).toHaveCount(1);
  await expect(panel.locator("[data-series=freshness]")).toContainText("not measured");
  await expect(panel.locator("[data-series=disconnects]")).toContainText("not measured");
  await expect(panel.locator("[data-series=rateLimitHeadroom]")).toContainText("UNKNOWN");
  await expect(panel.locator("[data-metric=device-error]")).toContainText("test-event:layout");
  await expect(panel.locator("[data-metric=device-error] [data-breach=UNKNOWN]")).toHaveCount(1);
  for (const surface of ["browser", "mobile"]) {
    await expect(panel.locator(`[data-synthetic="${surface}:layout"]`)).toContainText("FAIL");
    await expect(panel.locator(`[data-synthetic="${surface}:page"]`)).toContainText("UNKNOWN");
    await expect(panel.locator(`[data-synthetic="${surface}:login"]`)).toContainText("UNKNOWN");
    await expect(panel.locator(`[data-synthetic="${surface}:resend-password"]`)).toContainText("UNKNOWN");
  }
  await expect(panel.locator("[data-breach=WITHIN]")).toHaveCount(0);
  expect(await panel.innerText()).not.toMatch(/\bLIVE\b/);

  const box = await panel.boundingBox();
  expect(box?.width).toBeLessThanOrEqual(1280);
  await panel.screenshot({ path: resolve(evidenceDir, "readiness-1280.png") });

  await page.setViewportSize({ width: 360, height: 800 });
  await expect(panel.getByRole("heading", { name: "Operational readiness" })).toBeVisible();
  const narrow = await page.evaluate(() => {
    const node = document.querySelector("[data-readiness]");
    if (!node) return { overflow: 1 };
    return { overflow: node.scrollWidth - node.clientWidth };
  });
  expect(narrow.overflow).toBeLessThanOrEqual(1);
  await panel.screenshot({ path: resolve(evidenceDir, "readiness-360.png") });
  await writeFile(resolve(evidenceDir, "ui-test.json"), `${JSON.stringify({
    task: "1.C.3",
    date: "2026-10-07",
    truth: "MOCK",
    before: "UNKNOWN",
    testEvent: {
      p50: "30 · test-event",
      p95: "100 · test-event",
      p99: "100 · test-event",
      breach: "UNKNOWN",
      layout: "FAIL",
      page: "UNKNOWN",
      login: "UNKNOWN",
      resendPassword: "UNKNOWN",
    },
    withinCount: 0,
    overflow360: narrow.overflow,
    liveWordInPanel: false,
  }, null, 2)}\n`);
});
