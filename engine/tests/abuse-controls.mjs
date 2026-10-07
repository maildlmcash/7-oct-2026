import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { health } from "../apps/web/health.mjs";
import { getChecklistOwner } from "../apps/web/policy-http.mjs";
import { CORRELATION_HEADER } from "../apps/web/request-correlation.mjs";
import {
  getCsrf,
  getRateLimits,
  getSession,
  postLogin,
  postResend,
  postReset,
  sessionRuntime,
} from "../apps/web/session-http.mjs";
import { bindPrincipal, registerResource } from "../services/access-policy.mjs";
import {
  CLIENT_IP_HEADER,
  CSRF_HEADER,
  SESSION_COOKIE_NAME,
  createAccount,
  createSessionStore,
  rateLimitCounters,
} from "../services/session.mjs";

const password = "super-secret-value";
const loginId = "account-1";
const ip = "198.51.100.77";
const knownCorrelation = "11111111-1111-4111-8111-111111111111";
const otherSubject = "22222222-2222-4222-8222-222222222222";

function digest(value) {
  return createHash("sha256").update(value).digest("hex");
}

function runtimeAt(overrides = {}) {
  let now = 0;
  return {
    store: createSessionStore(),
    // Caps and the window are test fixtures. The source names none.
    policy: {
      ttlMs: 10000,
      resetTtlMs: 1000,
      resendTtlMs: 1000,
      accountLimit: 2,
      ipLimit: 5,
      windowMs: 5000,
      ...overrides,
    },
    log: [],
    audit: [],
    alerts: [],
    delivery: [],
    accessLog: [],
    now: () => now,
    setNow(value) {
      now = value;
    },
  };
}

function tokenFrom(setCookie) {
  return String(setCookie).slice(SESSION_COOKIE_NAME.length + 1).split(";")[0];
}

async function readJson(response) {
  return {
    status: response.status,
    body: await response.json(),
    setCookie: response.headers.get("set-cookie"),
  };
}

async function csrf(runtime) {
  const response = await readJson(getCsrf(new Request("http://localhost/api/session/csrf"), runtime));
  assert.equal(response.status, 200);
  return response.body.csrfToken;
}

async function login(runtime, { id = loginId, secret = password, address = ip, correlation } = {}) {
  const headers = {
    "content-type": "application/json",
    [CSRF_HEADER]: await csrf(runtime),
  };
  if (address) headers[CLIENT_IP_HEADER] = address;
  if (correlation) headers[CORRELATION_HEADER] = correlation;
  return readJson(await postLogin(new Request("http://localhost/api/session/login", {
    method: "POST",
    headers,
    body: JSON.stringify({ loginId: id, password: secret }),
  }), runtime));
}

async function recover(runtime, path, address) {
  const poster = path.endsWith("/resend") ? postResend : postReset;
  return readJson(await poster(new Request(`http://localhost${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      [CSRF_HEADER]: await csrf(runtime),
      [CLIENT_IP_HEADER]: address,
    },
    body: JSON.stringify({ loginId }),
  }), runtime));
}

function sessionRequest(cookie, address = ip) {
  const headers = {};
  if (cookie) headers.cookie = `${SESSION_COOKIE_NAME}=${cookie}`;
  if (address) headers[CLIENT_IP_HEADER] = address;
  return new Request("http://localhost/api/session", { headers });
}

function assertNoSecrets(value, secrets) {
  const text = JSON.stringify(value);
  for (const secret of secrets) {
    if (secret) assert.equal(text.includes(secret), false);
  }
}

function assertAlertShape(event) {
  assert.deepEqual(Object.keys(event).sort(), ["action", "correlationId", "result", "subjectId"]);
  assert.equal(event.result, "throttled");
}

function assertCounterShape(row) {
  assert.deepEqual(Object.keys(row).sort(), ["action", "count", "scope", "windowStart"]);
}

test("login bursts stop at the account threshold and recover on the window", async () => {
  const runtime = runtimeAt();
  const created = createAccount(runtime.store, { loginId, password });
  assert.equal(created.ok, true);
  const first = await login(runtime);
  const second = await login(runtime);
  const blocked = await login(runtime, { correlation: password });
  assert.equal(first.status, 200);
  assert.equal(second.status, 200);
  assert.equal(first.body.liveTrading, "OFF");
  assert.equal(first.body.liveOrdersLocked, true);
  assert.equal(first.body.liveTrading, health.liveTrading);
  assert.equal(blocked.status, 401);
  assert.equal(blocked.body.error, "login denied");
  assert.equal(blocked.setCookie, null);
  assert.equal(runtime.log.at(-1).result, "throttled");
  assert.equal(runtime.store.sessions.size, 2);
  const kept = await readJson(getSession(sessionRequest(tokenFrom(first.setCookie)), runtime));
  assert.equal(kept.status, 200);
  assert.equal(kept.body.sessionPublicId, first.body.sessionPublicId);

  const account = rateLimitCounters(runtime.store).find((row) => row.action === "login" && row.scope === "account");
  assert.equal(account.count, 2);
  assert.equal(account.windowStart, 0);
  assertAlertShape(runtime.alerts.at(-1));
  assert.equal(runtime.alerts.at(-1).action, "login");
  assert.equal(runtime.alerts.at(-1).subjectId, created.subjectId);
  assert.notEqual(runtime.alerts.at(-1).correlationId, password);
  assert.throws(() => {
    runtime.alerts.at(-1).password = password;
  });

  runtime.setNow(5000);
  const cooled = await login(runtime);
  assert.equal(cooled.status, 200);
  assert.equal(cooled.setCookie == null, false);
  const recovered = rateLimitCounters(runtime.store).find((row) => row.action === "login" && row.scope === "account");
  assert.equal(recovered.count, 1);
  assert.equal(recovered.windowStart, 5000);
  const secrets = [password, loginId, ip, tokenFrom(first.setCookie), tokenFrom(second.setCookie), tokenFrom(cooled.setCookie)];
  assertNoSecrets(runtime.alerts, secrets);
  assertNoSecrets(runtime.log, secrets);
  assertNoSecrets(rateLimitCounters(runtime.store), [...secrets, digest(loginId), digest(ip)]);
  for (const key of runtime.store.throttle.keys()) {
    assert.equal(key.includes(loginId), false);
    assert.equal(key.includes(ip), false);
    assert.equal(key.includes(password), false);
  }
});

test("login bursts stop at the IP threshold", async () => {
  const runtime = runtimeAt({ accountLimit: 5, ipLimit: 2 });
  for (const id of ["account-1", "account-2", "account-3"]) {
    assert.equal(createAccount(runtime.store, { loginId: id, password }).ok, true);
  }
  const first = await login(runtime, { id: "account-1" });
  const second = await login(runtime, { id: "account-2" });
  const blocked = await login(runtime, { id: "account-3", correlation: knownCorrelation });
  assert.equal(first.status, 200);
  assert.equal(second.status, 200);
  assert.equal(blocked.status, 401);
  assert.equal(blocked.body.error, "login denied");
  assert.equal(blocked.setCookie, null);
  assert.equal(runtime.log.at(-1).result, "throttled");
  const ipRows = rateLimitCounters(runtime.store).filter((row) => row.action === "login" && row.scope === "ip");
  assert.equal(ipRows.length, 1);
  assert.equal(ipRows[0].count, 2);
  const accountRows = rateLimitCounters(runtime.store).filter((row) => row.action === "login" && row.scope === "account");
  assert.equal(accountRows.length, 3);
  assert.equal(accountRows.every((row) => row.count === 1), true);
  assert.equal(runtime.alerts.at(-1).correlationId, knownCorrelation);
  assert.equal(runtime.alerts.at(-1).action, "login");
  assertNoSecrets(runtime.alerts, [password, ip, "account-1", "account-2", "account-3", digest(ip)]);
  for (const row of [...ipRows, ...accountRows]) assertCounterShape(row);
});

test("a missing address or a missing cap does not issue a session", async () => {
  const missingIp = runtimeAt({ accountLimit: 1, ipLimit: 1 });
  createAccount(missingIp.store, { loginId, password });
  const denied = await login(missingIp, { address: "" });
  assert.equal(denied.status, 401);
  assert.equal(denied.body.error, "login denied");
  assert.equal(denied.setCookie, null);
  assert.equal(missingIp.store.sessions.size, 0);
  const allowed = await login(missingIp);
  assert.equal(allowed.status, 200);

  const closed = runtimeAt({ accountLimit: null, ipLimit: null, windowMs: null });
  createAccount(closed.store, { loginId, password });
  const unconfigured = await login(closed);
  assert.equal(unconfigured.status, 503);
  assert.equal(unconfigured.body.error, "rate limit is not configured");
  assert.equal(unconfigured.setCookie, null);
  assert.equal(closed.store.sessions.size, 0);
  assert.equal(closed.log.at(-1).result, "unconfigured");
  assert.equal(closed.alerts.length, 0);
  assertNoSecrets(unconfigured.body, [password, loginId, ip]);

  const noLifetime = runtimeAt({ ttlMs: null, accountLimit: null, ipLimit: null, windowMs: null });
  const lifetime = await readJson(await postLogin(new Request("http://localhost/api/session/login", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      [CSRF_HEADER]: "unused",
      [CLIENT_IP_HEADER]: ip,
    },
    body: JSON.stringify({ loginId, password }),
  }), noLifetime));
  assert.equal(lifetime.status, 503);
  assert.equal(lifetime.body.error, "session expiry is not configured");
  assert.equal(lifetime.setCookie, null);
});

test("reset and resend keep the public body and record a safe throttle alert", async () => {
  const runtime = runtimeAt({ accountLimit: 1, ipLimit: 5 });
  createAccount(runtime.store, { loginId, password });
  const firstReset = await recover(runtime, "/api/session/reset", "203.0.113.1");
  const secondReset = await recover(runtime, "/api/session/reset", "203.0.113.2");
  const firstResend = await recover(runtime, "/api/session/resend", "203.0.113.3");
  const secondResend = await recover(runtime, "/api/session/resend", "203.0.113.4");
  for (const response of [firstReset, secondReset, firstResend, secondResend]) {
    assert.equal(response.status, 200);
    assert.equal(response.body.ok, true);
    assert.equal(response.body.error, undefined);
  }
  assert.equal(runtime.delivery.length, 2);
  assert.deepEqual(runtime.alerts.map((event) => event.action), ["reset", "resend"]);
  assert.equal(runtime.audit.at(-1).result, "throttled");
  for (const event of runtime.alerts) assertAlertShape(event);
  const resetRow = rateLimitCounters(runtime.store).find((row) => row.action === "reset" && row.scope === "account");
  const resendRow = rateLimitCounters(runtime.store).find((row) => row.action === "resend" && row.scope === "account");
  assert.equal(resetRow.count, 1);
  assert.equal(resendRow.count, 1);
  const secrets = [password, loginId, ip, "203.0.113.1", runtime.delivery[0].token, runtime.delivery[1].token];
  assertNoSecrets(runtime.alerts, secrets);
  assertNoSecrets(runtime.audit, secrets);
  assertNoSecrets(rateLimitCounters(runtime.store), secrets);
  assertNoSecrets(secondReset.body, secrets);
  assertNoSecrets(secondResend.body, secrets);
});

test("sensitive reads stop at the threshold and recover on the window", async () => {
  const runtime = runtimeAt();
  const created = createAccount(runtime.store, { loginId, password });
  const logged = await login(runtime, { address: "198.51.100.10" });
  assert.equal(logged.status, 200);
  const token = tokenFrom(logged.setCookie);
  assert.equal(bindPrincipal(runtime.store, { subjectId: created.subjectId, role: "Customer", tenantId: 1 }).ok, true);
  assert.equal(registerResource(runtime.store, {
    recordId: "item-1",
    tenantId: 1,
    ownerSubjectId: created.subjectId,
  }).ok, true);
  const firstSession = await readJson(getSession(sessionRequest(token), runtime));
  const firstChecklist = await readJson(getChecklistOwner(new Request("http://localhost/api/checklist-owner?recordId=item-1", {
    headers: { cookie: `${SESSION_COOKIE_NAME}=${token}`, [CLIENT_IP_HEADER]: ip },
  }), runtime));
  const blockedSession = await readJson(getSession(sessionRequest(token), runtime));
  const blockedChecklist = await readJson(getChecklistOwner(new Request("http://localhost/api/checklist-owner?recordId=item-1", {
    headers: { cookie: `${SESSION_COOKIE_NAME}=${token}`, [CLIENT_IP_HEADER]: ip },
  }), runtime));
  assert.equal(firstSession.status, 200);
  assert.equal(firstChecklist.status, 200);
  assert.deepEqual(firstChecklist.body, { ok: true });
  assert.equal(blockedSession.status, 429);
  assert.equal(blockedSession.body.error, "rate limit denied");
  assert.equal(blockedSession.body.sessionPublicId, undefined);
  assert.equal(blockedSession.body.subjectId, undefined);
  assert.equal(blockedChecklist.status, 429);
  assert.deepEqual(blockedChecklist.body, { ok: false, error: "rate limit denied" });
  const subject = rateLimitCounters(runtime.store).find((row) => row.action === "read" && row.scope === "subject");
  assert.equal(subject.count, 2);
  assert.equal(subject.windowStart, 0);
  assert.equal(runtime.alerts.at(-1).action, "read");
  assert.equal(runtime.alerts.at(-1).subjectId, created.subjectId);

  runtime.setNow(5000);
  const cooled = await readJson(getSession(sessionRequest(token), runtime));
  assert.equal(cooled.status, 200);
  assert.equal(cooled.body.sessionPublicId, logged.body.sessionPublicId);
  const recovered = rateLimitCounters(runtime.store).find((row) => row.action === "read" && row.scope === "subject");
  assert.equal(recovered.count, 1);
  assert.equal(recovered.windowStart, 5000);
  assertNoSecrets(
    { alerts: runtime.alerts, counters: rateLimitCounters(runtime.store), blocked: blockedSession.body },
    [password, loginId, ip, token, "198.51.100.10", digest(created.subjectId)],
  );
});

test("the limits route requires a session and omits secrets", async () => {
  const runtime = runtimeAt({ accountLimit: 10, ipLimit: 10 });
  const created = createAccount(runtime.store, { loginId, password });
  const logged = await login(runtime);
  assert.equal(logged.status, 200);
  const token = tokenFrom(logged.setCookie);
  const rawToken = "raw-token-secret";
  runtime.alerts.push({
    action: "login",
    result: "throttled",
    subjectId: otherSubject,
    correlationId: knownCorrelation,
    password,
  });
  runtime.alerts.push({
    action: "read",
    result: "throttled",
    subjectId: created.subjectId,
    correlationId: knownCorrelation,
    password,
    token: rawToken,
  });
  const anonymous = await readJson(getRateLimits(new Request("http://localhost/api/session/limits"), runtime));
  assert.equal(anonymous.status, 401);
  assert.equal(anonymous.body.error, "login denied");
  const exposed = await readJson(getRateLimits(new Request("http://localhost/api/session/limits", {
    headers: {
      cookie: `${SESSION_COOKIE_NAME}=${token}`,
      [CLIENT_IP_HEADER]: ip,
      [CORRELATION_HEADER]: knownCorrelation,
    },
  }), runtime));
  assert.equal(exposed.status, 200);
  assert.equal(exposed.setCookie, null);
  assert.equal(exposed.body.ok, true);
  assert.equal(exposed.body.alerts.length, 1);
  assert.deepEqual(exposed.body.alerts[0], {
    action: "read",
    result: "throttled",
    subjectId: created.subjectId,
    correlationId: knownCorrelation,
  });
  for (const row of exposed.body.counters) assertCounterShape(row);
  const loginCount = exposed.body.counters.find((row) => row.action === "login" && row.scope === "account");
  assert.equal(loginCount.count, 1);
  assertNoSecrets(exposed.body, [password, rawToken, loginId, ip, token, otherSubject, digest(ip), digest(loginId)]);
  assert.equal(JSON.stringify(exposed.body).includes("password"), false);
});

test("unauthenticated reads stay denied when the cap is unset", async () => {
  assert.equal(sessionRuntime.policy.accountLimit, null);
  assert.equal(sessionRuntime.policy.ipLimit, null);
  assert.equal(sessionRuntime.policy.windowMs, null);
  assert.deepEqual(sessionRuntime.alerts, []);
  assert.equal(health.liveTrading, "OFF");
  assert.equal(health.liveOrdersLocked, true);
  const session = await readJson(getSession(new Request("http://localhost/api/session"), sessionRuntime));
  const limits = await readJson(getRateLimits(new Request("http://localhost/api/session/limits"), sessionRuntime));
  const checklist = await readJson(getChecklistOwner(
    new Request("http://localhost/api/checklist-owner?recordId=item-1"),
    sessionRuntime,
  ));
  for (const response of [session, limits, checklist]) {
    assert.equal(response.status, 401);
    assert.equal(response.body.ok, false);
    assert.equal(response.body.error, "login denied");
    assert.equal(response.body.subjectId, undefined);
  }
  assert.equal(Object.hasOwn(checklist.body, "correlationId"), false);
});
