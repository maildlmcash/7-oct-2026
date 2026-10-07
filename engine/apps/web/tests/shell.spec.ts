import { expect, test } from "@playwright/test";

const SECTIONS = ["Dashboard", "Market", "DEX", "Wallets", "Predictions", "Paper", "Search", "Checklist", "Bugs", "Admin"];

test("each section keeps one pathname and does not reload the document", async ({ page }) => {
  const navigationUrls: string[] = [];
  page.on("framenavigated", (frame) => {
    if (frame === page.mainFrame()) {
      navigationUrls.push(frame.url());
    }
  });

  await page.goto("/", { waitUntil: "networkidle" });
  const pathname = new URL(page.url()).pathname;
  const navigationsAfterLoad = navigationUrls.length;
  await page.evaluate(() => {
    (window as unknown as { __shellMarker: number }).__shellMarker = 1;
  });
  const historyLength = await page.evaluate(() => history.length);

  const navigationLog: string[] = [];
  for (const name of SECTIONS) {
    const before = navigationUrls.length;
    await page.getByRole("button", { name, exact: true }).click();
    await expect(page.getByRole("heading", { level: 1, name })).toBeVisible();
    expect(new URL(page.url()).pathname).toBe(pathname);
    if (navigationUrls.slice(before).some((url) => new URL(url).pathname !== "/app")) {
      navigationLog.push(`${name} ${navigationUrls.slice(before).join(" ")}`);
    }
    if (name === "Checklist") {
      await expect(page.getByText("checklist status empty")).toBeVisible();
    }
  }

  expect(navigationLog).toEqual([]);
  expect(new URL(page.url()).pathname).toBe("/app");
  expect(await page.evaluate(() => history.length)).toBe(historyLength + SECTIONS.length - 1);
  expect(await page.evaluate(() => (window as unknown as { __shellMarker: number }).__shellMarker)).toBe(1);
});

test("back and forward restore the section on /app, and reload shows Dashboard", async ({ page }) => {
  await page.goto("/app", { waitUntil: "networkidle" });
  const historyBefore = await page.evaluate(() => history.length);
  await page.getByRole("button", { name: "Market", exact: true }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Market" })).toBeVisible();
  const pathname = new URL(page.url()).pathname;
  expect(pathname).toBe("/app");
  expect(await page.evaluate(() => history.length)).toBe(historyBefore + 1);

  await page.goBack();
  expect(new URL(page.url()).pathname).toBe("/app");
  await expect(page.getByRole("heading", { level: 1, name: "Dashboard" })).toBeVisible();

  await page.goForward();
  expect(new URL(page.url()).pathname).toBe(pathname);
  await expect(page.getByRole("heading", { level: 1, name: "Market" })).toBeVisible();

  await page.getByRole("button", { name: "Market", exact: true }).click();
  await page.reload();
  expect(new URL(page.url()).pathname).toBe(pathname);
  await expect(page.getByRole("heading", { level: 1, name: "Dashboard" })).toBeVisible();
});

test("default server capability does not render admin edit controls", async ({ page, request }) => {
  await page.goto("/", { waitUntil: "networkidle" });
  await page.getByRole("button", { name: "Admin", exact: true }).click();
  await expect(page.getByRole("button", { name: "Edit checklist" })).toHaveCount(0);
  await page.getByRole("button", { name: "Market", exact: true }).click();
  await expect(page.getByRole("heading", { level: 2, name: "Live market monitor" })).toBeVisible();
  await page.getByRole("button", { name: "Checklist", exact: true }).click();
  await expect(page.getByText("checklist status empty")).toBeVisible();
  await expect(page.locator("[data-view='user-checklist']")).toHaveCount(0);

  const forged = await request.post("/api/checklist-owner", {
    data: {
      actor: { id: "customer-1", role: "Customer", tenantId: 1 },
      tenantId: 1,
      recordId: "item-1",
      owner: "changed",
      editChecklist: true,
    },
  });
  expect(forged.status()).toBe(401);
  expect(await forged.json()).toEqual({ ok: false, error: "login denied" });

  const admin = await request.post("/api/checklist-owner", {
    data: {
      actor: { id: "admin-1", role: "Admin", tenantId: 1 },
      tenantId: 1,
      recordId: "item-1",
      owner: "changed",
      editChecklist: false,
    },
  });
  expect(admin.status()).toBe(401);
  expect(await admin.json()).toEqual({ ok: false, error: "login denied" });
});
