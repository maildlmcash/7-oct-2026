import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { expect, test, type Page } from "@playwright/test";

const SECTIONS = ["Dashboard", "Market", "DEX", "Wallets", "Predictions", "Paper", "Search", "Checklist", "Bugs", "Admin"];
const evidenceDir = resolve(process.cwd(), "../../docs/architecture/evidence/1-a-2");

async function expectNoOverlap(page: Page) {
  const result = await page.evaluate(() => {
    const root = document.documentElement;
    const selectors = [".app-masthead", "nav[aria-label='Breadcrumb']", "nav[aria-label='Sections']", "main h1"];
    const boxes = selectors.map((selector) => {
      const element = document.querySelector(selector);
      if (!element) return null;
      const rect = element.getBoundingClientRect();
      return { selector, x: rect.x, y: rect.y, width: rect.width, height: rect.height };
    });
    const overlaps: string[] = [];
    for (let left = 0; left < boxes.length; left += 1) {
      for (let right = left + 1; right < boxes.length; right += 1) {
        const a = boxes[left];
        const b = boxes[right];
        if (!a || !b || a.width === 0 || b.width === 0) continue;
        const width = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x);
        const height = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y);
        if (width > 1 && height > 1) overlaps.push(`${a.selector} overlaps ${b.selector}`);
      }
    }
    return {
      overflow: root.scrollWidth - root.clientWidth,
      missing: boxes.filter((box) => box === null).length,
      overlaps,
    };
  });
  expect(result.missing).toBe(0);
  expect(result.overflow).toBeLessThanOrEqual(0);
  expect(result.overlaps).toEqual([]);
}

test("every section stays on /app, back and forward keep that pathname, and mobile chrome does not overlap", async ({ page }) => {
  await mkdir(evidenceDir, { recursive: true });
  const trace: { section: string; pathname: string; heading: string }[] = [];

  await page.goto("/", { waitUntil: "networkidle" });
  expect(new URL(page.url()).pathname).toBe("/app");

  await page.setViewportSize({ width: 360, height: 800 });
  await page.keyboard.press("Tab");
  await expect(page.getByRole("button", { name: "English", exact: true })).toBeFocused();
  const focusStyle = await page.evaluate(() => {
    const style = getComputedStyle(document.activeElement as Element);
    return { outlineStyle: style.outlineStyle, outlineWidth: Number.parseFloat(style.outlineWidth) };
  });
  expect(focusStyle.outlineStyle).not.toBe("none");
  expect(focusStyle.outlineWidth).toBeGreaterThanOrEqual(2);

  for (const name of SECTIONS) {
    await page.getByRole("button", { name, exact: true }).click();
    await expect(page.getByRole("heading", { level: 1, name })).toBeVisible();
    await expect(page.getByRole("navigation", { name: "Breadcrumb" }).locator("[aria-current='page']")).toHaveText(name);
    const pathname = new URL(page.url()).pathname;
    expect(pathname).toBe("/app");
    trace.push({ section: name, pathname, heading: name });
    await expectNoOverlap(page);
  }

  await page.screenshot({ path: resolve(evidenceDir, "mobile-admin.png"), fullPage: false });
  await page.goBack();
  expect(new URL(page.url()).pathname).toBe("/app");
  await expect(page.getByRole("heading", { level: 1, name: "Bugs" })).toBeVisible();
  await page.goForward();
  expect(new URL(page.url()).pathname).toBe("/app");
  await expect(page.getByRole("heading", { level: 1, name: "Admin" })).toBeVisible();

  await page.emulateMedia({ reducedMotion: "reduce" });
  const transition = await page.locator("nav[aria-label='Sections'] button").first().evaluate((element) => getComputedStyle(element).transitionDuration);
  expect(transition === "0s" || transition === "0ms").toBe(true);

  await page.setViewportSize({ width: 1280, height: 800 });
  await page.getByRole("button", { name: "Dashboard", exact: true }).click();
  await expectNoOverlap(page);
  await page.screenshot({ path: resolve(evidenceDir, "desktop-dashboard.png"), fullPage: false });

  await writeFile(resolve(evidenceDir, "route-trace.json"), `${JSON.stringify({ pathname: "/app", trace }, null, 2)}\n`);
});
