import { isDeskRole } from "./desk-roles.mjs";
import {
  beginLogin,
  createAccount,
  createSessionStore,
  login,
  logout,
  readSession,
} from "./session.mjs";

// Paper-desk identities only. These are not exchange accounts and cannot place orders.
export const DESK_ACCOUNTS = Object.freeze([
  Object.freeze({ loginId: "user", password: "user-paper-1", role: "User" }),
  Object.freeze({ loginId: "admin", password: "admin-paper-1", role: "Admin" }),
]);

const POLICY = Object.freeze({
  ttlMs: 8 * 60 * 60 * 1000,
  accountLimit: 30,
  ipLimit: 120,
  windowMs: 15 * 60 * 1000,
});

export const deskRuntime = {
  store: createSessionStore(),
  policy: POLICY,
  log: [],
  now: () => Date.now(),
};

const actors = new Map();
const csrfBySubject = new Map();

for (const account of DESK_ACCOUNTS) {
  const created = createAccount(deskRuntime.store, {
    loginId: account.loginId,
    password: account.password,
  });
  if (!created.ok) throw new Error(created.error);
  actors.set(created.subjectId, { loginId: account.loginId, role: account.role });
}

function actorFor(subjectId) {
  const actor = actors.get(subjectId);
  if (!actor || !isDeskRole(actor.role)) return null;
  return actor;
}

export function deskCsrf() {
  return beginLogin(deskRuntime.store, {
    now: deskRuntime.now(),
    policy: deskRuntime.policy,
    log: deskRuntime.log,
  });
}

export function deskLogin(input) {
  const result = login(deskRuntime.store, {
    loginId: input?.loginId,
    password: input?.password,
    csrfToken: input?.csrfToken,
    existingToken: input?.existingToken,
    ip: typeof input?.ip === "string" && input.ip.length > 0 ? input.ip : "preview",
    now: deskRuntime.now(),
    policy: deskRuntime.policy,
    log: deskRuntime.log,
  });
  if (!result.ok) return result;
  const session = readSession(deskRuntime.store, result.token, deskRuntime.now());
  const actor = session.ok ? actorFor(session.subjectId) : null;
  if (!actor) return { ok: false, error: "login denied" };
  csrfBySubject.set(session.subjectId, result.csrfToken);
  return {
    ok: true,
    role: actor.role,
    loginId: actor.loginId,
    csrfToken: result.csrfToken,
    sessionPublicId: result.sessionPublicId,
    expiresAt: result.expiresAt,
    setCookie: result.setCookie,
    token: result.token,
    liveTrading: result.liveTrading,
    liveOrdersLocked: result.liveOrdersLocked,
  };
}

export function deskRead(token) {
  const result = readSession(deskRuntime.store, token, deskRuntime.now());
  if (!result.ok) return result;
  const actor = actorFor(result.subjectId);
  if (!actor) return { ok: false, error: "login denied" };
  return {
    ok: true,
    role: actor.role,
    loginId: actor.loginId,
    csrfToken: csrfBySubject.get(result.subjectId) ?? null,
    sessionPublicId: result.sessionPublicId,
    expiresAt: result.expiresAt,
    liveTrading: result.liveTrading,
    liveOrdersLocked: result.liveOrdersLocked,
  };
}

export function deskLogout(input) {
  const current = readSession(deskRuntime.store, input?.token, deskRuntime.now());
  const result = logout(deskRuntime.store, {
    token: input?.token,
    csrfToken: input?.csrfToken,
    now: deskRuntime.now(),
    log: deskRuntime.log,
  });
  if (result.ok && current.ok) csrfBySubject.delete(current.subjectId);
  return result;
}
