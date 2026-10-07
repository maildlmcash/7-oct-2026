import { recordServerFailure } from "./page-health-server.mjs";
import { CORRELATION_HEADER, resolveCorrelationId } from "./request-correlation.mjs";
import { CLIENT_IP_HEADER, CSRF_HEADER, SESSION_COOKIE_NAME, readCookie } from "../../services/session.mjs";
import { deskCsrf, deskLogin, deskLogout, deskRead } from "../../services/desk-session.mjs";

const LOGIN_FIELDS = ["loginId", "password"];

function correlationIdFrom(request) {
  return resolveCorrelationId(request.headers.get(CORRELATION_HEADER));
}

function json(body, status, correlationId, setCookie) {
  if (Number.isInteger(status) && status >= 400) {
    recordServerFailure({ routeViewId: "/api/desk", httpStatus: status, requestId: correlationId });
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
  if (result.error === "csrf denied") return 403;
  if (result.error === "session expiry is not configured" || result.error === "rate limit is not configured") return 503;
  return 401;
}

function publicDesk(result) {
  if (!result.ok) return { ok: false, error: result.error };
  const body = { ok: true, role: result.role, loginId: result.loginId };
  if (typeof result.csrfToken === "string") body.csrfToken = result.csrfToken;
  if (typeof result.sessionPublicId === "string") body.sessionPublicId = result.sessionPublicId;
  if (typeof result.expiresAt === "number") body.expiresAt = result.expiresAt;
  if (typeof result.liveTrading === "string") body.liveTrading = result.liveTrading;
  if (typeof result.liveOrdersLocked === "boolean") body.liveOrdersLocked = result.liveOrdersLocked;
  return body;
}

function cookieToken(request) {
  return readCookie(request.headers.get("cookie"), SESSION_COOKIE_NAME);
}

function clientIp(request) {
  const forwarded = request.headers.get("x-forwarded-for");
  if (typeof forwarded === "string" && forwarded.split(",")[0].trim().length > 0) {
    return forwarded.split(",")[0].trim();
  }
  const explicit = request.headers.get(CLIENT_IP_HEADER);
  if (typeof explicit === "string" && explicit.length > 0) return explicit;
  return "preview";
}

export function getDeskCsrf(request) {
  const correlationId = correlationIdFrom(request);
  const result = deskCsrf();
  const body = result.ok ? { ok: true, csrfToken: result.csrfToken } : { ok: false, error: result.error };
  return json(body, statusFor(result), correlationId, null);
}

export async function postDeskLogin(request) {
  const correlationId = correlationIdFrom(request);
  let body;
  try {
    body = await request.json();
  } catch {
    return json({ ok: false, error: "login denied" }, 400, correlationId, null);
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return json({ ok: false, error: "login denied" }, 400, correlationId, null);
  }
  for (const key of Object.keys(body)) {
    if (!LOGIN_FIELDS.includes(key)) return json({ ok: false, error: "unknown field" }, 400, correlationId, null);
  }
  const result = deskLogin({
    loginId: body.loginId,
    password: body.password,
    csrfToken: request.headers.get(CSRF_HEADER),
    existingToken: cookieToken(request),
    ip: clientIp(request),
  });
  return json(publicDesk(result), statusFor(result), correlationId, result.ok ? result.setCookie : null);
}

export function getDeskSession(request) {
  const correlationId = correlationIdFrom(request);
  const result = deskRead(cookieToken(request));
  return json(publicDesk(result), statusFor(result), correlationId, null);
}

export function postDeskLogout(request) {
  const correlationId = correlationIdFrom(request);
  const result = deskLogout({
    token: cookieToken(request),
    csrfToken: request.headers.get(CSRF_HEADER),
  });
  return json(
    result.ok ? { ok: true, liveTrading: result.liveTrading, liveOrdersLocked: result.liveOrdersLocked } : { ok: false, error: result.error },
    statusFor(result),
    correlationId,
    result.ok ? result.clearCookie : null,
  );
}
