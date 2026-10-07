// Operational readiness for task 1.C.3.
// Search metrics name p50, p95, and p99 and name no numeric SLO.
// Session login names no product cap. A missing cap is "rate limit is not configured".
// A missing measurement or an unconfigured target is UNKNOWN. UNKNOWN is not a pass.
// A caller-supplied target is not stored as a product default.

import { isKnownRole } from "../roles.mjs";

export const METRIC_FAMILIES = Object.freeze([
  "latency",
  "uptime",
  "rate-limit",
  "security",
  "device-error",
]);
export const BREACH_STATES = Object.freeze(["UNKNOWN", "BREACH", "WITHIN"]);
export const METRIC_FIELDS = Object.freeze([
  "target",
  "measured",
  "limit",
  "source",
  "sampleWindow",
  "breach",
]);
export const OBSERVED_SERIES = Object.freeze([
  "p50",
  "p95",
  "p99",
  "freshness",
  "disconnects",
  "rateLimitHeadroom",
]);
export const SYNTHETIC_SURFACES = Object.freeze(["browser", "mobile"]);
export const SYNTHETIC_CHECKS = Object.freeze([
  "page",
  "login",
  "resend-password",
  "layout",
]);
export const TRUTH = "MOCK";

const FAMILY_SET = new Set(METRIC_FAMILIES);
const SURFACE_SET = new Set(SYNTHETIC_SURFACES);
const CHECK_SET = new Set(SYNTHETIC_CHECKS);
const SECRET_TEXT = /bearer\s|begin private key|api_key|api_secret|private_key|seed phrase/i;
const TEST_SAMPLES = Object.freeze([10, 20, 30, 40, 100]);

const SOURCES = Object.freeze({
  latency: "services/search-metrics.mjs",
  uptime: "not measured",
  "rate-limit": "services/session.mjs",
  security: "not measured",
  "device-error": "apps/web/page-health.mjs",
});

function unconfigured(note) {
  return Object.freeze({ configured: false, value: null, note });
}

function missingMeasured(note) {
  return Object.freeze({ present: false, value: null, evidence: null, note });
}

function whole(value) {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function leaked(value) {
  return SECRET_TEXT.test(JSON.stringify(value ?? ""));
}

export function percentileOf(samples, percent) {
  const sorted = [...samples].sort((left, right) => left - right);
  const product = BigInt(percent) * BigInt(sorted.length);
  const rank = Number((product + 99n) / 100n);
  const index = Math.min(sorted.length - 1, Math.max(0, rank - 1));
  return sorted[index];
}

function metricRow(family) {
  return Object.freeze({
    id: family,
    family,
    owner: null,
    target: unconfigured("source names no numeric SLO"),
    measured: missingMeasured("telemetry is not measured"),
    limit: unconfigured("source names no limit"),
    source: SOURCES[family],
    sampleWindow: unconfigured("source names no sample window"),
    breach: "UNKNOWN",
  });
}

function seriesCell(note) {
  return Object.freeze({
    target: unconfigured("source names no numeric SLO"),
    measured: missingMeasured(note),
    limit: unconfigured("source names no limit"),
    source: note,
    sampleWindow: unconfigured("source names no sample window"),
    breach: "UNKNOWN",
  });
}

function securityCheck(name, source) {
  return Object.freeze({
    name,
    owner: null,
    target: unconfigured("source names no pass rule"),
    measured: missingMeasured("security check is not measured"),
    limit: unconfigured("source names no limit"),
    source,
    sampleWindow: unconfigured("source names no sample window"),
    breach: "UNKNOWN",
  });
}

export function readinessCatalog() {
  return METRIC_FAMILIES.map((family) => metricRow(family));
}

export function observedSnapshot() {
  return Object.freeze({
    p50: seriesCell("telemetry is not measured"),
    p95: seriesCell("telemetry is not measured"),
    p99: seriesCell("telemetry is not measured"),
    freshness: seriesCell("freshness is not measured"),
    disconnects: seriesCell("disconnects are not measured"),
    rateLimitHeadroom: Object.freeze({
      ...seriesCell("rate limit is not configured"),
      source: "services/session.mjs",
    }),
    securityChecks: Object.freeze([
      securityCheck("secret scan", "services/diagnostic-bundle.mjs"),
      securityCheck("session rate limit", "services/session.mjs"),
      securityCheck("order lock", "configuration is not telemetry"),
    ]),
  });
}

export function syntheticViews() {
  const rows = [];
  for (const surface of SYNTHETIC_SURFACES) {
    for (const check of SYNTHETIC_CHECKS) {
      rows.push(Object.freeze({
        surface,
        check,
        result: "UNKNOWN",
        evidence: null,
        note: "no synthetic result is measured",
      }));
    }
  }
  return Object.freeze(rows);
}

export function readinessView() {
  return Object.freeze({
    truth: TRUTH,
    metrics: Object.freeze(readinessCatalog()),
    observed: observedSnapshot(),
    synthetic: syntheticViews(),
    orders: false,
    walletAccess: false,
  });
}

export function displayOwner(owner) {
  return owner == null || owner === "" ? "UNKNOWN" : owner;
}

export function fieldText(field) {
  if (field == null) return "UNKNOWN";
  if (field.present === false) return "not measured";
  if (field.configured === false) return "not configured";
  if (field.present === true) return String(field.value);
  if (field.value == null) return "UNKNOWN";
  return String(field.value);
}

export function definitionTable(view = readinessView()) {
  return view.metrics.map((row) => Object.freeze({
    metric: row.family,
    owner: displayOwner(row.owner),
    target: row.target.configured ? String(row.target.value) : "not configured",
    measured: row.measured.present ? String(row.measured.value) : "not measured",
    measuredEvidence: row.measured.evidence,
    limit: row.limit.configured ? String(row.limit.value) : "not configured",
    source: row.source,
    sampleWindow: row.sampleWindow.configured ? String(row.sampleWindow.value) : "not configured",
    breach: row.breach,
  }));
}

function decide(family, target, measured) {
  if (!target.configured || !measured.present || measured.evidence == null) return "UNKNOWN";
  const outside = family === "uptime" || family === "rate-limit"
    ? measured.value < target.value
    : measured.value > target.value;
  return outside ? "BREACH" : "WITHIN";
}

function boundField(value, emptyNote) {
  if (value == null || value.configured === false || value.configured == null) {
    return { ok: true, field: unconfigured(emptyNote) };
  }
  if (value.configured !== true || !whole(value.value)) return { ok: false, error: "unsupported field" };
  return {
    ok: true,
    field: Object.freeze({ configured: true, value: value.value, note: "caller-supplied" }),
  };
}

function measuredField(value) {
  if (value == null || value.present === false) {
    return { ok: true, field: missingMeasured("telemetry is not measured") };
  }
  if (value.present !== true || !whole(value.value)) return { ok: false, error: "unsupported field" };
  if (typeof value.evidence !== "string" || value.evidence.trim() === "") {
    return { ok: true, field: missingMeasured("measured evidence is missing") };
  }
  return {
    ok: true,
    field: Object.freeze({
      present: true,
      value: value.value,
      evidence: value.evidence,
      note: null,
    }),
  };
}

export function evaluateReading(input) {
  const source = input && typeof input === "object" ? input : {};
  if (leaked(source)) return { ok: false, error: "secret value is not allowed" };
  if (!FAMILY_SET.has(source.family)) return { ok: false, error: "unknown metric" };
  if (source.owner != null && !isKnownRole(source.owner)) {
    return { ok: false, error: "owner is not a known role" };
  }
  if (source.status === "LIVE" || source.breach === "LIVE") return { ok: false, error: "invalid status" };
  const target = boundField(source.target, "source names no numeric SLO");
  if (!target.ok) return target;
  const limit = boundField(source.limit, "source names no limit");
  if (!limit.ok) return limit;
  const sampleWindow = boundField(source.sampleWindow, "source names no sample window");
  if (!sampleWindow.ok) return sampleWindow;
  const measured = measuredField(source.measured);
  if (!measured.ok) return measured;
  return {
    ok: true,
    row: Object.freeze({
      id: source.family,
      family: source.family,
      owner: source.owner ?? null,
      target: target.field,
      measured: measured.field,
      limit: limit.field,
      source: SOURCES[source.family],
      sampleWindow: sampleWindow.field,
      breach: decide(source.family, target.field, measured.field),
    }),
  };
}

export function assignOwner(row, role) {
  if (!row || !FAMILY_SET.has(row.family)) return { ok: false, error: "unknown metric" };
  if (!isKnownRole(role)) return { ok: false, error: "owner is not a known role" };
  return {
    ok: true,
    row: Object.freeze({ ...row, owner: role, breach: row.breach }),
  };
}

export function rateLimitHeadroom(policy, used) {
  const limit = policy && policy.accountLimit;
  const windowMs = policy && policy.windowMs;
  if (!whole(limit) || !whole(windowMs) || windowMs < 1) {
    return Object.freeze({
      ok: true,
      configured: false,
      limit: null,
      sampleWindow: null,
      measured: null,
      evidence: null,
      breach: "UNKNOWN",
      note: "rate limit is not configured",
    });
  }
  if (!whole(used)) {
    return Object.freeze({
      ok: true,
      configured: true,
      limit,
      sampleWindow: windowMs,
      measured: null,
      evidence: null,
      breach: "UNKNOWN",
      note: "telemetry is not measured",
    });
  }
  return Object.freeze({
    ok: true,
    configured: true,
    limit,
    sampleWindow: windowMs,
    measured: limit - used,
    evidence: "caller-supplied",
    breach: "UNKNOWN",
    note: "headroom is measured; source names no headroom target",
  });
}

function withMeasured(cell, value, evidence) {
  return Object.freeze({
    ...cell,
    measured: Object.freeze({ present: true, value, evidence, note: null }),
    breach: "UNKNOWN",
  });
}

export function applySearchReport(view, report) {
  const base = view ?? readinessView();
  if (!report || report.ok !== true || !report.measured) {
    return { ok: false, error: "measured evidence is missing" };
  }
  const measured = report.measured;
  if (!whole(measured.p50) || !whole(measured.p95) || !whole(measured.p99)) {
    return { ok: false, error: "unsupported field" };
  }
  const targets = report.targets && typeof report.targets === "object" ? report.targets : {};
  const observed = { ...base.observed };
  for (const name of ["p50", "p95", "p99", "freshness"]) {
    if (name === "freshness" && !whole(measured.freshness)) continue;
    const target = targets[name];
    const configured = Boolean(target && target.configured === true && whole(target.value));
    const value = measured[name];
    observed[name] = Object.freeze({
      ...base.observed[name],
      target: configured
        ? Object.freeze({ configured: true, value: target.value, note: "caller-supplied" })
        : unconfigured("source names no numeric SLO"),
      measured: Object.freeze({
        present: true,
        value,
        evidence: "search-metrics report",
        note: null,
      }),
      breach: !configured ? "UNKNOWN" : value > target.value ? "BREACH" : "WITHIN",
    });
  }
  return {
    ok: true,
    view: Object.freeze({ ...base, observed: Object.freeze(observed) }),
  };
}

export function recordSynthetic(view, input) {
  const source = input && typeof input === "object" ? input : {};
  if (leaked(source)) return { ok: false, error: "secret value is not allowed" };
  if (!SURFACE_SET.has(source.surface) || !CHECK_SET.has(source.check)) {
    return { ok: false, error: "unknown synthetic check" };
  }
  if (source.result === "PASS" || source.result === "WITHIN" || source.result === "LIVE") {
    return { ok: false, error: "missing telemetry is UNKNOWN" };
  }
  const base = view ?? readinessView();
  if (source.result != null && source.result !== "UNKNOWN" && source.result !== "FAIL") {
    return { ok: false, error: "invalid status" };
  }
  if (source.result === "FAIL" && (typeof source.evidence !== "string" || source.evidence.trim() === "")) {
    return { ok: false, error: "measured evidence is missing" };
  }
  const synthetic = base.synthetic.map((row) => {
    if (row.surface !== source.surface || row.check !== source.check) return row;
    if (source.result === "FAIL") {
      return Object.freeze({
        ...row,
        result: "FAIL",
        evidence: source.evidence,
        note: "failure recorded",
      });
    }
    return Object.freeze({
      ...row,
      result: "UNKNOWN",
      evidence: null,
      note: "no synthetic result is measured",
    });
  });
  return {
    ok: true,
    view: Object.freeze({ ...base, synthetic: Object.freeze(synthetic) }),
  };
}

export function attachTestEvent(view) {
  const base = view ?? readinessView();
  const observed = {
    ...base.observed,
    p50: withMeasured(base.observed.p50, percentileOf(TEST_SAMPLES, 50), "test-event"),
    p95: withMeasured(base.observed.p95, percentileOf(TEST_SAMPLES, 95), "test-event"),
    p99: withMeasured(base.observed.p99, percentileOf(TEST_SAMPLES, 99), "test-event"),
  };
  const metrics = base.metrics.map((row) => {
    if (row.family !== "device-error") return row;
    return Object.freeze({
      ...row,
      measured: Object.freeze({
        present: true,
        value: 1,
        evidence: "test-event:layout",
        note: null,
      }),
      breach: "UNKNOWN",
    });
  });
  const synthetic = base.synthetic.map((row) => {
    if (row.check !== "layout") return row;
    return Object.freeze({
      ...row,
      result: "FAIL",
      evidence: "test-event:layout",
      note: "layout failure recorded",
    });
  });
  return Object.freeze({
    ...base,
    truth: TRUTH,
    metrics: Object.freeze(metrics),
    observed: Object.freeze(observed),
    synthetic: Object.freeze(synthetic),
  });
}

export function greenReadings(view) {
  const hits = [];
  for (const row of view.metrics) {
    if (row.breach === "WITHIN") hits.push(row.family);
  }
  for (const name of OBSERVED_SERIES) {
    if (view.observed[name].breach === "WITHIN") hits.push(name);
  }
  for (const check of view.observed.securityChecks) {
    if (check.breach === "WITHIN") hits.push(check.name);
  }
  for (const row of view.synthetic) {
    if (row.result === "WITHIN" || row.result === "PASS") hits.push(`${row.surface}:${row.check}`);
  }
  return hits;
}
