import assert from "node:assert/strict";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { test } from "node:test";
import { resolve } from "node:path";
import {
  PUBLIC_KEY_PEM,
  approvedPreviews,
  approvedRegistry,
  resolveTenantHost,
} from "../services/tenants/white-label.mjs";

const evidenceDir = resolve(import.meta.dirname, "../docs/architecture/evidence/1-d-1");
const SECRET = "super-secret-value";

function rowOf(host, extra = {}) {
  return {
    host,
    forwardedHost: null,
    originalHost: null,
    requestedTenantId: null,
    userTenantId: null,
    userSubdomain: null,
    ...extra,
  };
}

test("allowlisted hosts keep their own theme and reject spoofing", async () => {
  const source = await readFile(new URL("../services/tenants/white-label.mjs", import.meta.url), "utf8");
  assert.equal(source.includes("BEGIN PRIVATE KEY"), false);
  assert.equal(source.includes(SECRET), false);
  assert.equal(PUBLIC_KEY_PEM.includes("BEGIN PUBLIC KEY"), true);
  assert.equal(PUBLIC_KEY_PEM.includes("PRIVATE"), false);

  const alpha = resolveTenantHost(rowOf("alpha.preview.test"));
  const beta = resolveTenantHost(rowOf("BETA.preview.test:443"));
  const gamma = resolveTenantHost(rowOf("gamma.preview.test."));
  assert.equal(alpha.ok, true);
  assert.equal(beta.ok, true);
  assert.equal(gamma.ok, true);
  assert.equal(alpha.pathname, "/app");
  assert.equal(alpha.theme.tenantId, "tenant-alpha");
  assert.equal(alpha.theme.color, "#0f6e56");
  assert.equal(beta.theme.tenantId, "tenant-beta");
  assert.equal(beta.theme.color, "#1f4b99");
  assert.equal(gamma.theme.color, "#8d4a12");
  assert.equal(gamma.theme.featureFlags.help, false);
  assert.notEqual(alpha.theme.color, beta.theme.color);
  for (const result of [alpha, beta, gamma]) {
    assert.equal(result.theme.featureFlags.liveTrading, false);
    assert.equal(result.theme.featureFlags.liveOrdersLocked, true);
    assert.equal(result.theme.featureFlags.walletAccess, false);
    assert.equal(result.theme.featureFlags.exchangeCredentials, false);
    assert.equal(result.theme.featureFlags.paperPreview, true);
    assert.equal(JSON.stringify(result).includes("balance"), false);
    assert.equal(JSON.stringify(result).includes("LIVE"), false);
  }

  const cases = [
    ["unknown host", rowOf("evil.preview.test"), "unknown host"],
    ["localhost is not a tenant", rowOf("localhost:3468"), "unknown host"],
    ["empty host", rowOf(""), "unknown host"],
    ["forwarded host spoof", rowOf("alpha.preview.test", { forwardedHost: "beta.preview.test" }), "host spoofing rejected"],
    ["original host spoof", rowOf("alpha.preview.test", { originalHost: "gamma.preview.test" }), "host spoofing rejected"],
    ["forwarded host agrees", rowOf("alpha.preview.test", { forwardedHost: "alpha.preview.test:443" }), null],
    ["requested tenant mismatch", rowOf("alpha.preview.test", { requestedTenantId: "tenant-beta" }), "tenant mismatch"],
    ["user tenant mismatch", rowOf("beta.preview.test", { userTenantId: "tenant-alpha" }), "user-subdomain mismatch"],
    ["user subdomain mismatch", rowOf("gamma.preview.test", { userSubdomain: "alpha" }), "user-subdomain mismatch"],
    ["user matches host", rowOf("alpha.preview.test", { userTenantId: "tenant-alpha", userSubdomain: "alpha" }), null],
  ];

  const matrix = [];
  for (const [name, input, error] of cases) {
    const result = resolveTenantHost(input);
    assert.equal(result.pathname, "/app");
    if (error) {
      assert.equal(result.ok, false, name);
      assert.equal(result.error, error, name);
      assert.equal(result.theme, null, name);
    } else {
      assert.equal(result.ok, true, name);
      assert.equal(result.theme.host, "alpha.preview.test", name);
    }
    matrix.push({
      case: name,
      host: input.host,
      forwardedHost: input.forwardedHost,
      originalHost: input.originalHost,
      requestedTenantId: input.requestedTenantId,
      userTenantId: input.userTenantId,
      userSubdomain: input.userSubdomain,
      ok: result.ok,
      error: result.error,
      tenantId: result.theme && result.theme.tenantId,
      pathname: result.pathname,
    });
  }

  const registry = approvedRegistry();
  const alphaRow = registry.find((row) => row.host === "alpha.preview.test");
  const tampered = resolveTenantHost(rowOf("alpha.preview.test"), [{
    ...alphaRow,
    config: { ...alphaRow.config, color: "#112233" },
  }]);
  assert.equal(tampered.ok, false);
  assert.equal(tampered.error, "tenant configuration is not signed");
  assert.equal(tampered.theme, null);
  matrix.push({
    case: "tampered color",
    host: "alpha.preview.test",
    ok: false,
    error: tampered.error,
    tenantId: null,
    pathname: "/app",
  });

  const swapped = resolveTenantHost(rowOf("alpha.preview.test"), [{
    ...alphaRow,
    tenantId: "tenant-beta",
  }]);
  assert.equal(swapped.error, "tenant mismatch");
  matrix.push({
    case: "allowlist tenant does not match signed tenant",
    host: "alpha.preview.test",
    ok: false,
    error: swapped.error,
    tenantId: null,
    pathname: "/app",
  });

  const secretLink = resolveTenantHost(rowOf("alpha.preview.test"), [{
    ...alphaRow,
    config: {
      ...alphaRow.config,
      helpLinks: [{ label: "Help", href: `https://user:${SECRET}@alpha.preview.test/help` }],
    },
  }]);
  assert.equal(secretLink.ok, false);
  assert.equal(secretLink.theme, null);

  const previews = approvedPreviews();
  assert.deepEqual(previews.map((item) => item.theme.tenantId), ["tenant-alpha", "tenant-beta", "tenant-gamma"]);
  assert.deepEqual(previews.map((item) => item.pathname), ["/app", "/app", "/app"]);

  const body = JSON.stringify({ matrix, previews: previews.map((item) => item.theme.tenantId) });
  assert.equal(body.includes(SECRET), false);
  assert.equal(body.includes("PRIVATE"), false);
  await mkdir(evidenceDir, { recursive: true });
  await writeFile(resolve(evidenceDir, "host-routing.json"), `${JSON.stringify({
    task: "1.D.1",
    date: "2026-10-07",
    truth: "MOCK",
    pathname: "/app",
    matrix,
  }, null, 2)}\n`);
});
