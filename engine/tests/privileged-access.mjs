import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { health } from "../apps/web/health.mjs";
import { postChecklistOwner, getChecklistOwner } from "../apps/web/policy-http.mjs";
import { CORRELATION_HEADER } from "../apps/web/request-correlation.mjs";
import { getCsrf, postLogin } from "../apps/web/session-http.mjs";
import { bindPrincipal, registerResource } from "../services/access-policy.mjs";
import {
  MFA_HEADER,
  appendPrivilegedAudit,
  searchPrivilegedAudit,
} from "../services/privileged-access.mjs";
import {
  CLIENT_IP_HEADER,
  CSRF_HEADER,
  SESSION_COOKIE_NAME,
  createAccount,
  createSessionStore,
} from "../services/session.mjs";

const password = "super-secret-value";
// The source names no MFA proof. This value is a test fixture.
const proof = "fixture-mfa-proof";
// The source names no session lifetime or rate cap. These values are test fixtures.
const policy = { ttlMs: 10000, accountLimit: 10, ipLimit: 10, windowMs: 60000 };
const fixtureIp = "192.0.2.10";

function runtimeAt() {
  let now = 0;
  return {
    store: createSessionStore(),
    policy,
    log: [],
    accessLog: [],
    privilegedAudit: [],
    mfaProvider: null,
    now: () => now,
    setNow(value) {
      now = value;
    },
  };
}

function tokenFrom(setCookie) {
  const pair = String(setCookie).split(";")[0];
  return pair.slice(pair.indexOf("=") + 1);
}

async function readJson(response) {
  return { status: response.status, body: await response.json(), setCookie: response.headers.get("set-cookie") };
}

async function openSession(runtime, loginId) {
  const created = createAccount(runtime.store, { loginId, password });
  assert.equal(created.ok, true);
  const csrf = await readJson(getCsrf(new Request("http://localhost/api/session/csrf"), runtime));
  const logged = await readJson(await postLogin(new Request("http://localhost/api/session/login", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      [CSRF_HEADER]: csrf.body.csrfToken,
      [CLIENT_IP_HEADER]: fixtureIp,
    },
    body: JSON.stringify({ loginId, password }),
  }), runtime));
  assert.equal(logged.status, 200);
  const token = tokenFrom(logged.setCookie);
  return { subjectId: created.subjectId, token, cookie: `${SESSION_COOKIE_NAME}=${token}` };
}

function bindAdmin(runtime, subjectId) {
  assert.equal(bindPrincipal(runtime.store, { subjectId, role: "Admin", tenantId: 1 }).ok, true);
  assert.equal(registerResource(runtime.store, { recordId: "item-1", tenantId: 1, ownerSubjectId: null }).ok, true);
}

async function postWrite(runtime, cookie, headers = {}) {
  const requestHeaders = { "content-type": "application/json", ...headers };
  if (cookie) requestHeaders.cookie = cookie;
  return readJson(await postChecklistOwner(new Request("http://localhost/api/checklist-owner", {
    method: "POST",
    headers: requestHeaders,
    body: JSON.stringify({
      actor: { role: "Customer", tenantId: 2 },
      recordId: "item-1",
      editChecklist: true,
      password,
      proof,
    }),
  }), runtime));
}

test("no identity provider blocks the privileged write and records a searchable audit", async () => {
  const runtime = runtimeAt();
  const admin = await openSession(runtime, "admin-1");
  bindAdmin(runtime, admin.subjectId);
  runtime.setNow(50);
  const response = await postWrite(runtime, admin.cookie, { [MFA_HEADER]: proof });
  assert.equal(response.status, 503);
  assert.deepEqual(response.body, {
    ok: false,
    error: "mfa provider is not configured",
    blocked: "BLOCKED",
  });
  const found = searchPrivilegedAudit(runtime.privilegedAudit, {
    actor: admin.subjectId,
    action: "checklist.write",
    target: "item-1",
    since: 50,
    until: 50,
  });
  assert.deepEqual(found, [{
    actor: admin.subjectId,
    action: "checklist.write",
    target: "item-1",
    reason: "mfa provider is not configured",
    time: 50,
  }]);
  assert.equal(searchPrivilegedAudit(runtime.privilegedAudit, { actor: proof }).length, 0);
  found[0].reason = "changed";
  assert.equal(runtime.privilegedAudit[0].reason, "mfa provider is not configured");
  assert.throws(() => {
    runtime.privilegedAudit[0].reason = "changed";
  });
  const text = JSON.stringify({ body: response.body, audit: runtime.privilegedAudit });
  assert.equal(text.includes(proof), false);
  assert.equal(text.includes(password), false);
  assert.equal(text.includes(admin.token), false);
});

test("a configured provider requires MFA before the privileged write", async () => {
  const runtime = runtimeAt();
  const admin = await openSession(runtime, "admin-1");
  bindAdmin(runtime, admin.subjectId);
  runtime.mfaProvider = { verify(value) { return value === proof; } };
  const missing = await postWrite(runtime, admin.cookie);
  const wrong = await postWrite(runtime, admin.cookie, { [MFA_HEADER]: password });
  const accepted = await postWrite(runtime, admin.cookie, { [MFA_HEADER]: proof });
  assert.equal(missing.status, 403);
  assert.deepEqual(missing.body, { ok: false, error: "mfa required" });
  assert.equal(wrong.status, 403);
  assert.deepEqual(wrong.body, { ok: false, error: "mfa denied" });
  assert.equal(accepted.status, 200);
  assert.deepEqual(accepted.body, { ok: true });
  assert.deepEqual(
    { liveTrading: health.liveTrading, liveOrdersLocked: health.liveOrdersLocked },
    { liveTrading: "OFF", liveOrdersLocked: true },
  );
  const reasons = searchPrivilegedAudit(runtime.privilegedAudit, { action: "checklist.write" }).map((event) => event.reason);
  assert.deepEqual(reasons, ["mfa required", "mfa denied", "mfa verified"]);
  const text = JSON.stringify({ missing: missing.body, wrong: wrong.body, accepted: accepted.body, audit: runtime.privilegedAudit });
  assert.equal(text.includes(proof), false);
  assert.equal(text.includes(password), false);
  assert.equal(text.includes(admin.token), false);
});

test("an unauthorized write and a customer read do not become privileged audits", async () => {
  const runtime = runtimeAt();
  const customer = await openSession(runtime, "customer-1");
  assert.equal(bindPrincipal(runtime.store, { subjectId: customer.subjectId, role: "Customer", tenantId: 1 }).ok, true);
  assert.equal(registerResource(runtime.store, {
    recordId: "item-1",
    tenantId: 1,
    ownerSubjectId: customer.subjectId,
  }).ok, true);
  const write = await postWrite(runtime, customer.cookie, { [MFA_HEADER]: proof });
  const read = await readJson(getChecklistOwner(new Request("http://localhost/api/checklist-owner?recordId=item-1", {
    headers: { cookie: customer.cookie, [MFA_HEADER]: proof, [CLIENT_IP_HEADER]: fixtureIp },
  }), runtime));
  assert.equal(write.status, 403);
  assert.deepEqual(write.body, { ok: false, error: "role scope denied" });
  assert.equal(read.status, 200);
  assert.deepEqual(read.body, { ok: true });
  assert.deepEqual(runtime.privilegedAudit, []);
  const rejected = appendPrivilegedAudit(runtime.privilegedAudit, {
    actor: customer.subjectId,
    action: "checklist.write",
    target: proof,
    reason: proof,
    time: 1,
  });
  assert.equal(rejected.ok, false);
  assert.deepEqual(runtime.privilegedAudit, []);
});

test("the privileged audit migration is append-only and has no secret column", () => {
  const sql = readFileSync(new URL("../data/migrations/0007_privileged_audit.sql", import.meta.url), "utf8");
  const rollback = readFileSync(new URL("../data/migrations/0007_privileged_audit_rollback.sql", import.meta.url), "utf8");
  for (const column of ["actor", "action", "target", "reason", "recorded_at"]) {
    assert.equal(sql.includes(column), true);
  }
  assert.match(sql, /audit records are append-only/);
  assert.equal(sql.includes("proof"), false);
  assert.equal(sql.includes("password"), false);
  assert.equal(sql.includes(proof), false);
  assert.match(rollback, /DROP TABLE IF EXISTS privileged_audit/);
});
