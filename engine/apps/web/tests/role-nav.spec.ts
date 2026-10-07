import { expect, test } from "@playwright/test";

const SECTIONS = ["Dashboard", "Market", "DEX", "Wallets", "Predictions", "Paper", "Search", "Checklist", "Bugs", "Admin"];

test("signed-out shell has no role preview and a forged navigation call is denied", async ({ page, request }) => {
  await page.goto("/app", { waitUntil: "networkidle" });
  await expect(page.getByRole("combobox", { name: "Role preview" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Impersonate user" })).toHaveCount(0);
  for (const name of SECTIONS) {
    await expect(page.getByRole("button", { name, exact: true })).toHaveCount(1);
  }

  await page.goto("/app?role=Super%20Admin&previewRole=Super%20Admin", { waitUntil: "networkidle" });
  await expect(page.getByRole("combobox", { name: "Role preview" })).toHaveCount(0);
  await expect(page.getByText("Preview only. The signed-in role stays Super Admin.")).toHaveCount(0);
  expect(new URL(page.url()).pathname).toBe("/app");

  const denied = await request.post("/api/navigation/action", {
    data: {
      role: "Super Admin",
      previewRole: "Customer",
      action: "screen.open",
      screen: "Admin",
      password: "super-secret-value",
      editChecklist: true,
    },
  });
  expect(denied.status()).toBe(401);
  const body = await denied.json();
  expect(body).toEqual({ ok: false, error: "login denied" });
  expect(JSON.stringify(body)).not.toContain("super-secret-value");
});
