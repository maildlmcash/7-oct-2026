import { expect, test } from "@playwright/test";

// 375 by 667 is a layout fixture. The source names no pixel breakpoint.
const MOBILE = { width: 375, height: 667 };

test("prediction charts stay lazy and mark an empty calibration sample insufficient", async ({ page }) => {
  await page.setViewportSize(MOBILE);
  await page.goto("/", { waitUntil: "networkidle" });
  await page.getByRole("button", { name: "Predictions", exact: true }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Predictions" })).toBeVisible();
  await expect(page.getByText("market view")).toHaveCount(0);

  const charts = page.locator(".layout-charts");
  await expect(charts).toHaveAttribute("data-loaded", "false");
  await expect(charts).toHaveAttribute("data-columns", "1");
  await expect(charts).toHaveAttribute("data-stack", "column");
  await expect(page.getByText("insufficient")).toHaveCount(0);
  await expect(page.getByText("This chart does not guarantee a direction.")).toHaveCount(0);

  await page.getByRole("button", { name: "calibration", exact: true }).click();
  await expect(charts).toHaveAttribute("data-loaded", "true");
  await expect(charts).toHaveAttribute("data-view", "calibration");
  await expect(charts).toHaveAttribute("data-guarantees-direction", "false");
  await expect(page.getByText("Sample size 0")).toBeVisible();
  await expect(page.getByText("observed window is not set")).toBeVisible();
  await expect(page.getByText("bins are not configured")).toBeVisible();
  await expect(page.getByText("insufficient", { exact: true })).toBeVisible();
  await expect(page.getByText("This chart does not guarantee a direction.")).toBeVisible();
  await expect(page.getByText("market view")).toHaveCount(0);

  const chartText = await page.locator(".layout-chart").innerText();
  expect(chartText.toLowerCase()).not.toMatch(/\b(buy|sell|long|short|up|down)\b/);

  await page.getByRole("button", { name: "brier/log-loss", exact: true }).click();
  await expect(charts).toHaveAttribute("data-view", "brier/log-loss");
  await expect(page.getByText("NOT IN SOURCE")).toBeVisible();
  await expect(page.getByText("bins are not configured")).toHaveCount(0);
  await expect(page.getByText("insufficient", { exact: true })).toBeVisible();
  await expect(page.getByText("Sample size 0")).toBeVisible();

  await page.getByRole("button", { name: "model/data version", exact: true }).click();
  await expect(page.getByText("model version is not configured")).toBeVisible();
  await expect(page.getByText("Sample size is not configured")).toBeVisible();
  await expect(page.getByText("NOT IN SOURCE")).toHaveCount(0);

  const box = await charts.boundingBox();
  expect(box).not.toBeNull();
  if (box) {
    expect(box.x).toBeGreaterThanOrEqual(-1);
    expect(box.x + box.width).toBeLessThanOrEqual(MOBILE.width + 1);
  }
  const metrics = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }));
  expect(metrics.scrollWidth).toBeLessThanOrEqual(metrics.clientWidth);
});
