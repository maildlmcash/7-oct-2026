import assert from "node:assert/strict";
import test from "node:test";
import { health } from "../apps/web/health.mjs";
import { CORRELATION_HEADER } from "../apps/web/request-correlation.mjs";
import { getCsrf, getSession, postLogin, postLogout, postRotate, sessionRuntime } from "../apps/web/session-http.mjs";
import {
  CLIENT_IP_HEADER,
  CSRF_HEADER,
  SESSION_COOKIE_NAME,
  createAccount,
  createSessionStore,
  readSession,
  reviewSessionCookie,
  revokeSession,
} from "../services/session.mjs";

const password = "super-secret-value";
const loginId = "account-1";
// The source names no session lifetime or rate cap. These values are test fixtures.
const policy = { ttlMs: 1000, accountLimit: 10, ipLimit: 10, windowMs: 60000 };
const fixtureIp = "192.0.2.10";

function runtimeAt(start = 0) {
  let now = start;
  return {
    store: createSessionStore(),
    policy,
    log: [],
    now: () => now,
    setNow(value) {
      now = value;
    },
  };
}

function cookiePair(token) {
  return `${SESSION_COOKIE_NAME}=${token}`;
}

async function readJson(response) {
  return { status: response.status, body: await response.json(), setCookie: response.headers.get("set-cookie") };
}

async function issueCsrf(runtime) {
  const response = await readJson(getCsrf(new Request("http://localhost/api/session/csrf"), runtime));
  assert.equal(response.status, 200);
  assert.equal(typeof response.body.csrfToken, "string");
  return response.body.csrfToken;
}

async function loginRequest(runtime, { csrfToken, cookie, correlation, body }) {
  const headers = { "content-type": "application/json", [CLIENT_IP_HEADER]: fixtureIp };
  if (csrfToken) headers[CSRF_HEADER] = csrfToken;
  if (cookie) headers.cookie = cookie;
  if (correlation) headers[CORRELATION_HEADER] = correlation;
  return readJson(await postLogin(new Request("http://localhost/api/session/login", {
    method: "POST",
    headers,
    body: JSON.stringify(body ?? { loginId, password }),
  }), runtime));
}

function assertSafeLog(log, secrets) {
  const text = JSON.stringify(log);
  for (const secret of secrets) {
    if (secret) assert.equal(text.includes(secret), false);
  }
  for (const event of log) {
    assert.deepEqual(Object.keys(event).sort(), ["action", "correlationId", "result", "sessionPublicId"]);
  }
}

function assertSecureCookie(header, { hasValue }) {
  const reviewed = reviewSessionCookie(header);
  assert.equal(reviewed.name, SESSION_COOKIE_NAME);
  assert.equal(reviewed.httpOnly, true);
  assert.equal(reviewed.secure, true);
  assert.equal(reviewed.sameSite, "Strict");
  assert.equal(reviewed.path, "/");
  assert.equal(reviewed.domain, false);
  assert.equal(reviewed.hasValue, hasValue);
  return reviewed;
}

test("login, logout, expiry, revocation, and rotation keep tokens out of the log", async () => {
  const runtime = runtimeAt(0);
  const created = createAccount(runtime.store, { loginId, password });
  assert.equal(created.ok, true);

  const usedCsrf = await issueCsrf(runtime);
  const missing = await loginRequest(runtime, { csrfToken: usedCsrf, body: { loginId, password: "wrong-password" } });
  assert.equal(missing.status, 401);
  assert.equal(missing.body.error, "login denied");
  assert.equal(missing.setCookie, null);

  const replay = await loginRequest(runtime, { csrfToken: usedCsrf, body: { loginId, password } });
  assert.equal(replay.status, 403);

  const csrfToken = await issueCsrf(runtime);
  const loggedIn = await loginRequest(runtime, { csrfToken, correlation: password });
  assert.equal(loggedIn.status, 200);
  assert.equal(loggedIn.body.liveTrading, "OFF");
  assert.equal(loggedIn.body.liveOrdersLocked, true);
  assert.equal(loggedIn.body.liveTrading, health.liveTrading);
  assert.notEqual(loggedIn.body.correlationId, password);
  assert.equal(loggedIn.body.correlationId.includes(password), false);
  assertSecureCookie(loggedIn.setCookie, { hasValue: true });
  const token = loggedIn.setCookie.slice(SESSION_COOKIE_NAME.length + 1).split(";")[0];
  assert.equal(JSON.stringify(loggedIn.body).includes(token), false);
  assert.equal(JSON.stringify(loggedIn.body).includes(password), false);
  assert.notEqual(loggedIn.body.csrfToken, token);

  const current = await readJson(getSession(new Request("http://localhost/api/session", {
    headers: { cookie: cookiePair(token), [CLIENT_IP_HEADER]: fixtureIp },
  }), runtime));
  assert.equal(current.status, 200);
  assert.equal(current.body.sessionPublicId, loggedIn.body.sessionPublicId);
  assert.equal(JSON.stringify(current.body).includes(token), false);
  assert.equal(current.body.subjectId, undefined);

  const stored = [...runtime.store.sessions.values()][0];
  stored.liveTrading = "ON";
  assert.equal(readSession(runtime.store, token, 0).liveTrading, "OFF");
  assert.equal(readSession(runtime.store, token, 999).ok, true);
  assert.equal(readSession(runtime.store, token, 1000).error, "session expired");

  runtime.setNow(0);
  const deniedRotate = await readJson(await postRotate(new Request("http://localhost/api/session/rotate", {
    method: "POST",
    headers: { cookie: cookiePair(token), [CSRF_HEADER]: "not-the-csrf" },
  }), runtime));
  assert.equal(deniedRotate.status, 403);
  assert.equal(readSession(runtime.store, token, 0).ok, true);

  const rotated = await readJson(await postRotate(new Request("http://localhost/api/session/rotate", {
    method: "POST",
    headers: { cookie: cookiePair(token), [CSRF_HEADER]: loggedIn.body.csrfToken },
  }), runtime));
  assert.equal(rotated.status, 200);
  assertSecureCookie(rotated.setCookie, { hasValue: true });
  const rotatedToken = rotated.setCookie.slice(SESSION_COOKIE_NAME.length + 1).split(";")[0];
  assert.notEqual(rotatedToken, token);
  assert.equal(readSession(runtime.store, token, 0).error, "session revoked");
  assert.equal(readSession(runtime.store, rotatedToken, 0).ok, true);
  assert.equal(JSON.stringify(rotated.body).includes(rotatedToken), false);
  assert.equal(JSON.stringify(rotated.body).includes(token), false);

  const oldCsrf = await readJson(await postLogout(new Request("http://localhost/api/session/logout", {
    method: "POST",
    headers: { cookie: cookiePair(rotatedToken), [CSRF_HEADER]: loggedIn.body.csrfToken },
  }), runtime));
  assert.equal(oldCsrf.status, 403);
  assert.equal(readSession(runtime.store, rotatedToken, 0).ok, true);

  const loggedOut = await readJson(await postLogout(new Request("http://localhost/api/session/logout", {
    method: "POST",
    headers: { cookie: cookiePair(rotatedToken), [CSRF_HEADER]: rotated.body.csrfToken },
  }), runtime));
  assert.equal(loggedOut.status, 200);
  const cleared = assertSecureCookie(loggedOut.setCookie, { hasValue: false });
  assert.equal(cleared.maxAge, "0");
  assert.equal(readSession(runtime.store, rotatedToken, 0).error, "session revoked");

  const again = await issueCsrf(runtime);
  const second = await loginRequest(runtime, { csrfToken: again });
  const secondToken = second.setCookie.slice(SESSION_COOKIE_NAME.length + 1).split(";")[0];
  const revoked = revokeSession(runtime.store, second.body.sessionPublicId, 0, runtime.log, second.body.correlationId);
  assert.equal(revoked.ok, true);
  assert.equal(readSession(runtime.store, secondToken, 0).error, "session revoked");
  const leaked = revokeSession(runtime.store, secondToken, 0, runtime.log);
  assert.equal(leaked.ok, false);

  for (const account of runtime.store.accounts.values()) {
    assert.equal(Object.hasOwn(account, "password"), false);
    assert.equal(JSON.stringify(account).includes(password), false);
  }
  for (const session of runtime.store.sessions.values()) {
    assert.equal(JSON.stringify(session).includes(token), false);
    assert.equal(JSON.stringify(session).includes(rotatedToken), false);
    assert.equal(JSON.stringify(session).includes(secondToken), false);
    assert.equal(JSON.stringify(session).includes(password), false);
  }
  assertSafeLog(runtime.log, [password, token, rotatedToken, secondToken, loggedIn.body.csrfToken, rotated.body.csrfToken, csrfToken]);
});

test("a presented session rotates on the next successful login and a bad password does not revoke it", async () => {
  const runtime = runtimeAt(0);
  createAccount(runtime.store, { loginId, password });
  const first = await loginRequest(runtime, { csrfToken: await issueCsrf(runtime) });
  const firstToken = first.setCookie.slice(SESSION_COOKIE_NAME.length + 1).split(";")[0];
  const failed = await loginRequest(runtime, {
    csrfToken: await issueCsrf(runtime),
    cookie: cookiePair(firstToken),
    body: { loginId, password: "wrong-password" },
  });
  assert.equal(failed.status, 401);
  assert.equal(readSession(runtime.store, firstToken, 0).ok, true);

  const second = await loginRequest(runtime, {
    csrfToken: await issueCsrf(runtime),
    cookie: cookiePair(firstToken),
  });
  assert.equal(second.status, 200);
  const secondToken = second.setCookie.slice(SESSION_COOKIE_NAME.length + 1).split(";")[0];
  assert.equal(readSession(runtime.store, firstToken, 0).error, "session revoked");
  assert.equal(readSession(runtime.store, secondToken, 0).ok, true);
  assertSafeLog(runtime.log, [password, firstToken, secondToken, first.body.csrfToken, second.body.csrfToken]);
});

test("unconfigured lifetime and unknown login fields fail closed without a cookie", async () => {
  const log = [];
  const runtime = { store: createSessionStore(), policy: { ttlMs: null }, now: () => 0, log };
  const closed = await loginRequest(runtime, { csrfToken: "challenge", body: { loginId, password } });
  assert.equal(closed.status, 503);
  assert.equal(closed.body.error, "session expiry is not configured");
  assert.equal(closed.setCookie, null);
  assert.equal(JSON.stringify(closed.body).includes(password), false);

  const extra = await loginRequest(runtimeAt(0), {
    body: { loginId, password, secret: password, liveTrading: "ON" },
  });
  assert.equal(extra.status, 400);
  assert.equal(extra.body.error, "unknown field");
  assert.equal(extra.setCookie, null);
  assert.equal(JSON.stringify(extra.body).includes(password), false);
  assert.equal(sessionRuntime.policy.ttlMs, null);
  assert.equal(sessionRuntime.policy.accountLimit, null);
  assert.equal(sessionRuntime.policy.ipLimit, null);
  assert.equal(sessionRuntime.policy.windowMs, null);
  assertSafeLog(log, [password, "challenge"]);
});
