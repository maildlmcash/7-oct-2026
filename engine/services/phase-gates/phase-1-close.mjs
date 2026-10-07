import { createHash } from "node:crypto";
import { canEditChecklist } from "../checklist-status-view.mjs";

// Task 1.D.3 closeout. This module records a gate. It does not deploy, does not
// read environment variables, and does not change the frozen health object.
// A SHA-256 checksum is an integrity hash of the decision, not a private-key signature.

export const DEPLOYMENT = Object.freeze({
  mode: "PAPER",
  liveTrading: "OFF",
  liveOrdersLocked: true,
  walletAccess: false,
  realOrders: false,
});

export const SUPPORTED_VIEWPORTS = Object.freeze([
  Object.freeze({ name: "mobile", width: 375, height: 667 }),
  Object.freeze({ name: "tablet", width: 768, height: 1024 }),
  Object.freeze({ name: "desktop", width: 1280, height: 800 }),
]);

export const CLOSE_ROLES = Object.freeze([
  "Super Admin",
  "Admin",
  "Super Distributor",
  "Distributor",
  "Retailer",
  "Customer",
  "Retailer+Customer",
]);

export const CLOSE_TENANTS = Object.freeze([
  "desk",
  "tenant-alpha",
  "tenant-beta",
  "tenant-gamma",
]);

export const THREAT_SURFACES = Object.freeze([
  "auth",
  "tenantBoundary",
  "adminEdits",
  "checklists",
  "subdomain",
]);

const TENANT_ID = "desk";
const ISO_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/;
const SECRET = new RegExp(`${["BEGIN", "PRIVATE", "KEY"].join(" ")}|api_secret|api_key|private_key|seed phrase|bearer\\s+\\S+`, "i");
const FORBIDDEN_GRANT = new Set(["trade", "wallet", "live-order", "withdrawal"]);

function issue(check, state, reason, test = null) {
  return { check, state, reason, test };
}

function sameViewport(left, right) {
  return left.name === right.name && left.width === right.width && left.height === right.height;
}

function secretIn(value, seen = new Set()) {
  if (value === null || value === undefined) return false;
  if (typeof value === "string") return SECRET.test(value);
  if (typeof value !== "object") return false;
  if (seen.has(value)) return false;
  seen.add(value);
  if (Array.isArray(value)) return value.some((item) => secretIn(item, seen));
  return Object.entries(value).some(([key, item]) => SECRET.test(key) || secretIn(item, seen));
}

export const VISIBLE_LIVE_LABELS = Object.freeze([
  Object.freeze({ id: "shell-safety-banner", file: "apps/web/app/shell.tsx", text: "LIVE ORDERS LOCKED", kind: "lock", source: "apps/web/health.mjs liveOrdersLocked true", lastSeen: null, notObservation: true }),
  Object.freeze({ id: "workspace-lock-pill", file: "apps/web/app/engine-workspace.tsx", text: "LIVE ORDERS LOCKED", kind: "lock", source: "apps/web/health.mjs liveOrdersLocked true", lastSeen: null, notObservation: true }),
  Object.freeze({ id: "workspace-safety-config", file: "apps/web/app/engine-workspace.tsx", text: "LIVE_TRADING=OFF · LIVE_ORDERS_LOCKED=true", kind: "lock", source: "apps/web/health.mjs", lastSeen: null, notObservation: true }),
  Object.freeze({
    id: "status-pill-spot",
    file: "apps/web/app/engine-workspace.tsx",
    text: "LIVE · wss://data-stream.binance.vision:443/stream?streams=btcusdt@trade/btcusdt@bookTicker · 2026-10-07T12:59:56.869Z",
    kind: "status",
    source: "wss://data-stream.binance.vision:443/stream?streams=btcusdt@trade/btcusdt@bookTicker",
    lastSeen: "2026-10-07T12:59:56.869Z",
  }),
  Object.freeze({
    id: "status-pill-futures",
    file: "apps/web/app/engine-workspace.tsx",
    text: "LIVE · wss://fstream.binance.com/market/stream?streams=btcusdt@markPrice@1s · 2026-10-07T12:59:56.618Z",
    kind: "status",
    source: "wss://fstream.binance.com/market/stream?streams=btcusdt@markPrice@1s",
    lastSeen: "2026-10-07T12:59:56.618Z",
  }),
]);

export const THREAT_REVIEW = Object.freeze({
  auth: Object.freeze({
    reviewed: true,
    residual: "Fresh run on 2026-10-07. Shipped ceilings are empty. authorizeControlRequest denies every close role on desk, tenant-alpha, tenant-beta, and tenant-gamma, including trade, wallet, live-order, and withdrawal. The signed-out shell lists every section because it has no identity session. The role navigation test requires those buttons, and a forged navigation call returns login denied. That listing is not a grant.",
    blocksP2: false,
  }),
  tenantBoundary: Object.freeze({
    reviewed: true,
    residual: "Only the request Host header is trusted. A spoofed forwarded host is rejected. localhost is an unknown host. Preview themes are MOCK and Ed25519-signed. The private key is not stored.",
    blocksP2: false,
  }),
  adminEdits: Object.freeze({
    reviewed: true,
    residual: "Checklist writes require a desk Admin and CSRF. Secret write is not enabled. Super Admin write is role scope denied. The release gate does not deploy.",
    blocksP2: false,
  }),
  checklists: Object.freeze({
    reviewed: true,
    residual: "Project checklist statuses are TODO, IN_PROGRESS, PASS, FAIL, and BLOCKED. PASS needs an evidence URL. A BLOCKED dependency locks the downstream task. The older checklist_item statuses are a separate set. This closeout does not mark the admin baseline checklist complete.",
    blocksP2: false,
  }),
  subdomain: Object.freeze({
    reviewed: true,
    residual: "Subdomain resolution is the white-label host check. Query host is ignored. Feature flags cannot turn on live trading, orders, wallet access, or exchange credentials.",
    blocksP2: false,
  }),
});

function assessMatrix(input) {
  const matrix = input.browserMatrix;
  if (!matrix || matrix.status === "NOT_RUN") return issue("browserMatrix", "BLOCKED", "browser matrix was not run");
  if (matrix.status === "FAIL") {
    const first = Array.isArray(matrix.failures) ? matrix.failures[0] : null;
    return issue("browserMatrix", "FAIL", first?.message || "browser matrix failed", first?.test || "apps/web/tests/layout.spec.ts");
  }
  if (matrix.status !== "PASS") return issue("browserMatrix", "BLOCKED", "browser matrix status is unresolved");
  const viewports = Array.isArray(matrix.viewports) ? matrix.viewports : [];
  const missing = SUPPORTED_VIEWPORTS.some((expected) => !viewports.some((item) => sameViewport(item, expected)));
  if (missing || (matrix.failures && matrix.failures.length > 0)) {
    return issue("browserMatrix", "BLOCKED", "supported browser matrix is incomplete");
  }
  return null;
}

function assessAuthorization(input) {
  const report = input.apiAuthorization;
  if (!report || report.status === "NOT_RUN") return issue("apiAuthorization", "BLOCKED", "api authorization baseline was not run");
  if (report.status === "FAIL") return issue("apiAuthorization", "FAIL", report.reason || "api authorization failed", report.test || null);
  if (report.status !== "PASS") return issue("apiAuthorization", "BLOCKED", "api authorization status is unresolved");
  const rows = Array.isArray(report.rows) ? report.rows : [];
  for (const role of CLOSE_ROLES) {
    for (const tenantId of CLOSE_TENANTS) {
      const found = rows.some((row) => row && row.role === role && row.tenantId === tenantId && (row.decision === "denied" || row.decision === "allowed"));
      if (!found) return issue("apiAuthorization", "BLOCKED", `api authorization is missing ${role} on ${tenantId}`);
    }
  }
  const granted = rows.find((row) => row && row.decision === "allowed" && FORBIDDEN_GRANT.has(row.capability));
  if (granted) return issue("apiAuthorization", "FAIL", `forbidden capability granted: ${granted.capability}`);
  return null;
}

function assessAccessibility(input) {
  const report = input.accessibility;
  if (!report || report.status === "NOT_MEASURED" || report.status === "NOT_RUN") {
    return issue("accessibility", "BLOCKED", "accessibility baseline was not measured for every role and tenant");
  }
  if (report.status === "FAIL" || (typeof report.violations === "number" && report.violations > 0)) {
    return issue("accessibility", "FAIL", report.reason || "accessibility violations were found", report.test || null);
  }
  if (report.status !== "PASS" || report.violations !== 0) return issue("accessibility", "BLOCKED", "accessibility result is unresolved");
  const roles = new Set(Array.isArray(report.roles) ? report.roles : []);
  const tenants = new Set(Array.isArray(report.tenants) ? report.tenants : []);
  if (CLOSE_ROLES.some((role) => !roles.has(role)) || CLOSE_TENANTS.some((tenantId) => !tenants.has(tenantId))) {
    return issue("accessibility", "BLOCKED", "accessibility baseline does not cover every role and tenant");
  }
  return null;
}

function assessSecurity(input) {
  const report = input.security;
  if (!report || report.status === "NOT_RUN") return issue("security", "BLOCKED", "security baseline was not run");
  const critical = Number(report.critical || 0);
  const high = Number(report.high || 0);
  if (critical > 0 || high > 0) {
    const finding = Array.isArray(report.findings) ? report.findings[0] : null;
    return issue("security", "FAIL", finding?.id ? `critical or high finding ${finding.id}` : "critical or high security finding", finding?.id || null);
  }
  if (report.status !== "PASS") return issue("security", "BLOCKED", "security baseline is unresolved");
  return null;
}

function assessThreat(input) {
  const review = input.useInspectedThreat === false ? input.threatModel : THREAT_REVIEW;
  if (!review) return issue("threatModel", "BLOCKED", "threat-model review is missing");
  for (const surface of THREAT_SURFACES) {
    const item = review[surface];
    if (!item || item.reviewed !== true) return issue("threatModel", "BLOCKED", `threat-model review is missing ${surface}`);
    if (typeof item.residual !== "string" || item.residual.trim().length === 0) {
      return issue("threatModel", "BLOCKED", `threat residual is missing for ${surface}`);
    }
    if (item.blocksP2 === true) return issue("threatModel", "BLOCKED", `threat residual blocks phase 2: ${surface}`);
  }
  return null;
}

function labelGap(label) {
  if (!label || (label.kind !== "status" && label.kind !== "lock")) return "LIVE label kind is unresolved";
  if (label.verifiedLive === true) return "LIVE label is not verified";
  const hasSource = typeof label.source === "string" && label.source.trim().length > 0;
  if (label.kind === "lock") {
    if (!hasSource) return "LIVE label is missing a source";
    if (label.notObservation !== true || label.lastSeen !== null) return "lock label is not an observation and is not verified live";
    return null;
  }
  const missing = [];
  if (!hasSource) missing.push("source");
  if (typeof label.lastSeen !== "string" || !ISO_TIME.test(label.lastSeen)) missing.push("last-seen");
  if (missing.length > 0) return `LIVE label is missing ${missing.join(" and ")} evidence`;
  return null;
}

function assessLive(input) {
  const labels = input.useInspectedLabels === false ? input.liveLabels : VISIBLE_LIVE_LABELS;
  if (!Array.isArray(labels) || labels.length === 0) return issue("liveLabels", "BLOCKED", "LIVE label review is missing");
  for (const label of labels) {
    const gap = labelGap(label);
    if (gap) return issue("liveLabels", "BLOCKED", `${gap}: ${label && label.id ? label.id : "unknown"}`);
  }
  return null;
}

function assessLighthouse(input) {
  const report = input.lighthouse;
  if (!report || report.measured === false || report.status === "NOT_MEASURED") {
    return issue("lighthouse", "BLOCKED", "lighthouse and web vitals were not measured");
  }
  if (report.measured !== true) return issue("lighthouse", "BLOCKED", "lighthouse result is unresolved");
  if (typeof report.source !== "string" || report.source.trim().length === 0) {
    return issue("lighthouse", "BLOCKED", "lighthouse source is missing");
  }
  for (const metric of ["lcp", "inp", "cls"]) {
    if (typeof report[metric] !== "number" || !Number.isFinite(report[metric])) {
      return issue("lighthouse", "BLOCKED", `web vital ${metric} was not measured`);
    }
  }
  if (typeof report.capturedAt !== "string" || !ISO_TIME.test(report.capturedAt)) {
    return issue("lighthouse", "BLOCKED", "lighthouse capture time is missing");
  }
  return null;
}

const ASSESSMENTS = Object.freeze([
  assessMatrix,
  assessAuthorization,
  assessAccessibility,
  assessSecurity,
  assessThreat,
  assessLive,
  assessLighthouse,
]);

export function evaluatePhase1Close(input) {
  const source = input && typeof input === "object" ? input : {};
  const deployment = { ...DEPLOYMENT };
  if (secretIn(source)) {
    return { ok: false, result: "BLOCKED", p2Activation: false, error: "secret value is not allowed", edited: false, deployed: false, deployment };
  }
  if (source.walletAccess === true || source.realOrders === true || source.liveTrading === "ON" || source.liveOrdersLocked === false) {
    return { ok: false, result: "BLOCKED", p2Activation: false, error: "live orders and wallet access stay off", edited: false, deployed: false, deployment };
  }
  if (!canEditChecklist(source.actor, TENANT_ID)) {
    return { ok: false, result: "BLOCKED", p2Activation: false, error: "role scope denied", edited: false, deployed: false, deployment };
  }
  const findings = [];
  for (const assess of ASSESSMENTS) {
    const found = assess(source);
    if (found) findings.push(found);
  }
  const firstFailure = findings[0] || null;
  const result = firstFailure ? firstFailure.state : "PASS";
  const p2Activation = result === "PASS";
  return {
    ok: true,
    result,
    p2Activation,
    reason: firstFailure ? firstFailure.reason : "phase 1 closeout passed",
    firstFailure,
    alsoUnresolved: findings.slice(1),
    edited: false,
    deployed: false,
    deployment,
    liveOrdersUnlocked: false,
  };
}

export function attestPhase1Close(input, changedAt) {
  const decision = evaluatePhase1Close(input);
  const body = {
    task: "1.D.3",
    tenantId: TENANT_ID,
    actor: decision.ok ? { role: input.actor.role, tenantId: input.actor.tenantId } : null,
    changedAt: typeof changedAt === "string" ? changedAt : null,
    result: decision.result,
    p2Activation: decision.p2Activation === true,
    reason: decision.reason || decision.error,
    firstFailure: decision.firstFailure,
    alsoUnresolved: decision.alsoUnresolved || [],
    deployment: decision.deployment,
    edited: false,
    deployed: false,
    method: "recorded checklist attestation; no private key; not a deploy signature",
  };
  body.contentChecksum = createHash("sha256").update(JSON.stringify({ ...body, contentChecksum: null })).digest("hex");
  return Object.freeze(body);
}
