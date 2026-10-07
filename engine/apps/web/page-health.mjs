import { resolveCorrelationId, shellSectionName } from "./request-correlation.mjs";

// The env examples name local, test, and staging. Any other value is dropped.
export const PAGE_HEALTH_ENVIRONMENTS = Object.freeze(["local", "test", "staging"]);
// The source names no build SHA format. A hex value is the only accepted fixture.
const SHA_PATTERN = /^[0-9a-f]{7,64}$/i;
const ENVIRONMENT_SET = new Set(PAGE_HEALTH_ENVIRONMENTS);
const ROUTE_SET = new Set([
  "/api/view-state",
  "/api/checklist-owner",
  "/api/session",
  "/api/session/csrf",
  "/api/session/login",
  "/api/session/logout",
  "/api/session/rotate",
  "/api/session/limits",
  "/api/session/reset",
  "/api/session/resend",
  "/api/session/reset/confirm",
  "/api/session/otp",
  "section-render",
  "missing-page",
]);

export function knownEnvironment(value) {
  return typeof value === "string" && ENVIRONMENT_SET.has(value) ? value : null;
}

export function knownBuildSha(value) {
  return typeof value === "string" && SHA_PATTERN.test(value) ? value.toLowerCase() : null;
}

function knownViewId(value) {
  const section = shellSectionName(value);
  if (section) return section;
  if (value === "missing-page") return "missing-page";
  return null;
}

function knownStatus(value) {
  if (!Number.isInteger(value) || value < 100 || value > 599) return null;
  return value;
}

// Closed health event. Passwords, tokens, exception text, and form bodies are not fields.
export function pageHealthEvent(input) {
  const source = input && typeof input === "object" ? input : {};
  const routeViewId = typeof source.routeViewId === "string" && ROUTE_SET.has(source.routeViewId)
    ? source.routeViewId
    : null;
  let viewId = knownViewId(source.viewId);
  if (!viewId && routeViewId === "missing-page") viewId = "missing-page";
  const exception = source.exception == null || source.exception === false ? null : "js-exception";
  return Object.freeze({
    routeViewId,
    viewId,
    httpStatus: knownStatus(source.httpStatus),
    exception,
    requestId: resolveCorrelationId(source.requestId ?? source.correlationId),
    buildSha: knownBuildSha(source.buildSha),
    environment: knownEnvironment(source.environment),
  });
}

export function recordPageHealth(input, sink) {
  const event = pageHealthEvent(input);
  if (Array.isArray(sink)) sink.push(event);
  return event;
}
