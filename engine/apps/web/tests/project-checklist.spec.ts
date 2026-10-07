import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { expect, test, type Page } from "@playwright/test";

const evidenceDir = resolve(process.cwd(), "../../docs/architecture/evidence/1-c-2");
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

test("checklist edits survive reload and a blocked dependency stays locked", async ({ page }) => {
  test.setTimeout(120000);
  await mkdir(evidenceDir, { recursive: true });
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto("/app", { waitUntil: "networkidle" });
  await openSection(page, "Checklist");
  await expect(page.getByText("checklist status empty")).toBeVisible(shown);
  const checklist = page.locator("[data-checklist]");
  await expect(checklist.getByRole("heading", { name: "Project checklist" })).toBeVisible(shown);
  for (const name of ["Web", "API", "Data", "Scoring", "Paper engine", "iOS", "Android"]) {
    await expect(checklist.getByRole("group", { name: "Checklist templates" }).getByRole("button", { name, exact: true })).toBeVisible();
  }
  await expect(checklist.locator("[data-template=web]")).toContainText("TODO");
  await expect(checklist.getByRole("button", { name: "Save check" })).toHaveCount(0);
  expect(await checklist.innerText()).not.toMatch(/\bLIVE\b/);

  const loginResponse = page.waitForResponse((response) => response.url().includes("/api/desk/login"));
  await page.getByRole("button", { name: "Admin login" }).click();
  const loggedIn = await loginResponse;
  const loginBody = await loggedIn.json();
  await expect(page.getByRole("heading", { level: 1, name: "Admin" })).toBeVisible({ timeout: 45_000 });
  await openSection(page, "Checklist");
  await expect(checklist.getByRole("button", { name: "Save check" })).toBeVisible(shown);

  await checklist.getByRole("group", { name: "Checklist templates" }).getByRole("button", { name: "Web", exact: true }).click();
  await checklist.getByLabel("Owner").fill("phase desk");
  await checklist.getByLabel("Due date").fill("2026-10-08");
  await checklist.getByLabel("Status").selectOption("BLOCKED");
  await checklist.getByRole("button", { name: "Save check" }).click();
  await expect(checklist.getByRole("status")).toContainText("BLOCKED");
  await expect(checklist.locator("[data-template=web]")).toContainText("phase desk");

  await checklist.getByRole("group", { name: "Checklist templates" }).getByRole("button", { name: "API", exact: true }).click();
  await checklist.getByLabel("Status").selectOption("IN_PROGRESS");
  await checklist.getByRole("button", { name: "Save check" }).click();
  await expect(checklist.getByRole("status")).toContainText("a BLOCKED dependency locks the downstream task");
  await expect(checklist.locator("[data-template=api]")).toContainText("TODO");

  await checklist.getByRole("group", { name: "Checklist templates" }).getByRole("button", { name: "Web", exact: true }).click();
  await checklist.getByLabel("Status").selectOption("PASS");
  await checklist.getByLabel("Evidence link").fill("");
  await checklist.getByRole("button", { name: "Save check" }).click();
  await expect(checklist.getByRole("status")).toContainText("PASS requires evidence");

  await checklist.getByLabel("Evidence link").fill("https://example.com/checklist/web");
  await checklist.getByLabel("Reviewer").fill("desk reviewer");
  await checklist.getByLabel("Reviewed at").fill("2026-10-07T12:00:00.000Z");
  await checklist.getByLabel("Status").selectOption("PASS");
  await checklist.getByRole("button", { name: "Save check" }).click();
  await expect(checklist.getByRole("status")).toContainText("PASS. Version 2.");
  await expect(checklist.locator("[data-template=web]")).toContainText("PASS");

  const issue = await page.request.post("/api/project-checklist/issue", {
    headers: { "x-csrf-token": loginBody.csrfToken },
    data: {
      correlationId: "11111111-1111-4111-8111-111111111111",
      section: "Checklist",
      route: "/api/view-state",
      httpStatus: 500,
      recordedAt: "2026-10-07T12:00:00.000Z",
    },
  });
  expect(issue.ok()).toBe(true);
  await page.reload({ waitUntil: "domcontentloaded" });
  await openSection(page, "Checklist");
  const afterIssue = page.locator("[data-checklist]");
  await expect(afterIssue.locator("[data-template=web]")).toContainText("2026-10-08");
  await expect(afterIssue.locator("[data-template=web]")).toContainText("PASS");
  await expect(afterIssue.getByRole("list", { name: "Monitored issues" })).toContainText("HTTP 500");
  await expect(afterIssue.getByRole("list", { name: "Monitored issues" })).toContainText("TODO");
  expect(await afterIssue.innerText()).not.toMatch(/\bLIVE\b/);

  await afterIssue.screenshot({ path: resolve(evidenceDir, "checklist-1280.png") });
  await page.setViewportSize({ width: 360, height: 800 });
  await expect(afterIssue.getByRole("heading", { name: "Project checklist" })).toBeVisible();
  const narrow = await page.evaluate(() => {
    const node = document.querySelector("[data-checklist]");
    if (!node) return { overflow: 1 };
    return { overflow: node.scrollWidth - node.clientWidth };
  });
  expect(narrow.overflow).toBeLessThanOrEqual(1);
  await afterIssue.screenshot({ path: resolve(evidenceDir, "checklist-360.png") });
  await writeFile(resolve(evidenceDir, "ux-capture.json"), `${JSON.stringify({
    task: "1.C.2",
    date: "2026-10-07",
    truth: "MOCK",
    viewports: [1280, 360],
    checklistOverflowAt360: narrow.overflow,
    survivedReload: true,
    passWithoutEvidence: "rejected",
    blockedDependency: "rejected",
  }, null, 2)}\n`);
});
