import assert from "node:assert/strict";
import test from "node:test";
import { health } from "../apps/web/health.mjs";
import { getChecklistOwner } from "../apps/web/policy-http.mjs";
import {
  knownBuildSha,
  knownEnvironment,
  pageHealthEvent,
  recordPageHealth,
} from "../apps/web/page-health.mjs";
import { recordMissingPage, recordServerFailure, serverPageHealthEvents } from "../apps/web/page-health-server.mjs";
import { CORRELATION_HEADER, SECTION_HEADER } from "../apps/web/request-correlation.mjs";
import { postLogin, sessionRuntime } from "../apps/web/session-http.mjs";
import { getViewState, postViewState } from "../apps/web/view-state-http.mjs";

const password = "super-secret-value";
const token = "raw-token-secret";
const buildSha = "deadbeef";
const missingId = "11111111-1111-4111-8111-111111111111";
const clientId = "22222222-2222-4222-8222-222222222222";
const readId = "33333333-3333-4333-8333-333333333333";
const serverId = "44444444-4444-4444-8444-444444444444";
const loginId = "55555555-5555-4555-8555-555555555555";
const okId = "66666666-6666-4666-8666-666666666666";

function assertShape(event) {
  assert.deepEqual(Object.keys(event).sort(), [
    "buildSha",
    "environment",
    "exception",
    "httpStatus",
    "requestId",
    "routeViewId",
    "viewId",
  ]);
}

function assertNoSecrets(value, secrets = [password, token, "account-1"]) {
  const text = JSON.stringify(value);
  for (const secret of secrets) assert.equal(text.includes(secret), false);
}

test("a missing page, a 4xx, and a 5xx each produce a closed health event", async () => {
  const sink = [];
  const missing = recordMissingPage({
    requestId: missingId,
    path: `/missing/${password}`,
    token,
    form: { password, token },
    buildSha,
    environment: "local",
  }, sink);
  assert.equal(missing.routeViewId, "missing-page");
  assert.equal(missing.viewId, "missing-page");
  assert.equal(missing.httpStatus, 404);
  assert.equal(missing.exception, null);
  assert.equal(missing.requestId, missingId);
  assert.equal(missing.buildSha, buildSha);
  assert.equal(missing.environment, "local");
  assertShape(missing);
  assertNoSecrets(missing);

  const denied = await getViewState(new Request("http://localhost/api/view-state?pageSize=" + password, {
    headers: {
      [CORRELATION_HEADER]: clientId,
      [SECTION_HEADER]: "Checklist",
    },
  }));
  assert.equal(denied.status, 400);
  const missed = serverPageHealthEvents.find((event) => event.requestId === clientId);
  assert.equal(missed.routeViewId, "/api/view-state");
  assert.equal(missed.viewId, "Checklist");
  assert.equal(missed.httpStatus, 400);
  assert.equal(missed.exception, null);
  assertShape(missed);
  assertNoSecrets(missed, [password, token]);
  assertNoSecrets(await denied.json(), [password, token]);

  const unread = await getChecklistOwner(new Request(`http://localhost/api/checklist-owner?recordId=${token}`, {
    headers: {
      [CORRELATION_HEADER]: readId,
      [SECTION_HEADER]: password,
    },
  }));
  assert.equal(unread.status, 401);
  const readEvent = serverPageHealthEvents.find((event) => event.requestId === readId);
  assert.equal(readEvent.routeViewId, "/api/checklist-owner");
  assert.equal(readEvent.viewId, null);
  assert.equal(readEvent.httpStatus, 401);
  assertNoSecrets(readEvent);
  assert.deepEqual(await unread.json(), { ok: false, error: "login denied" });

  const failed = recordServerFailure({
    routeViewId: "/api/view-state",
    viewId: "Dashboard",
    httpStatus: 500,
    requestId: serverId,
    body: { password, token },
    message: password,
  }, sink);
  assert.equal(failed.httpStatus, 500);
  assert.equal(failed.routeViewId, "/api/view-state");
  assert.equal(failed.viewId, "Dashboard");
  assert.equal(failed.exception, null);
  assert.equal(failed.requestId, serverId);
  assertShape(failed);
  assertNoSecrets(failed);

  const login = await postLogin(new Request("http://localhost/api/session/login", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      [CORRELATION_HEADER]: loginId,
    },
    body: JSON.stringify({ loginId: "account-1", password }),
  }), sessionRuntime);
  assert.equal(login.status, 503);
  const loginEvent = serverPageHealthEvents.find((event) => event.requestId === loginId);
  assert.equal(loginEvent.routeViewId, "/api/session/login");
  assert.equal(loginEvent.httpStatus, 503);
  assert.equal(loginEvent.exception, null);
  assert.equal(loginEvent.buildSha, null);
  assert.equal(loginEvent.environment, knownEnvironment(process.env.APP_ENV));
  assertShape(loginEvent);
  assertNoSecrets(loginEvent);
  assertNoSecrets(await login.json());
});

test("a JavaScript exception is recorded without its message, stack, or form body", () => {
  const thrown = new Error(password);
  thrown.stack = `${password}\n${token}`;
  const event = pageHealthEvent({
    routeViewId: "section-render",
    viewId: "Dashboard",
    httpStatus: null,
    exception: thrown,
    requestId: password,
    buildSha: password,
    environment: token,
    form: { loginId: "account-1", password, token },
    authorization: token,
  });
  assert.equal(event.routeViewId, "section-render");
  assert.equal(event.viewId, "Dashboard");
  assert.equal(event.httpStatus, null);
  assert.equal(event.exception, "js-exception");
  assert.notEqual(event.requestId, password);
  assert.match(event.requestId, /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
  assert.equal(event.buildSha, null);
  assert.equal(event.environment, null);
  assertShape(event);
  assertNoSecrets(event);
  assert.throws(() => {
    event.password = password;
  });
  const stored = [];
  recordPageHealth({
    routeViewId: "section-render",
    viewId: "Market",
    exception: true,
    requestId: clientId,
    buildSha,
    environment: "test",
  }, stored);
  assert.equal(stored[0].exception, "js-exception");
  assert.equal(stored[0].viewId, "Market");
  assert.equal(stored[0].buildSha, buildSha);
  assert.equal(stored[0].environment, "test");
});

test("a successful API call adds no health event and unknown values stay empty", async () => {
  const before = serverPageHealthEvents.length;
  const ok = await getViewState(new Request("http://localhost/api/view-state?pageSize=2", {
    headers: { [CORRELATION_HEADER]: okId, [SECTION_HEADER]: "Dashboard" },
  }));
  assert.equal(ok.status, 200);
  assert.equal(serverPageHealthEvents.some((event) => event.requestId === okId), false);
  assert.equal(serverPageHealthEvents.length, before);

  const marker = serverPageHealthEvents.length;
  const posted = await postViewState(new Request("http://localhost/api/view-state", {
    method: "POST",
    headers: { "content-type": "application/json", [CORRELATION_HEADER]: password },
    body: JSON.stringify({ password, token, form: { password } }),
  }));
  assert.equal(posted.status, 400);
  const postedEvent = serverPageHealthEvents[marker];
  assert.equal(postedEvent.routeViewId, "/api/view-state");
  assert.notEqual(postedEvent.requestId, password);
  assertNoSecrets(postedEvent);
  assertNoSecrets(await posted.json());

  assert.equal(knownEnvironment("local"), "local");
  assert.equal(knownEnvironment("test"), "test");
  assert.equal(knownEnvironment("staging"), "staging");
  assert.equal(knownEnvironment(password), null);
  assert.equal(knownEnvironment(undefined), null);
  assert.equal(knownBuildSha(buildSha), buildSha);
  assert.equal(knownBuildSha(password), null);
  assert.equal(knownBuildSha("abc123"), null);
  assert.equal(pageHealthEvent({ routeViewId: `/api/session/login?token=${token}`, httpStatus: token }).routeViewId, null);
  assert.equal(pageHealthEvent({ httpStatus: token }).httpStatus, null);
  assert.equal(health.liveTrading, "OFF");
  assert.equal(health.liveOrdersLocked, true);
  assert.equal(sessionRuntime.policy.ttlMs, null);
});

test("APP_ENV is kept only when it is one of the named environments", () => {
  const previous = process.env.APP_ENV;
  try {
    process.env.APP_ENV = "staging";
    const named = recordServerFailure({
      routeViewId: "/api/session",
      httpStatus: 401,
      requestId: serverId,
    }, []);
    assert.equal(named.environment, "staging");
    assert.equal(named.buildSha, null);
    process.env.APP_ENV = password;
    const rejected = recordServerFailure({
      routeViewId: "/api/session",
      httpStatus: 401,
      requestId: serverId,
      buildSha: token,
    }, []);
    assert.equal(rejected.environment, null);
    assert.equal(rejected.buildSha, null);
    assertNoSecrets(rejected);
  } finally {
    if (previous === undefined) delete process.env.APP_ENV;
    else process.env.APP_ENV = previous;
  }
});
