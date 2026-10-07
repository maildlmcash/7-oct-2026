import { knownBuildSha, pageHealthEvent } from "../apps/web/page-health.mjs";
import { recordSignal } from "./finding-normalizer.mjs";

// Design page 15 forbids these values in logs and screenshots.
// Confidence has no scale in the source, so a cause stays an unverified hypothesis.
const SECRET_KEYS = new Set([
  "password",
  "otp",
  "apisecret",
  "api_secret",
  "privatekey",
  "private_key",
  "seedphrase",
  "seed_phrase",
  "accesstoken",
  "access_token",
  "authorization",
  "cookie",
  "token",
  "secret",
  "set-cookie",
  "x-csrf-token",
  "x-api-key",
]);
const METHODS = new Set(["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD"]);
const EMAIL = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function requestId(value) {
  return typeof value === "string" && UUID.test(value) ? value : null;
}

function collectSecrets(value, found) {
  if (!value || typeof value !== "object") return;
  if (Array.isArray(value)) {
    for (const item of value) collectSecrets(item, found);
    return;
  }
  for (const [key, item] of Object.entries(value)) {
    if (SECRET_KEYS.has(key.toLowerCase()) && typeof item === "string" && item.length >= 4) found.add(item);
    collectSecrets(item, found);
  }
}

function leaked(value, secrets) {
  if (typeof value !== "string" || value.length === 0) return false;
  if (EMAIL.test(value)) return true;
  if (/bearer\s+/i.test(value)) return true;
  if (value.includes("BEGIN PRIVATE KEY")) return true;
  if (/seed phrase/i.test(value)) return true;
  for (const secret of secrets) {
    if (value.includes(secret)) return true;
  }
  return false;
}

function safeText(value, secrets) {
  if (typeof value !== "string" || value.trim().length === 0) return null;
  if (leaked(value, secrets)) return null;
  return value.trim();
}

function safeUrl(value, secrets) {
  if (typeof value !== "string") return null;
  if (leaked(value, secrets)) return null;
  let url;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  if (url.username || url.password) return null;
  if (url.protocol !== "http:" && url.protocol !== "https:" && url.protocol !== "file:") return null;
  for (const key of url.searchParams.keys()) {
    if (SECRET_KEYS.has(key.toLowerCase())) return null;
  }
  return value;
}

function closedRoute(value) {
  const event = pageHealthEvent({ routeViewId: value, httpStatus: 500 });
  return event.routeViewId;
}

function safeMethod(value) {
  return typeof value === "string" && METHODS.has(value.toUpperCase()) ? value.toUpperCase() : null;
}

function safeStatus(value) {
  return Number.isInteger(value) && value >= 100 && value <= 599 ? value : null;
}

function partsOf(finding) {
  try {
    const parts = JSON.parse(finding.fingerprint);
    return Array.isArray(parts) ? parts : null;
  } catch {
    return null;
  }
}

function safeLogs(value, secrets) {
  if (!Array.isArray(value)) return [];
  const logs = [];
  for (const entry of value) {
    if (!entry || typeof entry !== "object") continue;
    const result = safeText(entry.result, secrets);
    if (typeof entry.result === "string" && entry.result.trim().length > 0 && result === null) continue;
    logs.push(Object.freeze({
      requestId: requestId(entry.requestId ?? entry.correlationId),
      route: closedRoute(entry.route),
      httpStatus: safeStatus(entry.httpStatus),
      result,
    }));
  }
  return Object.freeze(logs);
}

function stepsFor(parts, request, trace) {
  const steps = [];
  if (parts[0] === "page-health") {
    const method = request.method ? `${request.method} ` : "";
    if (request.route) steps.push(`${method}${request.route}`.trim());
    if (request.httpStatus != null) steps.push(`Expect HTTP ${request.httpStatus}`);
    if (parts[5] === "js-exception") steps.push("Expect a JavaScript exception");
  } else if (parts[0] === "layout") {
    steps.push(`Check ${parts[3]} on ${parts[1]} ${parts[2]}`);
  }
  if (trace.requestId) steps.push(`Request id ${trace.requestId}`);
  return Object.freeze(steps);
}

function hypothesisFrom(input, secrets) {
  return Object.freeze({
    label: "hypothesis",
    text: safeText(input && input.suspectedCause, secrets),
    confidence: null,
    verified: false,
  });
}

function buildBundle(finding, input, secrets) {
  const parts = partsOf(finding);
  if (!parts) return null;
  const source = input && typeof input === "object" ? input : {};
  const trace = Object.freeze({
    requestId: requestId(source.trace && (source.trace.requestId ?? source.trace.correlationId))
      ?? requestId(finding.occurrences[0] && finding.occurrences[0].requestId),
  });
  const screenshotUrl = safeUrl(
    typeof source.screenshot === "string" ? source.screenshot : source.screenshot && source.screenshot.url,
    secrets,
  );
  const request = Object.freeze({
    method: safeMethod(source.request && source.request.method),
    route: finding.route,
    requestId: trace.requestId,
    httpStatus: parts[0] === "page-health" ? parts[4] : null,
  });
  return Object.freeze({
    fingerprint: finding.fingerprint,
    seenAt: finding.lastSeen,
    buildSha: finding.affectedBuild,
    trace,
    screenshot: screenshotUrl ? Object.freeze({ url: screenshotUrl }) : null,
    request,
    steps: stepsFor(parts, request, trace),
    logs: safeLogs(source.logs, secrets),
    hypothesis: hypothesisFrom(source, secrets),
  });
}

export function scanDiagnostic(value) {
  const failed = walk(value);
  return failed ? { ok: false, error: "diagnostic bundle has a secret" } : { ok: true };
}

function walk(value, key) {
  if (typeof key === "string" && SECRET_KEYS.has(key.toLowerCase())) return true;
  if (typeof value === "string") return leaked(value, []);
  if (!value || typeof value !== "object") return false;
  if (Array.isArray(value)) return value.some((item) => walk(item));
  return Object.entries(value).some(([entryKey, entry]) => walk(entry, entryKey));
}

export function attachDiagnostic(log, fingerprint, input) {
  const index = log.findings.findIndex((finding) => finding.fingerprint === fingerprint);
  if (index === -1) return { ok: false, error: "unknown finding" };
  const secrets = new Set();
  collectSecrets(input, secrets);
  const bundle = buildBundle(log.findings[index], input, secrets);
  if (!bundle) return { ok: false, error: "bundle cannot be reproduced" };
  if ([...secrets].some((secret) => JSON.stringify(bundle).includes(secret))) {
    return { ok: false, error: "diagnostic bundle has a secret" };
  }
  const scan = scanDiagnostic(bundle);
  if (!scan.ok) return scan;
  const current = log.findings[index];
  const finding = Object.freeze({
    ...current,
    bundle,
  });
  log.findings[index] = finding;
  return { ok: true, finding };
}

export function reproduceFromBundle(bundle) {
  const scan = scanDiagnostic(bundle);
  if (!scan.ok) return scan;
  const parts = partsOf({ fingerprint: bundle && bundle.fingerprint });
  if (!parts || typeof bundle.seenAt !== "string") return { ok: false, error: "bundle cannot be reproduced" };
  if (parts[0] === "page-health") {
    return {
      ok: true,
      signal: {
        source: "page-health",
        seenAt: bundle.seenAt,
        event: {
          routeViewId: parts[2],
          viewId: parts[3],
          httpStatus: parts[4],
          exception: parts[5] === "js-exception" ? true : null,
          requestId: bundle.trace && bundle.trace.requestId,
          buildSha: knownBuildSha(bundle.buildSha),
        },
      },
    };
  }
  if (parts[0] === "layout") {
    return {
      ok: true,
      signal: {
        source: "layout",
        seenAt: bundle.seenAt,
        buildSha: bundle.buildSha,
        finding: {
          surface: parts[1],
          viewport: { name: parts[2] },
          fault: parts[3],
          evidence: evidenceFromDetail(parts[3], parts[4]),
        },
      },
    };
  }
  return { ok: false, error: "bundle cannot be reproduced" };
}

function evidenceFromDetail(fault, detail) {
  if (fault === "overlap" && Array.isArray(detail)) return { boxId: detail[0], otherBoxId: detail[1] };
  if (fault === "missing-heading" && typeof detail === "string") return { heading: detail };
  if (fault === "broken-link" && Array.isArray(detail)) return { linkId: detail[0], reason: detail[1] };
  if (fault === "mobile-viewport" && Array.isArray(detail)) return { boxId: detail[0], edge: detail[1] };
  return {};
}

export function reproducedFingerprint(bundle) {
  const reproduced = reproduceFromBundle(bundle);
  if (!reproduced.ok) return reproduced;
  const recorded = recordSignal({ findings: [] }, reproduced.signal);
  if (!recorded.ok) return recorded;
  return { ok: true, fingerprint: recorded.finding.fingerprint, finding: recorded.finding };
}
