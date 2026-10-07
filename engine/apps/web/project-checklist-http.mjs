import { CORRELATION_HEADER, resolveCorrelationId } from "./request-correlation.mjs";
import { CSRF_HEADER, SESSION_COOKIE_NAME, readCookie } from "../../services/session.mjs";
import { deskActorForCsrf, deskRead } from "../../services/desk-session.mjs";
import {
  createProjectChecklistStore,
  openIssueFromMonitoredError,
  readProjectChecklist,
  saveProjectCheck,
} from "../../services/checklists/project-checklist.mjs";

const CHECKLIST_STATE_KEY = Symbol.for("crypto-prediction-engine.project-checklist");

function checklistState() {
  if (!globalThis[CHECKLIST_STATE_KEY]) {
    globalThis[CHECKLIST_STATE_KEY] = { store: createProjectChecklistStore() };
  }
  return globalThis[CHECKLIST_STATE_KEY];
}

// One process store. A reload on this server keeps the saved version.
export const projectChecklistRuntime = checklistState();

const CHECK_FIELDS = Object.freeze([
  "templateId",
  "owner",
  "dueOn",
  "evidenceUrl",
  "status",
  "dependsOn",
  "reviewer",
  "reviewedAt",
]);

const ISSUE_FIELDS = Object.freeze([
  "correlationId",
  "section",
  "route",
  "httpStatus",
  "recordedAt",
]);

function json(body, status, correlationId) {
  return Response.json(body, {
    status,
    headers: {
      [CORRELATION_HEADER]: correlationId,
      "cache-control": "no-store",
    },
  });
}

function actorFrom(request) {
  const csrf = request.headers.get(CSRF_HEADER);
  const cookieSession = deskRead(readCookie(request.headers.get("cookie"), SESSION_COOKIE_NAME));
  if (cookieSession.ok) {
    if (cookieSession.role !== "Admin") return { ok: false, status: 403, error: "role scope denied" };
    if (typeof csrf !== "string" || csrf.length === 0 || csrf !== cookieSession.csrfToken) {
      return { ok: false, status: 403, error: "csrf denied" };
    }
    return { ok: true, actor: { role: "Admin", tenantId: "desk" } };
  }
  // The secure desk cookie is not stored on an HTTP preview. The login response
  // already gave this page the csrf token, and that token is bound to the Admin session.
  const byCsrf = deskActorForCsrf(csrf);
  if (!byCsrf.ok) return { ok: false, status: byCsrf.error === "csrf denied" ? 403 : 401, error: byCsrf.error };
  if (byCsrf.role !== "Admin") return { ok: false, status: 403, error: "role scope denied" };
  return { ok: true, actor: { role: "Admin", tenantId: "desk" } };
}

function unknownField(body, allowed) {
  return Object.keys(body).find((key) => !allowed.includes(key)) ?? null;
}

async function readBody(request) {
  try {
    const body = await request.json();
    if (!body || typeof body !== "object" || Array.isArray(body)) return { ok: false };
    return { ok: true, body };
  } catch {
    return { ok: false };
  }
}

export function getProjectChecklist(request, store = projectChecklistRuntime.store) {
  const correlationId = resolveCorrelationId(request.headers.get(CORRELATION_HEADER));
  return json(readProjectChecklist(store), 200, correlationId);
}

export async function postProjectChecklist(request, store = projectChecklistRuntime.store) {
  const correlationId = resolveCorrelationId(request.headers.get(CORRELATION_HEADER));
  const actor = actorFrom(request);
  if (!actor.ok) return json({ ok: false, error: actor.error }, actor.status, correlationId);
  const parsed = await readBody(request);
  if (!parsed.ok) return json({ ok: false, error: "invalid checklist" }, 400, correlationId);
  if (unknownField(parsed.body, CHECK_FIELDS)) {
    return json({ ok: false, error: "unknown field" }, 400, correlationId);
  }
  const saved = saveProjectCheck(store, parsed.body, actor.actor);
  if (!saved.ok) return json({ ok: false, error: saved.error }, 400, correlationId);
  return json(saved, 200, correlationId);
}

export async function postProjectChecklistIssue(request, store = projectChecklistRuntime.store) {
  const correlationId = resolveCorrelationId(request.headers.get(CORRELATION_HEADER));
  const actor = actorFrom(request);
  if (!actor.ok) return json({ ok: false, error: actor.error }, actor.status, correlationId);
  const parsed = await readBody(request);
  if (!parsed.ok) return json({ ok: false, error: "invalid checklist" }, 400, correlationId);
  if (unknownField(parsed.body, ISSUE_FIELDS)) {
    return json({ ok: false, error: "unknown field" }, 400, correlationId);
  }
  const opened = openIssueFromMonitoredError(store, parsed.body, actor.actor);
  if (!opened.ok) return json({ ok: false, error: opened.error }, 400, correlationId);
  return json(opened, 200, correlationId);
}
