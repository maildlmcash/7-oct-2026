import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { expect, test, type Page } from "@playwright/test";

const axePath = resolve(process.cwd(), "node_modules/axe-core/axe.min.js");
const evidenceDir = resolve(process.cwd(), "../../docs/architecture/evidence/1-a-3");

const VIEWPORTS = [
  { name: "360", width: 360, height: 800 },
  { name: "768", width: 768, height: 1024 },
  { name: "1280", width: 1280, height: 800 },
] as const;

type AxeSummary = { id: string; impact: string | null; help: string; nodes: number; targets: string[][] };

async function overflowOf(page: Page) {
  return page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }));
}

async function runAxe(page: Page): Promise<{ violations: AxeSummary[]; incomplete: AxeSummary[] }> {
  const loaded = await page.evaluate(() => "axe" in window);
  if (!loaded) await page.addScriptTag({ path: axePath });
  return page.evaluate(async () => {
    const axe = (window as unknown as {
      axe: {
        run: (
          context: Document,
          options: unknown,
        ) => Promise<{
          violations: { id: string; impact: string | null; help: string; nodes: { target: string[] }[] }[];
          incomplete: { id: string; impact: string | null; help: string; nodes: { target: string[] }[] }[];
        }>;
      };
    }).axe;
    const result = await axe.run(document, {
      runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"] },
    });
    const summarize = (items: { id: string; impact: string | null; help: string; nodes: { target: string[] }[] }[]) =>
      items.map((item) => ({
        id: item.id,
        impact: item.impact,
        help: item.help,
        nodes: item.nodes.length,
        targets: item.nodes.slice(0, 5).map((node) => node.target),
      }));
    return { violations: summarize(result.violations), incomplete: summarize(result.incomplete) };
  });
}

test("gallery meets WCAG 2.2 AA and does not overflow at 360, 768, and desktop", async ({ page }) => {
  test.setTimeout(180000);
  await mkdir(evidenceDir, { recursive: true });
  const responsive: Record<string, unknown>[] = [];
  const axeReport: Record<string, unknown>[] = [];

  for (const viewport of VIEWPORTS) {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await page.emulateMedia({ colorScheme: "light", reducedMotion: "no-preference" });
    await page.goto("/gallery", { waitUntil: "networkidle" });
    expect(new URL(page.url()).pathname).toBe("/gallery");
    await expect(page.getByRole("heading", { level: 1, name: "Component gallery" })).toBeVisible();
    for (const copy of [
      "Loading. No fixture has arrived.",
      "Empty. There are no rows in this fixture.",
      "Stale. The source time is not current.",
      "Error. This fixture failed to load.",
      "Restricted. This view is not available.",
      "No series is drawn. This container does not show a price.",
    ]) {
      await expect(page.getByText(copy).first()).toBeVisible();
    }

    if (viewport.name === "1280") {
      await page.keyboard.press("Tab");
      await expect(page.getByRole("button", { name: "Light", exact: true })).toBeFocused();
      const focusStyle = await page.evaluate(() => {
        const style = getComputedStyle(document.activeElement as Element);
        return { outlineStyle: style.outlineStyle, outlineWidth: Number.parseFloat(style.outlineWidth) };
      });
      expect(focusStyle.outlineStyle).not.toBe("none");
      expect(focusStyle.outlineWidth).toBeGreaterThanOrEqual(2);

      await page.getByRole("button", { name: "Open fixture dialog" }).click();
      await expect(page.getByRole("heading", { name: "Fixture dialog" })).toBeVisible();
      const dialogAxe = await runAxe(page);
      axeReport.push({ viewport: viewport.name, theme: "light", dialog: true, ...dialogAxe });
      expect(dialogAxe.violations).toEqual([]);
      await page.screenshot({ path: resolve(evidenceDir, "gallery-1280-dialog.png") });
      await page.keyboard.press("Escape");
      await expect(page.getByRole("heading", { name: "Fixture dialog" })).toBeHidden();
    }

    for (const theme of ["light", "dark"] as const) {
      await page.emulateMedia({ colorScheme: theme });
      await page.getByRole("button", { name: theme === "light" ? "Light" : "Dark", exact: true }).click();
      await page.evaluate(() => Promise.all(document.getAnimations().map((animation) => animation.finished)));
      expect(new URL(page.url()).pathname).toBe("/gallery");
      const box = await overflowOf(page);
      expect(box.scrollWidth).toBeLessThanOrEqual(box.clientWidth);
      const axe = await runAxe(page);
      responsive.push({ viewport: viewport.name, theme, density: "comfortable", ...box, overflow: box.scrollWidth - box.clientWidth });
      axeReport.push({ viewport: viewport.name, theme, dialog: false, ...axe });
      expect(axe.violations, JSON.stringify(axe.violations)).toEqual([]);
      expect(axe.incomplete.filter((item) => item.id === "color-contrast")).toEqual([]);
      await page.screenshot({ path: resolve(evidenceDir, `gallery-${viewport.name}-${theme}.png`) });
    }
  }

  await page.setViewportSize({ width: 360, height: 800 });
  await page.emulateMedia({ colorScheme: "light", reducedMotion: "reduce" });
  await page.getByRole("button", { name: "Light", exact: true }).click();
  await page.getByRole("button", { name: "Compact", exact: true }).click();
  await page.evaluate(() => Promise.all(document.getAnimations().map((animation) => animation.finished)));
  const compact = await overflowOf(page);
  expect(compact.scrollWidth).toBeLessThanOrEqual(compact.clientWidth);
  const compactAxe = await runAxe(page);
  responsive.push({ viewport: "360", theme: "light", density: "compact", ...compact, overflow: compact.scrollWidth - compact.clientWidth });
  axeReport.push({ viewport: "360", theme: "light", density: "compact", ...compactAxe });
  expect(compactAxe.violations, JSON.stringify(compactAxe.violations)).toEqual([]);
  const transition = await page.locator(".ui-gallery button").first().evaluate((element) => getComputedStyle(element).transitionDuration);
  expect(transition === "0s" || transition === "0ms").toBe(true);
  await page.screenshot({ path: resolve(evidenceDir, "gallery-360-compact-light.png") });

  await writeFile(resolve(evidenceDir, "axe-report.json"), `${JSON.stringify(axeReport, null, 2)}\n`);
  await writeFile(resolve(evidenceDir, "responsive.json"), `${JSON.stringify(responsive, null, 2)}\n`);
});
