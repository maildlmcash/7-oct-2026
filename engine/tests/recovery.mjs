import assert from "node:assert/strict";
import test from "node:test";
import { health } from "../apps/web/health.mjs";
import { getCsrf, getSession, postLogin, postOtp, postResend, postReset, postResetConfirm } from "../apps/web/session-http.mjs";
import {
  CLIENT_IP_HEADER,
  CSRF_HEADER,
  SESSION_COOKIE_NAME,
  createAccount,
  createSessionStore,
} from "../services/session.mjs";

const password = "super-secret-value";
const nextPassword = "next-secret-value";
const loginId = "account-1";
const hiddenLogin = "hidden-account-secret";
const ipSecret = "ip-secret-value";

function runtimeAt() {
  let now = 0;
  return {
    store: createSessionStore(),
    // Lifetimes and limits are test fixtures. The source names none.
    policy: {
      ttlMs: 10000,
      resetTtlMs: 1000,
      resendTtlMs: 1000,
      accountLimit: 10,
      ipLimit: 10,
      windowMs: 5000,
    },
    log: [],
    audit: [],
    delivery: [],
    now: () => now,
    setNow(value) {
      now = value;
    },
  };
}

function assertRedacted(value, secrets) {
  const text = JSON.stringify(value);
  for (const secret of secrets) assert.equal(text.includes(secret), false);
}

function assertAudit(audit, secrets) {
  assertRedacted(audit, secrets);
  for (const event of audit) {
    assert.deepEqual(Object.keys(event).sort(), ["action", "correlationId", "result", "subjectId"]);
  }
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

function postJson(url, { csrfToken, ip, body }) {
  const headers = { "content-type": "application/json", [CSRF_HEADER]: csrfToken };
  if (ip) headers[CLIENT_IP_HEADER] = ip;
  return new Request(url, { method: "POST", headers, body: JSON.stringify(body) });
}

async function send(runtime, path, body, ip) {
  const poster = path.endsWith("/resend") ? postResend : postReset;
  return readJson(await poster(postJson(`http://localhost${path}`, {
    csrfToken: await csrf(runtime),
    ip,
    body,
  }), runtime));
}

test("reset and otp tokens expire, replay, and stay out of the audit", async () => {
  const runtime = runtimeAt();
  createAccount(runtime.store, { loginId, password });
  const reset = await send(runtime, "/api/session/reset", { loginId }, "198.51.100.10");
  assert.equal(reset.status, 200);
  assert.equal(reset.body.ok, true);
  assert.equal(runtime.delivery.length, 1);
  const resetToken = runtime.delivery[0].token;
  assert.equal(typeof resetToken, "string");
  assertRedacted(reset.body, [password, resetToken, loginId]);

  runtime.setNow(1000);
  const expired = await readJson(await postResetConfirm(postJson("http://localhost/api/session/reset/confirm", {
    csrfToken: await csrf(runtime),
    body: { token: resetToken, password: nextPassword },
  }), runtime));
  assert.equal(expired.status, 401);
  assert.equal(expired.body.error, "reset denied");
  assert.equal(runtime.audit.at(-1).result, "expired");
  assertRedacted(expired.body, [password, nextPassword, resetToken]);

  runtime.setNow(0);
  const again = await send(runtime, "/api/session/reset", { loginId }, "198.51.100.11");
  const liveToken = runtime.delivery.at(-1).token;
  const confirmed = await readJson(await postResetConfirm(postJson("http://localhost/api/session/reset/confirm", {
    csrfToken: await csrf(runtime),
    body: { token: liveToken, password: nextPassword },
  }), runtime));
  assert.equal(confirmed.status, 200);
  assert.equal(confirmed.body.liveTrading, "OFF");
  assert.equal(confirmed.body.liveOrdersLocked, true);
  assert.equal(confirmed.body.liveTrading, health.liveTrading);
  assertRedacted(confirmed.body, [password, nextPassword, liveToken]);

  const replayed = await readJson(await postResetConfirm(postJson("http://localhost/api/session/reset/confirm", {
    csrfToken: await csrf(runtime),
    body: { token: liveToken, password: "later-secret-value" },
  }), runtime));
  assert.equal(replayed.status, 401);
  assert.equal(replayed.body.error, "reset denied");
  assert.equal(runtime.audit.at(-1).result, "replayed");
  assertRedacted(replayed.body, [liveToken, "later-secret-value"]);

  const oldLogin = await readJson(await postLogin(postJson("http://localhost/api/session/login", {
    csrfToken: await csrf(runtime),
    ip: "192.0.2.40",
    body: { loginId, password },
  }), runtime));
  assert.equal(oldLogin.status, 401);
  const newLogin = await readJson(await postLogin(postJson("http://localhost/api/session/login", {
    csrfToken: await csrf(runtime),
    ip: "192.0.2.40",
    body: { loginId, password: nextPassword },
  }), runtime));
  assert.equal(newLogin.status, 200);

  const firstOtp = await send(runtime, "/api/session/resend", { loginId }, "198.51.100.20");
  assert.equal(firstOtp.body.ok, true);
  const oldOtp = runtime.delivery.at(-1).token;
  const secondOtp = await send(runtime, "/api/session/resend", { loginId }, "198.51.100.21");
  const otp = runtime.delivery.at(-1).token;
  assert.notEqual(otp, oldOtp);
  const replaced = await readJson(await postOtp(postJson("http://localhost/api/session/otp", {
    csrfToken: await csrf(runtime),
    body: { otp: oldOtp },
  }), runtime));
  assert.equal(replaced.status, 401);
  assert.equal(runtime.audit.at(-1).result, "replayed");

  const used = await readJson(await postOtp(postJson("http://localhost/api/session/otp", {
    csrfToken: await csrf(runtime),
    body: { otp },
  }), runtime));
  assert.equal(used.status, 200);
  assert.equal(used.body.liveTrading, "OFF");
  const otpReplay = await readJson(await postOtp(postJson("http://localhost/api/session/otp", {
    csrfToken: await csrf(runtime),
    body: { otp },
  }), runtime));
  assert.equal(otpReplay.status, 401);
  assert.equal(runtime.audit.at(-1).result, "replayed");

  runtime.setNow(1000);
  const fresh = await send(runtime, "/api/session/resend", { loginId }, "198.51.100.22");
  assert.equal(fresh.status, 200);
  const expiringOtp = runtime.delivery.at(-1).token;
  runtime.setNow(2000);
  const otpExpired = await readJson(await postOtp(postJson("http://localhost/api/session/otp", {
    csrfToken: await csrf(runtime),
    body: { otp: expiringOtp },
  }), runtime));
  assert.equal(otpExpired.status, 401);
  assert.equal(runtime.audit.at(-1).result, "expired");

  for (const record of runtime.store.recovery.values()) {
    assert.equal(JSON.stringify(record).includes(resetToken), false);
    assert.equal(JSON.stringify(record).includes(liveToken), false);
    assert.equal(JSON.stringify(record).includes(otp), false);
    assert.equal(JSON.stringify(record).includes(password), false);
  }
  assertAudit(runtime.audit, [password, nextPassword, resetToken, liveToken, otp, oldOtp, expiringOtp, hiddenLogin, ipSecret]);
  assertRedacted(runtime.log, [password, nextPassword, resetToken, liveToken, otp]);
});

test("resend throttles by account and by IP without changing the public response", async () => {
  const runtime = runtimeAt();
  runtime.policy.accountLimit = 2;
  runtime.policy.ipLimit = 5;
  createAccount(runtime.store, { loginId, password });
  createAccount(runtime.store, { loginId: "account-2", password });
  const ips = ["198.51.100.1", "198.51.100.2", "198.51.100.3"];
  const responses = [];
  for (const ip of ips) {
    responses.push(await send(runtime, "/api/session/resend", { loginId }, ip));
  }
  assert.deepEqual(responses.map((response) => [response.status, response.body.ok, response.body.error ?? null]), [
    [200, true, null],
    [200, true, null],
    [200, true, null],
  ]);
  assert.equal(runtime.delivery.length, 2);
  assert.equal(runtime.audit.at(-1).result, "throttled");
  runtime.setNow(5000);
  const cooled = await send(runtime, "/api/session/resend", { loginId }, "198.51.100.4");
  assert.equal(cooled.status, 200);
  assert.equal(runtime.delivery.length, 3);

  runtime.policy.accountLimit = 5;
  runtime.policy.ipLimit = 2;
  const before = runtime.delivery.length;
  const sharedIp = "198.51.100.50";
  for (const id of [loginId, "account-2", "account-3"]) {
    const response = await send(runtime, "/api/session/resend", { loginId: id }, sharedIp);
    assert.equal(response.status, 200);
    assert.equal(response.body.ok, true);
  }
  assert.equal(runtime.delivery.length, before + 2);
  assert.equal(runtime.audit.at(-1).result, "throttled");

  runtime.policy.accountLimit = 1;
  const resetBefore = runtime.delivery.filter((item) => item.kind === "reset").length;
  const firstReset = await send(runtime, "/api/session/reset", { loginId }, "203.0.113.1");
  const secondReset = await send(runtime, "/api/session/reset", { loginId }, "203.0.113.2");
  assert.equal(firstReset.status, 200);
  assert.equal(secondReset.status, 200);
  assert.equal(secondReset.body.ok, true);
  assert.equal(runtime.delivery.filter((item) => item.kind === "reset").length, resetBefore + 1);
  assert.equal(runtime.audit.at(-1).result, "throttled");
  assertAudit(runtime.audit, [password, ipSecret, hiddenLogin]);
  assert.equal(JSON.stringify([...runtime.store.throttle.keys()]).includes(sharedIp), false);
});

test("known and unknown accounts get the same reset response and secrets stay redacted", async () => {
  const runtime = runtimeAt();
  createAccount(runtime.store, { loginId, password });
  const known = await send(runtime, "/api/session/reset", { loginId }, "203.0.113.10");
  const unknown = await send(runtime, "/api/session/reset", { loginId: hiddenLogin }, ipSecret);
  assert.equal(known.status, unknown.status);
  assert.equal(known.body.ok, unknown.body.ok);
  assert.equal(known.body.error, unknown.body.error);
  assert.equal(runtime.delivery.length, 1);
  assertRedacted(known.body, [password, runtime.delivery[0].token]);
  assertRedacted(unknown.body, [password, hiddenLogin, ipSecret]);
  assertAudit(runtime.audit, [password, hiddenLogin, ipSecret, runtime.delivery[0].token]);

  const planted = await readJson(await postReset(postJson("http://localhost/api/session/reset", {
    csrfToken: await csrf(runtime),
    ip: "203.0.113.11",
    body: { loginId, secret: password, liveTrading: "ON" },
  }), runtime));
  assert.equal(planted.status, 400);
  assert.equal(planted.body.error, "unknown field");
  assertRedacted(planted.body, [password]);

  const closed = runtimeAt();
  closed.policy = { ttlMs: null, resetTtlMs: null, resendTtlMs: null, accountLimit: null, ipLimit: null, windowMs: null };
  const closedKnown = await readJson(await postReset(postJson("http://localhost/api/session/reset", {
    csrfToken: "unused",
    ip: "203.0.113.12",
    body: { loginId },
  }), closed));
  const closedUnknown = await readJson(await postReset(postJson("http://localhost/api/session/reset", {
    csrfToken: "unused",
    ip: "203.0.113.13",
    body: { loginId: hiddenLogin },
  }), closed));
  assert.equal(closedKnown.status, 503);
  assert.equal(closedUnknown.status, 503);
  assert.equal(closedKnown.body.error, "reset is not configured");
  assert.equal(closedUnknown.body.error, closedKnown.body.error);
  assert.equal(closed.delivery.length, 0);
  assertRedacted(closedKnown.body, [password, hiddenLogin]);

  const sessionRuntime = runtimeAt();
  createAccount(sessionRuntime.store, { loginId, password });
  const loggedIn = await readJson(await postLogin(postJson("http://localhost/api/session/login", {
    csrfToken: await csrf(sessionRuntime),
    ip: "192.0.2.41",
    body: { loginId, password },
  }), sessionRuntime));
  const sessionToken = loggedIn.setCookie.slice(`${SESSION_COOKIE_NAME}=`.length).split(";")[0];
  const issued = await send(sessionRuntime, "/api/session/reset", { loginId }, "203.0.113.20");
  assert.equal(issued.status, 200);
  const token = sessionRuntime.delivery.at(-1).token;
  const changed = await readJson(await postResetConfirm(postJson("http://localhost/api/session/reset/confirm", {
    csrfToken: await csrf(sessionRuntime),
    body: { token, password: nextPassword },
  }), sessionRuntime));
  assert.equal(changed.status, 200);
  const current = await readJson(getSession(new Request("http://localhost/api/session", {
    headers: { cookie: `${SESSION_COOKIE_NAME}=${sessionToken}` },
  }), sessionRuntime));
  assert.equal(current.status, 401);
  assert.equal(current.body.error, "session revoked");
  assertRedacted(sessionRuntime.audit, [password, nextPassword, token, sessionToken]);
});
