import { recordServerFailure } from "./page-health-server.mjs";
import { CORRELATION_HEADER, resolveCorrelationId, SECTION_HEADER } from "./request-correlation.mjs";
import { authorizeRequest } from "../../services/access-policy.mjs";
import { MFA_HEADER, gatePrivilegedAction } from "../../services/privileged-access.mjs";
import { CLIENT_IP_HEADER, SESSION_COOKIE_NAME, allowSensitiveRead, readCookie, readSession } from "../../services/session.mjs";
import { sessionRuntime } from "./session-http.mjs";

// Body role, tenant, and edit flags are not scopes. The session account is the principal.
function recordIdFromBody(body) {
  if (!body || typeof body !== "object" || Array.isArray(body)) return undefined;
  return body.recordId;
}

function checklistJson(request, body, status, correlationId) {
  if (status >= 400) {
    recordServerFailure({
      routeViewId: "/api/checklist-owner",
      viewId: request.headers.get(SECTION_HEADER),
      httpStatus: status,
      requestId: correlationId,
    });
  }
  return Response.json(body, {
    status,
    headers: { [CORRELATION_HEADER]: correlationId },
  });
}

function finish(request, runtime, action, recordId, session) {
  const correlationId = resolveCorrelationId(request.headers.get(CORRELATION_HEADER));
  const result = authorizeRequest(runtime.store, {
    authenticated: session.ok === true,
    subjectId: session.ok ? session.subjectId : null,
    action,
    recordId,
    log: runtime.accessLog,
    correlationId,
  });
  if (result.ok && action === "checklist.write") {
    if (!Array.isArray(runtime.privilegedAudit)) runtime.privilegedAudit = [];
    const gate = gatePrivilegedAction(runtime.privilegedAudit, {
      provider: runtime.mfaProvider ?? null,
      proof: request.headers.get(MFA_HEADER),
      actor: session.subjectId,
      action,
      target: recordId,
      time: runtime.now(),
    });
    if (!gate.ok) {
      const denied = { ok: false, error: gate.error };
      if (gate.blocked) denied.blocked = gate.blocked;
      return checklistJson(request, denied, gate.status, correlationId);
    }
  }
  if (!result.ok) {
    const status = result.error === "login denied" ? 401 : 403;
    return checklistJson(request, { ok: false, error: result.error }, status, correlationId);
  }
  if (action === "checklist.read") {
    const gate = allowSensitiveRead(runtime.store, {
      subjectId: session.subjectId,
      ip: request.headers.get(CLIENT_IP_HEADER),
      now: runtime.now(),
      policy: runtime.policy,
      alerts: runtime.alerts,
      correlationId,
    });
    if (!gate.ok) {
      // The source names no throttle status. A denied sensitive read uses 429.
      const status = gate.error === "rate limit is not configured" ? 503 : 429;
      return checklistJson(request, { ok: false, error: gate.error }, status, correlationId);
    }
  }
  return checklistJson(request, { ok: true }, 200, correlationId);
}

function sessionFor(request, runtime) {
  const token = readCookie(request.headers.get("cookie"), SESSION_COOKIE_NAME);
  return readSession(runtime.store, token, runtime.now());
}

export function getChecklistOwner(request, runtime = sessionRuntime) {
  const recordId = new URL(request.url).searchParams.get("recordId");
  return finish(request, runtime, "checklist.read", recordId, sessionFor(request, runtime));
}

export async function postChecklistOwner(request, runtime = sessionRuntime) {
  const session = sessionFor(request, runtime);
  if (!session.ok) return finish(request, runtime, "checklist.write", undefined, session);
  let recordId;
  try {
    recordId = recordIdFromBody(await request.json());
  } catch {
    recordId = undefined;
  }
  return finish(request, runtime, "checklist.write", recordId, session);
}
