import { expect, test } from "@playwright/test";

const secret = "super-secret-value";

test("refresh resets section and pagination, and the view API rejects invalid state", async ({ page, request }) => {
  await page.goto("/", { waitUntil: "networkidle" });
  await page.getByRole("button", { name: "Market", exact: true }).click();
  await expect(page.getByRole("heading", { level: 2, name: "Live market monitor" })).toBeVisible();

  await page.getByRole("button", { name: "Dashboard", exact: true }).click();
  await page.getByRole("button", { name: "Market", exact: true }).click();
  await expect(page.getByRole("heading", { level: 2, name: "Live market monitor" })).toBeVisible();
  await page.reload({ waitUntil: "networkidle" });
  await expect(page.getByRole("heading", { level: 1, name: "Dashboard" })).toBeVisible();
  await page.getByRole("button", { name: "Market", exact: true }).click();
  await expect(page.getByRole("heading", { level: 2, name: "Live market monitor" })).toBeVisible();

  const missing = await request.get("/api/view-state");
  expect(missing.status()).toBe(400);

  const refreshed = await request.get("/api/view-state?pageSize=2");
  expect(refreshed.status()).toBe(200);
  const body = await refreshed.json();
  expect(body.ok).toBe(true);
  expect(body.state.section).toBe("Dashboard");
  expect(body.state.filters).toEqual({});
  expect(body.state.pagination).toEqual({ pageIndex: 0, pageSize: 2 });
  expect(body.state.status.state).toBe("empty");
  expect(body.state.status.error).toBeNull();
  expect(JSON.stringify(body)).not.toContain(secret);

  const denied = await request.post("/api/view-state", {
    data: { ...body.state, secret },
  });
  expect(denied.status()).toBe(400);
  expect(await denied.text()).not.toContain(secret);

  const invalid = await request.post("/api/view-state", {
    data: { ...body.state, section: "Settings" },
  });
  expect(invalid.status()).toBe(400);
});
