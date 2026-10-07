import { recordServerFailure } from "./page-health-server.mjs";
import { CORRELATION_HEADER, resolveCorrelationId } from "./request-correlation.mjs";
import {
  CLIENT_IP_HEADER,
  CSRF_HEADER,
  SESSION_COOKIE_NAME,
  allowSensitiveRead,
  beginLogin,
  confirmOtp,
  confirmReset,
  createSessionStore,
  login,
  logout,
  publicRateAlerts,
  rateLimitCounters,
  readCookie,
  readSession,
  requestResend,
  requestReset,
  rotateSession,
} from "../../services/session.mjs";

const LOGIN_FIELDS = ["loginId", "password"];

// The source names no session lifetime. Login fails closed until a server policy supplies one.
export const sessionRuntime = {
  store: createSessionStore(),
  // The source names no lifetime and no throttle counts. Login, reset, resend, and sensitive reads fail closed until set.
  policy: {
    ttlMs: null,
    resetTtlMs: null,
    resendTtlMs: null,
    accountLimit: null,
    ipLimit: null,
    windowMs: null,
  },
  now: () => Date.now(),
  log: null,
  audit: null,
  // Throttle alerts only. Password, OTP, and raw token are not fields.
  alerts: [],
  delivery: null,
  // The source names no identity provider. Privileged writes fail closed until one is set.
  mfaProvider: null,
  privilegedAudit: [],
};

function plainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function correlationIdFrom(request) {
  return resolveCorrelationId(request.headers.get(CORRELATION_HEADER));
}

function json(body, status, correlationId, setCookie, routeViewId) {
  if (Number.isInteger(status) && status >= 400) {
    recordServerFailure({
      routeViewId,
      httpStatus: status,
      requestId: correlationId,
    });
  }
  const headers = {
    [CORRELATION_HEADER]: correlationId,
    "cache-control": "no-store",
  };
  if (setCookie) headers["set-cookie"] = setCookie;
  return Response.json({ ...body, correlationId }, { status, headers });
}

function statusFor(result) {
  if (result.ok) return 200;
  if (result.error === "unknown field") return 400;
  if (result.error === "session expiry is not configured" || result.error === "rate limit is not configured") return 503;
  if (result.error === "csrf denied") return 403;
  // The source names no throttle status. A denied sensitive read uses 429.
  if (result.error === "rate limit denied") return 429;
  return 401;
}

function publicBody(result) {
  const body = { ok: result.ok };
  if (!result.ok) {
    body.error = result.error;
    return body;
  }
  if (typeof result.csrfToken === "string") body.csrfToken = result.csrfToken;
  if (typeof result.expiresAt === "number") body.expiresAt = result.expiresAt;
  if (typeof result.sessionPublicId === "string") body.sessionPublicId = result.sessionPublicId;
  if (typeof result.liveTrading === "string") body.liveTrading = result.liveTrading;
  if (typeof result.liveOrdersLocked === "boolean") body.liveOrdersLocked = result.liveOrdersLocked;
  return body;
}

function cookieToken(request) {
  return readCookie(request.headers.get("cookie"), SESSION_COOKIE_NAME);
}

async function readBody(request) {
  try {
    return { ok: true, body: await request.json() };
  } catch {
    return { ok: false };
  }
}

function unknownLoginFields(body) {
  if (!plainObject(body)) return true;
  for (const key of Object.keys(body)) {
    if (!LOGIN_FIELDS.includes(key)) return true;
  }
  return false;
}

export function getCsrf(request, runtime = sessionRuntime) {
  const correlationId = correlationIdFrom(request);
  const result = beginLogin(runtime.store, {
    now: runtime.now(),
    policy: runtime.policy,
    log: runtime.log,
    correlationId,
  });
  return json(publicBody(result), statusFor(result), correlationId, null, "/api/session/csrf");
}

export async function postLogin(request, runtime = sessionRuntime) {
  const correlationId = correlationIdFrom(request);
  const parsed = await readBody(request);
  if (!parsed.ok || unknownLoginFields(parsed.body)) {
    return json({ ok: false, error: parsed.ok ? "unknown field" : "login denied" }, 400, correlationId, null, "/api/session/login");
  }
  const result = login(runtime.store, {
    loginId: parsed.body.loginId,
    password: parsed.body.password,
    csrfToken: request.headers.get(CSRF_HEADER),
    existingToken: cookieToken(request),
    ip: request.headers.get(CLIENT_IP_HEADER),
    now: runtime.now(),
    policy: runtime.policy,
    log: runtime.log,
    alerts: runtime.alerts,
    correlationId,
  });
  return json(publicBody(result), statusFor(result), correlationId, result.setCookie, "/api/session/login");
}

export async function postLogout(request, runtime = sessionRuntime) {
  const correlationId = correlationIdFrom(request);
  if (request.headers.get("content-type")) {
    const parsed = await readBody(request);
    if (!parsed.ok) return json({ ok: false, error: "login denied" }, 400, correlationId, null, "/api/session/logout");
    if (plainObject(parsed.body) && Object.keys(parsed.body).length > 0) {
      return json({ ok: false, error: "unknown field" }, 400, correlationId, null, "/api/session/logout");
    }
  }
  const result = logout(runtime.store, {
    token: cookieToken(request),
    csrfToken: request.headers.get(CSRF_HEADER),
    now: runtime.now(),
    log: runtime.log,
    correlationId,
  });
  const setCookie = result.ok ? result.clearCookie : null;
  return json(publicBody(result), statusFor(result), correlationId, setCookie, "/api/session/logout");
}

export async function postRotate(request, runtime = sessionRuntime) {
  const correlationId = correlationIdFrom(request);
  if (request.headers.get("content-type")) {
    const parsed = await readBody(request);
    if (!parsed.ok) return json({ ok: false, error: "login denied" }, 400, correlationId, null, "/api/session/rotate");
    if (plainObject(parsed.body) && Object.keys(parsed.body).length > 0) {
      return json({ ok: false, error: "unknown field" }, 400, correlationId, null, "/api/session/rotate");
    }
  }
  const result = rotateSession(runtime.store, {
    token: cookieToken(request),
    csrfToken: request.headers.get(CSRF_HEADER),
    now: runtime.now(),
    policy: runtime.policy,
    log: runtime.log,
    correlationId,
  });
  return json(publicBody(result), statusFor(result), correlationId, result.setCookie, "/api/session/rotate");
}

function gateSensitiveRead(request, runtime, session, correlationId) {
  return allowSensitiveRead(runtime.store, {
    subjectId: session.subjectId,
    ip: request.headers.get(CLIENT_IP_HEADER),
    now: runtime.now(),
    policy: runtime.policy,
    alerts: runtime.alerts,
    correlationId,
  });
}

export function getSession(request, runtime = sessionRuntime) {
  const correlationId = correlationIdFrom(request);
  const result = readSession(runtime.store, cookieToken(request), runtime.now());
  if (!result.ok) return json(publicBody(result), statusFor(result), correlationId, null, "/api/session");
  const gate = gateSensitiveRead(request, runtime, result, correlationId);
  if (!gate.ok) return json({ ok: false, error: gate.error }, statusFor(gate), correlationId, null, "/api/session");
  return json(publicBody(result), statusFor(result), correlationId, null, "/api/session");
}

export function getRateLimits(request, runtime = sessionRuntime) {
  const correlationId = correlationIdFrom(request);
  const result = readSession(runtime.store, cookieToken(request), runtime.now());
  if (!result.ok) return json(publicBody(result), statusFor(result), correlationId, null, "/api/session/limits");
  const gate = gateSensitiveRead(request, runtime, result, correlationId);
  if (!gate.ok) return json({ ok: false, error: gate.error }, statusFor(gate), correlationId, null, "/api/session/limits");
  return json({
    ok: true,
    counters: rateLimitCounters(runtime.store),
    alerts: publicRateAlerts(runtime.alerts, result.subjectId),
  }, 200, correlationId, null, "/api/session/limits");
}

const RESET_FIELDS = ["loginId"];
const CONFIRM_FIELDS = ["token", "password"];
const OTP_FIELDS = ["otp"];

function unknownFields(body, allowed) {
  if (!plainObject(body)) return true;
  for (const key of Object.keys(body)) {
    if (!allowed.includes(key)) return true;
  }
  return false;
}

function recoveryStatus(result) {
  if (result.ok) return 200;
  if (result.error === "unknown field") return 400;
  if (result.error === "login denied") return 400;
  if (result.error === "reset is not configured") return 503;
  if (result.error === "csrf denied") return 403;
  return 401;
}

function publicRecovery(result) {
  if (!result.ok) {
    let error = "reset denied";
    if (
      result.error === "unknown field"
      || result.error === "login denied"
      || result.error === "reset is not configured"
      || result.error === "csrf denied"
    ) {
      error = result.error;
    }
    return { ok: false, error };
  }
  const body = { ok: true };
  if (typeof result.liveTrading === "string") body.liveTrading = result.liveTrading;
  if (typeof result.liveOrdersLocked === "boolean") body.liveOrdersLocked = result.liveOrdersLocked;
  return body;
}

async function postRecovery(request, runtime, allowed, run, routeViewId) {
  const correlationId = correlationIdFrom(request);
  const parsed = await readBody(request);
  if (!parsed.ok) return json({ ok: false, error: "login denied" }, 400, correlationId, null, routeViewId);
  if (unknownFields(parsed.body, allowed)) return json({ ok: false, error: "unknown field" }, 400, correlationId, null, routeViewId);
  const result = run(parsed.body, correlationId);
  return json(publicRecovery(result), recoveryStatus(result), correlationId, null, routeViewId);
}

export function postReset(request, runtime = sessionRuntime) {
  return postRecovery(request, runtime, RESET_FIELDS, (body, correlationId) => requestReset(runtime.store, {
    loginId: body.loginId,
    csrfToken: request.headers.get(CSRF_HEADER),
    ip: request.headers.get(CLIENT_IP_HEADER),
    now: runtime.now(),
    policy: runtime.policy,
    audit: runtime.audit,
    alerts: runtime.alerts,
    delivery: runtime.delivery,
    correlationId,
  }), "/api/session/reset");
}

export function postResend(request, runtime = sessionRuntime) {
  return postRecovery(request, runtime, RESET_FIELDS, (body, correlationId) => requestResend(runtime.store, {
    loginId: body.loginId,
    csrfToken: request.headers.get(CSRF_HEADER),
    ip: request.headers.get(CLIENT_IP_HEADER),
    now: runtime.now(),
    policy: runtime.policy,
    audit: runtime.audit,
    alerts: runtime.alerts,
    delivery: runtime.delivery,
    correlationId,
  }), "/api/session/resend");
}

export function postResetConfirm(request, runtime = sessionRuntime) {
  return postRecovery(request, runtime, CONFIRM_FIELDS, (body, correlationId) => confirmReset(runtime.store, {
    token: body.token,
    password: body.password,
    csrfToken: request.headers.get(CSRF_HEADER),
    now: runtime.now(),
    audit: runtime.audit,
    correlationId,
  }), "/api/session/reset/confirm");
}

export function postOtp(request, runtime = sessionRuntime) {
  return postRecovery(request, runtime, OTP_FIELDS, (body, correlationId) => confirmOtp(runtime.store, {
    otp: body.otp,
    csrfToken: request.headers.get(CSRF_HEADER),
    now: runtime.now(),
    audit: runtime.audit,
    correlationId,
  }), "/api/session/otp");
}
