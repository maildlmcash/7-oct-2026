import assert from "node:assert/strict";
import test from "node:test";
import { getDeskCsrf, getDeskSession, postDeskLogin, postDeskLogout } from "../apps/web/desk-http.mjs";
import { sessionRuntime } from "../apps/web/session-http.mjs";
import { CSRF_HEADER, SESSION_COOKIE_NAME } from "../services/session.mjs";

function tokenFrom(setCookie) {
  return setCookie.slice(SESSION_COOKIE_NAME.length + 1).split(";")[0];
}

async function csrf() {
  const response = await getDeskCsrf(new Request("http://localhost/api/desk/csrf"));
  const body = await response.json();
  assert.equal(response.status, 200);
  return body.csrfToken;
}

async function signIn(loginId, password, csrfToken = csrf()) {
  const challenge = await csrfToken;
  const response = await postDeskLogin(new Request("http://localhost/api/desk/login", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      [CSRF_HEADER]: challenge,
    },
    body: JSON.stringify({ loginId, password }),
  }));
  const body = await response.json();
  return { status: response.status, body, setCookie: response.headers.get("set-cookie") };
}

test("user and admin desk logins stay role-scoped and do not unlock the fail-closed session policy", async () => {
  const user = await signIn("user", "user-paper-1");
  assert.equal(user.status, 200);
  assert.equal(user.body.role, "User");
  assert.equal(user.body.loginId, "user");
  assert.equal(user.body.liveTrading, "OFF");
  assert.equal(user.body.liveOrdersLocked, true);
  assert.equal(JSON.stringify(user.body).includes("user-paper-1"), false);
  assert.equal(JSON.stringify(user.body).includes(tokenFrom(user.setCookie)), false);

  const userSession = await getDeskSession(new Request("http://localhost/api/desk/session", {
    headers: { cookie: `${SESSION_COOKIE_NAME}=${tokenFrom(user.setCookie)}` },
  }));
  assert.equal((await userSession.json()).role, "User");

  const wrong = await signIn("admin", "user-paper-1");
  assert.equal(wrong.status, 401);
  assert.equal(wrong.body.error, "login denied");

  const admin = await signIn("admin", "admin-paper-1");
  assert.equal(admin.status, 200);
  assert.equal(admin.body.role, "Admin");
  assert.equal(admin.body.loginId, "admin");
  assert.notEqual(admin.body.role, "User");

  const forged = await postDeskLogin(new Request("http://localhost/api/desk/login", {
    method: "POST",
    headers: { "content-type": "application/json", [CSRF_HEADER]: await csrf() },
    body: JSON.stringify({ loginId: "admin", password: "admin-paper-1", role: "Super Admin" }),
  }));
  assert.equal(forged.status, 400);

  const loggedOut = await postDeskLogout(new Request("http://localhost/api/desk/logout", {
    method: "POST",
    headers: {
      cookie: `${SESSION_COOKIE_NAME}=${tokenFrom(admin.setCookie)}`,
      [CSRF_HEADER]: admin.body.csrfToken,
    },
  }));
  assert.equal(loggedOut.status, 200);
  const after = await getDeskSession(new Request("http://localhost/api/desk/session", {
    headers: { cookie: `${SESSION_COOKIE_NAME}=${tokenFrom(admin.setCookie)}` },
  }));
  assert.equal(after.status, 200);
  assert.equal((await after.json()).ok, false);

  assert.equal(sessionRuntime.policy.ttlMs, null);
  assert.equal(sessionRuntime.store.accounts.size, 0);
});
