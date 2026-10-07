import { expect, test, type ConsoleMessage, type Page } from "@playwright/test";
import { SHELL_SECTIONS } from "@crypto-prediction-engine/contracts";

const secret = "super-secret-value";
const correlationId = "11111111-1111-4111-8111-111111111111";
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isBrowserResourceError(text: string) {
  return /Failed to load resource|WebSocket connection to 'wss:\/\/(?:data-stream\.binance\.vision|fstream\.binance\.com)\//i.test(text);
}

function isReactDevBoundaryLog(text: string) {
  return /The above error occurred in the <|React will try to recreate this component tree|injected section render failure/.test(text);
}

function watchPage(page: Page) {
  const consoleErrors: string[] = [];
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => {
    pageErrors.push(String(error));
  });
  page.on("console", (message: ConsoleMessage) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  return { consoleErrors, pageErrors };
}

test("view and checklist routes carry a correlation id and do not echo a secret", async ({ request }) => {
  const known = "22222222-2222-4222-8222-222222222222";
  const echoed = await request.get("/api/view-state?pageSize=2", {
    headers: { "x-correlation-id": known, "x-shell-section": "Dashboard" },
  });
  expect(echoed.status()).toBe(200);
  expect(echoed.headers()["x-correlation-id"]).toBe(known);
  const echoedBody = await echoed.json();
  expect(echoedBody.correlationId).toBe(known);
  expect(echoedBody.ok).toBe(true);
  expect(echoedBody.state.section).toBe("Dashboard");
  expect(JSON.stringify(echoedBody)).not.toContain(secret);

  const poisoned = await request.get("/api/view-state?pageSize=2", {
    headers: { "x-correlation-id": secret, "x-shell-section": secret },
  });
  expect(poisoned.status()).toBe(200);
  const poisonedId = poisoned.headers()["x-correlation-id"];
  expect(poisonedId).toMatch(UUID_PATTERN);
  expect(poisonedId).not.toBe(secret);
  const poisonedBody = await poisoned.json();
  expect(poisonedBody.correlationId).toBe(poisonedId);
  expect(JSON.stringify(poisonedBody)).not.toContain(secret);

  const forged = await request.post("/api/checklist-owner", {
    headers: { "x-correlation-id": secret },
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
  expect(forged.headers()["x-correlation-id"]).toMatch(UUID_PATTERN);
  expect(forged.headers()["x-correlation-id"]).not.toBe(secret);

  const admin = await request.post("/api/checklist-owner", {
    headers: { "x-correlation-id": known },
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
  expect(admin.headers()["x-correlation-id"]).toBe(known);

  const unread = await request.get("/api/checklist-owner?recordId=item-1&role=Admin&tenantId=1", {
    headers: { "x-correlation-id": secret },
  });
  expect(unread.status()).toBe(401);
  expect(await unread.json()).toEqual({ ok: false, error: "login denied" });
  expect(unread.headers()["x-correlation-id"]).toMatch(UUID_PATTERN);
  expect(unread.headers()["x-correlation-id"]).not.toBe(secret);
});

test("an injected view-state failure stays in the section panel and records a diagnostic", async ({ page }) => {
  const watched = watchPage(page);
  await page.route("**/api/view-state**", async (route) => {
    await route.fulfill({
      status: 500,
      contentType: "application/json",
      headers: {
        "cache-control": "no-store",
        "x-correlation-id": correlationId,
      },
      body: JSON.stringify({ ok: false, error: secret, secret }),
    });
  });

  await page.goto("/", { waitUntil: "domcontentloaded" });
  const panel = page.locator(".layout-panel");
  await expect(page.getByRole("heading", { level: 1, name: "Dashboard" })).toBeVisible();
  for (const name of SHELL_SECTIONS) {
    await expect(page.getByRole("button", { name, exact: true })).toBeVisible();
  }
  const alert = panel.getByRole("alert").filter({ hasText: "Section request failed" });
  await expect(alert).toContainText(correlationId);
  await expect(panel.locator(`[data-correlation-id="${correlationId}"]`)).toBeVisible();
  await expect(panel.getByRole("heading", { level: 2, name: "Read-only market intelligence" })).toBeVisible();
  await expect(panel).not.toContainText(secret);
  await expect(panel).not.toContainText("market view");
  await expect(panel.getByRole("button", { name: "Edit checklist" })).toHaveCount(0);

  const dashboardEvent = await page.evaluate((id) => {
    const events = (window as unknown as { __shellDiagnostics?: unknown[] }).__shellDiagnostics ?? [];
    return events.find((event) => {
      const record = event as { correlationId?: string; section?: string };
      return record.correlationId === id && record.section === "Dashboard";
    });
  }, correlationId);
  expect(dashboardEvent).toEqual({
    correlationId,
    section: "Dashboard",
    route: "/api/view-state",
    httpStatus: 500,
  });
  expect(JSON.stringify(dashboardEvent)).not.toContain(secret);

  await page.getByRole("button", { name: "Checklist", exact: true }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Checklist" })).toBeVisible();
  await expect(page.getByText("checklist status empty")).toBeVisible();
  await expect(panel.getByRole("alert").filter({ hasText: "Section request failed" })).toBeVisible();

  await page.getByRole("button", { name: "Market", exact: true }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Market" })).toBeVisible();
  await expect(page.getByRole("heading", { level: 2, name: "Live market monitor" })).toBeVisible();
  await expect(page.getByText("market view")).toHaveCount(0);
  await expect(panel.getByRole("alert").filter({ hasText: "Section request failed" })).toBeVisible();

  await page.unroute("**/api/view-state**");
  await page.reload({ waitUntil: "domcontentloaded" });
  await expect(page.getByRole("heading", { level: 1, name: "Dashboard" })).toBeVisible();
  await expect(page.getByRole("alert").filter({ hasText: "Section request failed" })).toHaveCount(0);
  await expect(page.getByText(secret)).toHaveCount(0);

  // Chromium logs a failed-resource line for the injected HTTP 500. The page throws nothing.
  expect(watched.pageErrors).toEqual([]);
  expect(watched.consoleErrors.filter((text) => !isBrowserResourceError(text))).toEqual([]);
});

test("a thrown section render leaves the shell and the other sections usable", async ({ page }) => {
  const watched = watchPage(page);
  await page.addInitScript(() => {
    (window as unknown as { __injectSectionError?: string }).__injectSectionError = "Dashboard";
  });
  await page.goto("/", { waitUntil: "networkidle" });
  const panel = page.locator(".layout-panel");
  await expect(page.getByRole("heading", { level: 1, name: "Dashboard" })).toBeVisible();
  const alert = panel.getByRole("alert").filter({ hasText: "Section render failed" });
  await expect(alert).toBeVisible();
  await expect(panel).not.toContainText("injected section render failure");
  await expect(page.getByText("Nothing to show")).toHaveCount(0);

  await page.getByRole("button", { name: "Market", exact: true }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Market" })).toBeVisible();
  await expect(page.getByRole("heading", { level: 2, name: "Live market monitor" })).toBeVisible();
  await expect(panel.getByRole("alert").filter({ hasText: "Section render failed" })).toHaveCount(0);

  await page.getByRole("button", { name: "Checklist", exact: true }).click();
  await expect(page.getByText("checklist status empty")).toBeVisible();

  const rendered = await page.evaluate(() => {
    const events =
      (window as unknown as {
        __shellDiagnostics?: Array<{ route?: string; section?: string; httpStatus?: number | null; correlationId?: string }>;
      }).__shellDiagnostics ?? [];
    return events.find((event) => event.route === "section-render" && event.section === "Dashboard") ?? null;
  });
  expect(rendered?.route).toBe("section-render");
  expect(rendered?.section).toBe("Dashboard");
  expect(rendered?.httpStatus).toBeNull();
  expect(JSON.stringify(rendered)).not.toContain("injected section render failure");
  // React development mode logs this handled render error. The boundary catches it.
  expect(watched.pageErrors).toEqual([]);
  expect(watched.consoleErrors.filter((text) => !isReactDevBoundaryLog(text) && !isBrowserResourceError(text))).toEqual([]);
});
