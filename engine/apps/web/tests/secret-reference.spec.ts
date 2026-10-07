import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { expect, test } from "@playwright/test";

const evidenceDir = resolve(process.cwd(), "../../docs/architecture/evidence/1-d-2");
const shown = { timeout: 20_000 };
const SECRET = "super-secret-value";

test("admin sees masked references and a submitted secret is not shown", async ({ page }) => {
  test.setTimeout(120000);
  await mkdir(evidenceDir, { recursive: true });
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto("/app", { waitUntil: "networkidle" });
  expect(new URL(page.url()).pathname).toBe("/app");
  await page.getByRole("navigation", { name: "Sections" }).getByRole("button", { name: "Admin", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Admin login required" })).toBeVisible(shown);
  await expect(page.getByRole("heading", { name: "Secret references" })).toHaveCount(0);

  await page.getByRole("button", { name: "Admin login" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Admin" })).toBeVisible({ timeout: 45_000 });
  await page.getByRole("navigation", { name: "Sections" }).getByRole("button", { name: "Admin", exact: true }).click();
  const panel = page.locator("[data-credentials]");
  await expect(panel.getByRole("heading", { name: "Secret references" })).toBeVisible(shown);
  await expect(panel.locator("[data-reference=paper-market-read]")).toContainText("masked");
  await expect(panel.locator("[data-reference=paper-market-read]")).toContainText("not configured");
  await expect(panel.locator("[data-scope=trade]")).toContainText("UNAVAILABLE");
  await expect(panel.locator("[data-scope=withdrawal]")).toContainText("BLOCKED");
  await expect(panel.getByText("Secret material is not retrievable")).toBeVisible();
  expect(await panel.innerText()).not.toMatch(/\bLIVE\b/);

  await panel.getByLabel("Secret material").fill(SECRET);
  await panel.getByRole("button", { name: "Save secret reference" }).click();
  await expect(panel.getByRole("status")).toHaveText("secret write is not enabled");
  await expect(panel.getByLabel("Secret material")).toHaveValue("");
  const leaked = await panel.evaluate((node, secret) => {
    const text = node.textContent ?? "";
    const values = [...node.querySelectorAll("input, textarea, select")].map((element) => (
      "value" in element ? String(element.value) : ""
    ));
    return text.includes(secret) || values.some((value) => value.includes(secret));
  }, SECRET);
  expect(leaked).toBe(false);
  expect(new URL(page.url()).pathname).toBe("/app");

  await panel.getByRole("button", { name: "Revoke market reference" }).click();
  await expect(panel.getByRole("status")).toHaveText("Revoked. Metadata only.");
  await expect(panel.locator("[data-reference=paper-market-read]")).toContainText("revoked");
  await expect(panel.locator("[data-reference=paper-market-read]")).toContainText("masked");
  const leakedAfter = await panel.evaluate((node, secret) => (node.textContent ?? "").includes(secret), SECRET);
  expect(leakedAfter).toBe(false);

  await panel.screenshot({ path: resolve(evidenceDir, "credentials-1280.png") });
  await page.setViewportSize({ width: 360, height: 800 });
  const narrow = await page.evaluate(() => {
    const node = document.querySelector("[data-credentials]");
    if (!node) return { overflow: 1 };
    return { overflow: node.scrollWidth - node.clientWidth };
  });
  expect(narrow.overflow).toBeLessThanOrEqual(1);
  await writeFile(resolve(evidenceDir, "ui-redaction.json"), `${JSON.stringify({
    task: "1.D.2",
    date: "2026-10-07",
    truth: "MOCK",
    pathname: "/app",
    materialShown: false,
    write: "secret write is not enabled",
    revocation: "metadata only",
    trade: "UNAVAILABLE",
    withdrawal: "BLOCKED",
    overflow360: narrow.overflow,
  }, null, 2)}\n`);
});
