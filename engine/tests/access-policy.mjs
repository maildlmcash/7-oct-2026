import assert from "node:assert/strict";
import test from "node:test";
import { health } from "../apps/web/health.mjs";
import { getChecklistOwner, postChecklistOwner } from "../apps/web/policy-http.mjs";
import { CORRELATION_HEADER } from "../apps/web/request-correlation.mjs";
import { getCsrf, postLogin } from "../apps/web/session-http.mjs";
import { authorizeRequest, bindPrincipal, registerResource } from "../services/access-policy.mjs";
import {
  CLIENT_IP_HEADER,
  CSRF_HEADER,
  SESSION_COOKIE_NAME,
  createAccount,
  createSessionStore,
  revokeSession,
} from "../services/session.mjs";
import { SHELL_ROLES } from "../services/shell-capabilities.mjs";

const password = "super-secret-value";
const tenantId = 1;
const otherTenantId = 2;
// The source names no session lifetime or rate cap. These values are test fixtures.
const policy = { ttlMs: 10000, accountLimit: 10, ipLimit: 10, windowMs: 60000 };
const fixtureIp = "192.0.2.10";
const knownCorrelation = "22222222-2222-4222-8222-222222222222";

function runtimeAt(start = 0) {
  let now = start;
  return {
    store: createSessionStore(),
    policy,
    log: [],
    accessLog: [],
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
  return {
    status: response.status,
    body: await response.json(),
    correlationId: response.headers.get(CORRELATION_HEADER),
    setCookie: response.headers.get("set-cookie"),
  };
}

async function openSession(runtime, loginId) {
  const created = createAccount(runtime.store, { loginId, password });
  assert.equal(created.ok, true);
  const csrf = await readJson(getCsrf(new Request("http://localhost/api/session/csrf"), runtime));
  assert.equal(csrf.status, 200);
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
  return {
    subjectId: created.subjectId,
    token,
    cookie: `${SESSION_COOKIE_NAME}=${token}`,
    sessionPublicId: logged.body.sessionPublicId,
  };
}

function bind(runtime, subjectId, role, actorTenant = tenantId) {
  const bound = bindPrincipal(runtime.store, { subjectId, role, tenantId: actorTenant });
  assert.equal(bound.ok, true);
  return bound;
}

function resource(runtime, recordId, ownerSubjectId, resourceTenant = tenantId) {
  const registered = registerResource(runtime.store, {
    recordId,
    tenantId: resourceTenant,
    ownerSubjectId,
  });
  assert.equal(registered.ok, true);
}

async function postOwner(runtime, cookie, data, headers = {}) {
  const requestHeaders = { "content-type": "application/json", ...headers };
  if (cookie) requestHeaders.cookie = cookie;
  return readJson(await postChecklistOwner(new Request("http://localhost/api/checklist-owner", {
    method: "POST",
    headers: requestHeaders,
    body: typeof data === "string" ? data : JSON.stringify(data),
  }), runtime));
}

async function getOwner(runtime, cookie, recordId, headers = {}) {
  const url = recordId === undefined
    ? "http://localhost/api/checklist-owner"
    : `http://localhost/api/checklist-owner?recordId=${encodeURIComponent(recordId)}&role=Admin&tenantId=1`;
  const requestHeaders = { [CLIENT_IP_HEADER]: fixtureIp, ...headers };
  if (cookie) requestHeaders.cookie = cookie;
  return readJson(getChecklistOwner(new Request(url, { headers: requestHeaders }), runtime));
}

function assertClosed(value, secrets) {
  const text = JSON.stringify(value);
  for (const secret of secrets) {
    if (secret) assert.equal(text.includes(secret), false);
  }
}

function assertAccessKeys(log) {
  for (const event of log) {
    assert.deepEqual(Object.keys(event).sort(), ["action", "correlationId", "result", "subjectId"]);
  }
}

test("unauthenticated checklist requests are rejected consistently", async () => {
  const runtime = runtimeAt();
  const customerBody = {
    actor: { id: "customer-1", role: "Customer", tenantId },
    tenantId,
    recordId: "item-1",
    owner: "changed",
    editChecklist: true,
    password,
  };
  const adminBody = {
    actor: { id: "admin-1", role: "Admin", tenantId },
    tenantId,
    recordId: "item-1",
    owner: "changed",
    editChecklist: false,
  };
  const forged = await postOwner(runtime, null, customerBody, { [CORRELATION_HEADER]: password });
  const admin = await postOwner(runtime, null, adminBody, { [CORRELATION_HEADER]: knownCorrelation });
  const broken = await postOwner(runtime, null, "{", { [CORRELATION_HEADER]: knownCorrelation });
  const garbage = await postOwner(runtime, `${SESSION_COOKIE_NAME}=not-a-session`, adminBody);
  const unread = await getOwner(runtime, null, "item-1", { [CORRELATION_HEADER]: password });

  for (const response of [forged, admin, broken, garbage, unread]) {
    assert.equal(response.status, 401);
    assert.deepEqual(response.body, { ok: false, error: "login denied" });
    assert.equal(response.setCookie, null);
    assertClosed(response.body, [password, "not-a-session"]);
  }
  assert.match(forged.correlationId, /^[0-9a-f-]{36}$/i);
  assert.notEqual(forged.correlationId, password);
  assert.equal(admin.correlationId, knownCorrelation);
  assert.equal(unread.correlationId === password, false);
  assertAccessKeys(runtime.accessLog);
  assert.equal(runtime.accessLog.every((event) => event.result === "unauthenticated"), true);
  assertClosed(runtime.accessLog, [password, "Admin", "Customer"]);
});

test("a client role id does not grant checklist.write", async () => {
  const runtime = runtimeAt();
  const customer = await openSession(runtime, "customer-1");
  bind(runtime, customer.subjectId, "Customer");
  resource(runtime, "item-1", customer.subjectId);
  const before = structuredClone(runtime.store.resources.get("item-1"));
  const response = await postOwner(runtime, customer.cookie, {
    actor: { id: "admin-1", role: "Admin", tenantId },
    tenantId,
    recordId: "item-1",
    owner: password,
    editChecklist: true,
    canEdit: true,
  });
  assert.equal(response.status, 403);
  assert.deepEqual(response.body, { ok: false, error: "role scope denied" });
  assert.deepEqual(runtime.store.resources.get("item-1"), before);
  const broken = await postOwner(runtime, customer.cookie, "{");
  assert.equal(broken.status, 403);
  assert.deepEqual(broken.body, { ok: false, error: "role scope denied" });
  assertClosed(response.body, [password, customer.token]);
  assertClosed(runtime.accessLog, [password, customer.token]);
});

test("a same-tenant admin write is blocked when no MFA provider is configured", async () => {
  const runtime = runtimeAt();
  const admin = await openSession(runtime, "admin-1");
  bind(runtime, admin.subjectId, "Admin");
  resource(runtime, "item-1", null);
  const response = await postOwner(runtime, admin.cookie, {
    actor: { role: "Customer", tenantId: otherTenantId },
    tenantId: otherTenantId,
    recordId: "item-1",
    owner: password,
    editChecklist: false,
    canEdit: false,
    password,
  }, { [CORRELATION_HEADER]: knownCorrelation });
  assert.equal(response.status, 503);
  assert.deepEqual(response.body, {
    ok: false,
    error: "mfa provider is not configured",
    blocked: "BLOCKED",
  });
  assert.equal(response.correlationId, knownCorrelation);
  assert.equal(Object.hasOwn(response.body, "correlationId"), false);
  assert.equal(runtime.store.resources.get("item-1").ownerSubjectId, null);
  assert.deepEqual(
    { liveTrading: health.liveTrading, liveOrdersLocked: health.liveOrdersLocked },
    { liveTrading: "OFF", liveOrdersLocked: true },
  );
  assertClosed(response.body, [password, admin.token, "ON"]);
  assertClosed(runtime.accessLog, [password, admin.token, "Customer"]);
  assert.equal(runtime.accessLog.at(-1).result, "ok");
  assert.equal(runtime.accessLog.at(-1).action, "checklist.write");
  assert.equal(runtime.accessLog.at(-1).subjectId, admin.subjectId);
});

test("cross-tenant and unknown records deny", async () => {
  const runtime = runtimeAt();
  const admin = await openSession(runtime, "admin-1");
  const customer = await openSession(runtime, "customer-1");
  bind(runtime, admin.subjectId, "Admin", tenantId);
  bind(runtime, customer.subjectId, "Customer", tenantId);
  resource(runtime, "home-item", customer.subjectId, tenantId);
  resource(runtime, "other-item", customer.subjectId, otherTenantId);
  const crossWrite = await postOwner(runtime, admin.cookie, {
    tenantId,
    recordId: "other-item",
    actor: { role: "Admin", tenantId },
  });
  const unknown = await postOwner(runtime, admin.cookie, { recordId: "missing-item", tenantId });
  const missing = await postOwner(runtime, admin.cookie, { actor: { role: "Admin", tenantId } });
  const crossRead = await getOwner(runtime, customer.cookie, "other-item");
  for (const response of [crossWrite, unknown, missing, crossRead]) {
    assert.equal(response.status, 403);
    assert.deepEqual(response.body, { ok: false, error: "role scope denied" });
  }
});

test("direct-object reads follow the owner subject", async () => {
  const runtime = runtimeAt();
  const first = await openSession(runtime, "customer-a");
  const second = await openSession(runtime, "customer-b");
  const admin = await openSession(runtime, "admin-1");
  bind(runtime, first.subjectId, "Customer");
  bind(runtime, second.subjectId, "Customer");
  bind(runtime, admin.subjectId, "Admin");
  resource(runtime, "owned-a", first.subjectId);
  resource(runtime, "owned-b", second.subjectId);
  resource(runtime, "unowned", null);
  const own = await getOwner(runtime, first.cookie, "owned-a");
  const otherOwner = await getOwner(runtime, second.cookie, "owned-a");
  const reverse = await getOwner(runtime, first.cookie, "owned-b");
  const adminRead = await getOwner(runtime, admin.cookie, "owned-a");
  const unowned = await getOwner(runtime, first.cookie, "unowned");
  const customerWrite = await postOwner(runtime, first.cookie, {
    recordId: "owned-a",
    actor: { role: "Admin", tenantId },
    editChecklist: true,
  });
  assert.equal(own.status, 200);
  assert.deepEqual(own.body, { ok: true });
  for (const response of [otherOwner, reverse, adminRead, unowned, customerWrite]) {
    assert.equal(response.status, 403);
    assert.deepEqual(response.body, { ok: false, error: "role scope denied" });
  }
});

test("expired and revoked sessions stay unauthenticated", async () => {
  const runtime = runtimeAt();
  const admin = await openSession(runtime, "admin-1");
  bind(runtime, admin.subjectId, "Admin");
  resource(runtime, "item-1", null);
  runtime.setNow(10000);
  const expired = await postOwner(runtime, admin.cookie, {
    actor: { role: "Admin", tenantId },
    recordId: "item-1",
    editChecklist: true,
  });
  assert.equal(expired.status, 401);
  assert.deepEqual(expired.body, { ok: false, error: "login denied" });

  const fresh = runtimeAt();
  const again = await openSession(fresh, "admin-2");
  bind(fresh, again.subjectId, "Admin");
  resource(fresh, "item-1", null);
  revokeSession(fresh.store, again.sessionPublicId, fresh.now(), fresh.log, null);
  const revoked = await postOwner(fresh, again.cookie, { recordId: "item-1", role: "Admin" });
  assert.equal(revoked.status, 401);
  assert.deepEqual(revoked.body, { ok: false, error: "login denied" });
  assertClosed([expired.body, revoked.body, fresh.accessLog], [again.token, password]);
});

test("unbound principals and non-editor roles deny both actions", async () => {
  const runtime = runtimeAt();
  const unbound = await openSession(runtime, "unbound-1");
  resource(runtime, "item-1", unbound.subjectId);
  const unboundWrite = await postOwner(runtime, unbound.cookie, { recordId: "item-1", role: "Admin" });
  const unboundRead = await getOwner(runtime, unbound.cookie, "item-1");
  assert.equal(unboundWrite.status, 403);
  assert.equal(unboundRead.status, 403);

  for (const role of SHELL_ROLES) {
    if (role === "Admin" || role === "Customer") continue;
    const actorRuntime = runtimeAt();
    const actor = await openSession(actorRuntime, "role-account");
    bind(actorRuntime, actor.subjectId, role);
    resource(actorRuntime, "item-1", actor.subjectId);
    const write = await postOwner(actorRuntime, actor.cookie, { recordId: "item-1" });
    const read = await getOwner(actorRuntime, actor.cookie, "item-1");
    assert.equal(write.status, 403, role);
    assert.equal(read.status, 403, role);
    assert.deepEqual(write.body, { ok: false, error: "role scope denied" });
  }
});

test("principal binding rejects client-shaped roles and omits secrets from the access log", () => {
  const runtime = runtimeAt();
  const created = createAccount(runtime.store, { loginId: "account-1", password });
  assert.equal(created.ok, true);
  assert.equal(bindPrincipal(runtime.store, { loginId: "missing", role: "Admin", tenantId }).error, "login denied");
  assert.equal(bindPrincipal(runtime.store, {
    subjectId: created.subjectId,
    role: "owner",
    tenantId,
  }).error, "role scope denied");
  assert.equal(bindPrincipal(runtime.store, { subjectId: created.subjectId, role: "Admin" }).error, "role scope denied");
  assert.equal(registerResource(runtime.store, { recordId: "", tenantId }).ok, false);
  const bound = bindPrincipal(runtime.store, { loginId: "account-1", role: "Admin", tenantId });
  assert.equal(bound.subjectId, created.subjectId);
  assert.deepEqual(runtime.store.accounts.get("account-1").role, undefined);
  const denied = authorizeRequest(runtime.store, {
    authenticated: true,
    subjectId: created.subjectId,
    action: password,
    recordId: password,
    log: runtime.accessLog,
    correlationId: password,
  });
  assert.deepEqual(denied, { ok: false, error: "role scope denied" });
  assert.equal(runtime.accessLog[0].action, "deny");
  assert.equal(runtime.accessLog[0].correlationId, null);
  assertClosed(runtime.accessLog, [password]);
  assertAccessKeys(runtime.accessLog);
  for (const event of runtime.log) {
    assert.deepEqual(Object.keys(event).sort(), ["action", "correlationId", "result", "sessionPublicId"]);
  }
});
