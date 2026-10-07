import { expect, test, type Page } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";

// The source names Hindi, English, and Urdu. It does not name a theme or a contrast ratio.
// Pixel sizes are the same viewport fixtures as the layout test, not source requirements.
const DESKTOP = { width: 1280, height: 800 };
const TABLET = { width: 768, height: 1024 };
const MOBILE = { width: 375, height: 667 };
const EVIDENCE_DIR = path.join(process.cwd(), "../../docs/evidence/03-b-02");

const LANGUAGES = [
  { label: "English", lang: "en", dir: "ltr", first: "English", second: "sample" },
  { label: "Hindi", lang: "hi", dir: "ltr", first: "हिंदी", second: "अक्षर" },
  { label: "Urdu", lang: "ur", dir: "rtl", first: "اردو", second: "نمونہ" },
] as const;

type ContrastRow = {
  selector: string;
  color?: string;
  background?: string;
  ratio?: number;
  fontFamily?: string;
  error?: string;
};

test.beforeAll(() => {
  fs.mkdirSync(EVIDENCE_DIR, { recursive: true });
  for (const name of fs.readdirSync(EVIDENCE_DIR)) {
    if (name.startsWith("failure-") || name === "failures.txt") {
      fs.unlinkSync(path.join(EVIDENCE_DIR, name));
    }
  }
});

test.afterEach(async ({ page }, testInfo) => {
  if (testInfo.status === testInfo.expectedStatus) return;
  fs.mkdirSync(EVIDENCE_DIR, { recursive: true });
  const fileName = `failure-${testInfo.title.replace(/\s+/g, "-")}.png`;
  await page.screenshot({ path: path.join(EVIDENCE_DIR, fileName), fullPage: true });
  fs.appendFileSync(
    path.join(EVIDENCE_DIR, "failures.txt"),
    `${testInfo.title}\n${testInfo.error?.message ?? "failed"}\n${fileName}\n`,
  );
});

async function expectNoHorizontalOverflow(page: Page) {
  const metrics = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }));
  expect(metrics.scrollWidth).toBeLessThanOrEqual(metrics.clientWidth);
}

async function contrastReport(page: Page): Promise<ContrastRow[]> {
  return page.evaluate(() => {
    function parseRgb(input: string) {
      const match = input.match(/rgba?\(([0-9.]+),\s*([0-9.]+),\s*([0-9.]+)(?:,\s*([0-9.]+))?\)/);
      if (!match) return null;
      const alpha = match[4] === undefined ? 1 : Number(match[4]);
      if (alpha === 0) return null;
      return [Number(match[1]), Number(match[2]), Number(match[3])];
    }
    function channel(value: number) {
      const scaled = value / 255;
      return scaled <= 0.03928 ? scaled / 12.92 : ((scaled + 0.055) / 1.055) ** 2.4;
    }
    function luminance(rgb: number[]) {
      return 0.2126 * channel(rgb[0]) + 0.7152 * channel(rgb[1]) + 0.0722 * channel(rgb[2]);
    }
    function ratio(foreground: number[], background: number[]) {
      const lighter = Math.max(luminance(foreground), luminance(background));
      const darker = Math.min(luminance(foreground), luminance(background));
      return (lighter + 0.05) / (darker + 0.05);
    }
    function backgroundOf(element: Element) {
      let node: Element | null = element;
      while (node) {
        const color = getComputedStyle(node).backgroundColor;
        const parsed = parseRgb(color);
        if (parsed) return { parsed, color };
        node = node.parentElement;
      }
      return null;
    }
    const selectors = [
      ".layout-mark",
      ".layout-sample-label",
      "[data-language-sample]",
      ".layout-language button",
      "nav[aria-label='Sections'] button",
      "h1",
    ];
    return selectors.map((selector) => {
      const element = document.querySelector(selector);
      if (!element) return { selector, error: "missing" };
      const style = getComputedStyle(element);
      const foreground = parseRgb(style.color);
      const background = backgroundOf(element);
      if (!foreground || !background) return { selector, error: "unresolved color" };
      return {
        selector,
        color: style.color,
        background: background.color,
        ratio: ratio(foreground, background.parsed),
        fontFamily: style.fontFamily,
      };
    });
  });
}

test("keyboard reaches each control, keeps focus visible, and leaves section logic unchanged", async ({ page }) => {
  await page.goto("/", { waitUntil: "networkidle" });
  const pathname = new URL(page.url()).pathname;
  const historyBefore = await page.evaluate(() => history.length);

  await page.keyboard.press("Tab");
  const english = page.getByRole("button", { name: "English", exact: true });
  await expect(english).toBeFocused();
  const focusStyle = await page.evaluate(() => {
    const style = getComputedStyle(document.activeElement as Element);
    return { outlineStyle: style.outlineStyle, outlineWidth: Number.parseFloat(style.outlineWidth) };
  });
  expect(focusStyle.outlineStyle).not.toBe("none");
  expect(focusStyle.outlineWidth).toBeGreaterThanOrEqual(2);

  await page.keyboard.press("Tab");
  await expect(page.getByRole("button", { name: "Hindi", exact: true })).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.locator("html")).toHaveAttribute("lang", "hi");
  await expect(page.locator("html")).toHaveAttribute("dir", "ltr");
  await expect(page.locator("[data-sample-part='first']")).toHaveText("हिंदी");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Dashboard");

  await page.keyboard.press("Tab");
  await expect(page.getByRole("button", { name: "Urdu", exact: true })).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.locator("html")).toHaveAttribute("lang", "ur");
  await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
  await expect(page.locator("[data-language-sample]")).toHaveAttribute("dir", "rtl");
  await expect(page.locator("[data-sample-part='first']")).toHaveText("اردو");

  await page.keyboard.press("Shift+Tab");
  await page.keyboard.press("Shift+Tab");
  await expect(english).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
  await expect(page.locator("html")).toHaveAttribute("dir", "ltr");

  const focused: string[] = [];
  for (let step = 0; step < 12; step += 1) {
    await page.keyboard.press("Tab");
    focused.push((await page.evaluate(() => document.activeElement?.textContent ?? "")).trim());
  }
  expect(focused).toEqual([
    "Hindi",
    "Urdu",
    "Dashboard",
    "Market",
    "DEX",
    "Wallets",
    "Predictions",
    "Paper",
    "Search",
    "Checklist",
    "Bugs",
    "Admin",
  ]);

  await page.keyboard.press("Shift+Tab");
  await expect(page.getByRole("button", { name: "Bugs", exact: true })).toBeFocused();
  await page.getByRole("button", { name: "Market", exact: true }).focus();
  await expect(page.getByRole("button", { name: "Market", exact: true })).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("heading", { level: 1, name: "Market" })).toBeVisible();
  await expect(page.getByRole("heading", { level: 2, name: "Live market monitor" })).toBeVisible();
  expect(new URL(page.url()).pathname).toBe(pathname);
  expect(await page.evaluate(() => history.length)).toBe(historyBefore);

  await page.getByRole("button", { name: "Dashboard", exact: true }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Dashboard" })).toBeVisible();
  expect(await page.evaluate(() => history.length)).toBe(historyBefore);
});

test("language matrix keeps direction, contrast, and section behavior", async ({ page }) => {
  await page.setViewportSize(DESKTOP);
  await page.goto("/", { waitUntil: "networkidle" });
  await expect(page.getByRole("group", { name: "Language" })).toBeVisible();
  await expect(page.getByText("Language sample")).toBeVisible();

  const matrix: {
    language: string;
    lang: string;
    dir: string;
    theme: string;
    viewport: string;
    contrast: ContrastRow[];
    screenshot: string;
  }[] = [];

  for (const language of LANGUAGES) {
    await page.getByRole("button", { name: language.label, exact: true }).click();
    await expect(page.locator("html")).toHaveAttribute("lang", language.lang);
    await expect(page.locator("html")).toHaveAttribute("dir", language.dir);
    await expect(page.locator("[data-language-sample]")).toHaveAttribute("lang", language.lang);
    await expect(page.locator("[data-language-sample]")).toHaveAttribute("dir", language.dir);
    await expect(page.locator("[data-sample-part='first']")).toHaveText(language.first);
    await expect(page.locator("[data-sample-part='second']")).toHaveText(language.second);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Dashboard");
    await expect(page.getByText("market view")).toHaveCount(0);

    const first = await page.locator("[data-sample-part='first']").boundingBox();
    const second = await page.locator("[data-sample-part='second']").boundingBox();
    expect(first).not.toBeNull();
    expect(second).not.toBeNull();
    if (first && second) {
      if (language.dir === "rtl") expect(first.x).toBeGreaterThan(second.x);
      else expect(second.x).toBeGreaterThan(first.x);
    }

    const contrast = await contrastReport(page);
    for (const row of contrast) {
      expect(row.error, row.selector).toBeUndefined();
      expect(row.ratio ?? 0).toBeGreaterThan(1);
    }
    await expectNoHorizontalOverflow(page);
    const fileName = `${language.lang}-desktop.png`;
    await page.screenshot({ path: path.join(EVIDENCE_DIR, fileName), fullPage: true });
    await page.locator("[data-language-sample]").screenshot({
      path: path.join(EVIDENCE_DIR, `${language.lang}-sample.png`),
    });
    matrix.push({
      language: language.label,
      lang: language.lang,
      dir: language.dir,
      theme: "current",
      viewport: "desktop",
      contrast,
      screenshot: fileName,
    });
  }

  await page.getByRole("button", { name: "Urdu", exact: true }).click();
  for (const viewport of [
    { name: "tablet", size: TABLET },
    { name: "mobile", size: MOBILE },
  ]) {
    await page.setViewportSize(viewport.size);
    await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
    const first = await page.locator("[data-sample-part='first']").boundingBox();
    const second = await page.locator("[data-sample-part='second']").boundingBox();
    expect(first && second && first.x > second.x).toBe(true);
    await expectNoHorizontalOverflow(page);
    const contrast = await contrastReport(page);
    for (const row of contrast) {
      expect(row.error, `${viewport.name} ${row.selector}`).toBeUndefined();
      expect(row.ratio ?? 0).toBeGreaterThan(1);
    }
    const fileName = `ur-${viewport.name}.png`;
    await page.screenshot({ path: path.join(EVIDENCE_DIR, fileName), fullPage: true });
    matrix.push({
      language: "Urdu",
      lang: "ur",
      dir: "rtl",
      theme: "current",
      viewport: viewport.name,
      contrast,
      screenshot: fileName,
    });
  }

  await page.reload({ waitUntil: "networkidle" });
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
  await expect(page.locator("html")).toHaveAttribute("dir", "ltr");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Dashboard");
  await page.getByRole("button", { name: "Checklist", exact: true }).click();
  await expect(page.getByText("checklist status empty")).toBeVisible();

  fs.writeFileSync(
    path.join(EVIDENCE_DIR, "result.json"),
    `${JSON.stringify({ themeNote: "The source does not name a theme. theme 'current' is the user-agent Canvas presentation.", contrastGate: "Rendered text and background must differ. No contrast ratio is named in the source.", failures: [], matrix }, null, 2)}\n`,
  );
});
