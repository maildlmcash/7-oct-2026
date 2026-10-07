import { knownEnvironment, recordPageHealth } from "./page-health.mjs";

// The source names no web build SHA. The field stays null until a caller supplies a hex fixture.
export const serverPageHealthEvents = [];

export function recordServerFailure(input, sink = serverPageHealthEvents) {
  const source = input && typeof input === "object" ? input : {};
  return recordPageHealth({
    routeViewId: source.routeViewId,
    viewId: source.viewId,
    httpStatus: source.httpStatus,
    exception: source.exception,
    requestId: source.requestId ?? source.correlationId,
    buildSha: source.buildSha ?? null,
    environment: source.environment ?? knownEnvironment(process.env.APP_ENV),
  }, sink);
}

export function recordMissingPage(input, sink = serverPageHealthEvents) {
  const source = input && typeof input === "object" ? input : {};
  return recordServerFailure({
    routeViewId: "missing-page",
    viewId: "missing-page",
    httpStatus: 404,
    exception: null,
    requestId: source.requestId,
    buildSha: source.buildSha,
    environment: source.environment,
  }, sink);
}
