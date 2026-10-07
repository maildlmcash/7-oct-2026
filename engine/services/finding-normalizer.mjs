import { pageHealthEvent, knownBuildSha } from "../apps/web/page-health.mjs";
import { CHECKLIST_STATUSES } from "./checklist-status.mjs";
import {
  LAYOUT_FAULT_NAMES,
  LAYOUT_SURFACES,
  LAYOUT_VIEWPORT_NAMES,
} from "./layout-faults.mjs";

// The finding table stores dedupe_fingerprint, first_seen, last_seen, and seen_count.
// Severity has no scale in the source, so the field stays null.
const FAIL_STATUS = "FAIL";
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SURFACE_SET = new Set(LAYOUT_SURFACES);
const VIEWPORT_SET = new Set(LAYOUT_VIEWPORT_NAMES);
const FAULT_SET = new Set(LAYOUT_FAULT_NAMES);

function seenAt(value) {
  if (typeof value !== "string" || Number.isNaN(Date.parse(value))) return null;
  return value;
}

function requestId(value) {
  return typeof value === "string" && UUID_PATTERN.test(value) ? value : null;
}

function text(value) {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function platformForRoute(route) {
  return typeof route === "string" && route.startsWith("/api/") ? "API" : "website";
}

function layoutDetail(fault, evidence) {
  const source = evidence && typeof evidence === "object" ? evidence : {};
  if (fault === "overlap") {
    const boxId = text(source.boxId);
    const otherBoxId = text(source.otherBoxId);
    if (!boxId || !otherBoxId) return { ok: false, error: "layout evidence is required" };
    return { ok: true, detail: [boxId, otherBoxId].sort() };
  }
  if (fault === "missing-heading") {
    const heading = text(source.heading);
    if (!heading) return { ok: false, error: "layout evidence is required" };
    return { ok: true, detail: heading };
  }
  if (fault === "broken-link") {
    const linkId = text(source.linkId);
    const reason = source.reason === "missing-href" || source.reason === "http-error" ? source.reason : null;
    if (!linkId || !reason) return { ok: false, error: "layout evidence is required" };
    return { ok: true, detail: [linkId, reason] };
  }
  if (fault === "mobile-viewport") {
    const boxId = text(source.boxId);
    const edge = text(source.edge);
    if (!boxId || !edge) return { ok: false, error: "layout evidence is required" };
    return { ok: true, detail: [boxId, edge] };
  }
  return { ok: true, detail: null };
}

function normalize(signal) {
  const source = signal && typeof signal === "object" ? signal : {};
  const at = seenAt(source.seenAt);
  if (!at) return { ok: false, error: "seen time is required" };

  if (source.source === "page-health") {
    const event = pageHealthEvent(source.event);
    const failed = (event.httpStatus != null && event.httpStatus >= 400) || event.exception === "js-exception";
    if (!failed) return { ok: false, error: "signal is not a failure" };
    const route = event.routeViewId;
    const platform = platformForRoute(route);
    return {
      ok: true,
      fingerprint: JSON.stringify(["page-health", platform, route, event.viewId, event.httpStatus, event.exception]),
      route,
      platform,
      affectedBuild: event.buildSha,
      requestId: requestId(source.event && source.event.requestId),
      seenAt: at,
    };
  }

  if (source.source === "layout") {
    const finding = source.finding && typeof source.finding === "object" ? source.finding : {};
    if (finding.surface === "mobile") return { ok: false, error: "mobile lists must be separate" };
    if (!SURFACE_SET.has(finding.surface)) return { ok: false, error: "unknown layout surface" };
    const viewportName = finding.viewport && finding.viewport.name;
    if (!VIEWPORT_SET.has(viewportName)) return { ok: false, error: "viewport metadata is required" };
    if (!FAULT_SET.has(finding.fault)) return { ok: false, error: "unknown layout fault" };
    const detail = layoutDetail(finding.fault, finding.evidence);
    if (!detail.ok) return detail;
    return {
      ok: true,
      fingerprint: JSON.stringify(["layout", finding.surface, viewportName, finding.fault, detail.detail]),
      route: null,
      platform: finding.surface,
      affectedBuild: knownBuildSha(source.buildSha),
      requestId: null,
      seenAt: at,
    };
  }

  return { ok: false, error: "unknown signal" };
}

function freezeFinding(input) {
  const finding = {
    fingerprint: input.fingerprint,
    severity: null,
    firstSeen: input.firstSeen,
    lastSeen: input.lastSeen,
    affectedBuild: input.affectedBuild,
    route: input.route,
    platform: input.platform,
    status: input.status,
    occurrenceCount: input.occurrences.length,
    occurrences: Object.freeze(input.occurrences),
  };
  if (input.bundle) finding.bundle = input.bundle;
  if (input.tenantId != null) finding.tenantId = input.tenantId;
  if (typeof input.owner === "string") finding.owner = input.owner;
  if (typeof input.dueDate === "string") finding.dueDate = input.dueDate;
  if (typeof input.checklistItemId === "string") finding.checklistItemId = input.checklistItemId;
  if (input.remediationEvidence) finding.remediationEvidence = input.remediationEvidence;
  return Object.freeze(finding);
}

function withOccurrence(normalized) {
  return Object.freeze({
    seenAt: normalized.seenAt,
    affectedBuild: normalized.affectedBuild,
    requestId: normalized.requestId,
  });
}

function seenBounds(occurrences) {
  let first = occurrences[0];
  let last = occurrences[0];
  for (const occurrence of occurrences) {
    const time = Date.parse(occurrence.seenAt);
    if (time < Date.parse(first.seenAt)) first = occurrence;
    if (time >= Date.parse(last.seenAt)) last = occurrence;
  }
  let affectedBuild = null;
  for (const occurrence of occurrences) {
    if (occurrence.affectedBuild) affectedBuild = occurrence.affectedBuild;
  }
  return { firstSeen: first.seenAt, lastSeen: last.seenAt, affectedBuild };
}

export function createFindingLog() {
  return { findings: [] };
}

export function recordSignal(log, signal) {
  if (!CHECKLIST_STATUSES.includes(FAIL_STATUS)) {
    return { ok: false, error: "invalid status" };
  }
  const normalized = normalize(signal);
  if (!normalized.ok) return normalized;
  const occurrence = withOccurrence(normalized);
  const index = log.findings.findIndex((finding) => finding.fingerprint === normalized.fingerprint);
  if (index === -1) {
    const finding = freezeFinding({
      fingerprint: normalized.fingerprint,
      firstSeen: normalized.seenAt,
      lastSeen: normalized.seenAt,
      affectedBuild: normalized.affectedBuild,
      route: normalized.route,
      platform: normalized.platform,
      status: FAIL_STATUS,
      occurrences: [occurrence],
      tenantId: typeof signal?.tenantId === "string" && signal.tenantId.length > 0 ? signal.tenantId : undefined,
    });
    log.findings.push(finding);
    return { ok: true, finding, created: true };
  }

  const current = log.findings[index];
  const occurrences = [...current.occurrences, occurrence];
  const bounds = seenBounds(occurrences);
  const finding = freezeFinding({
    fingerprint: current.fingerprint,
    firstSeen: bounds.firstSeen,
    lastSeen: bounds.lastSeen,
    affectedBuild: bounds.affectedBuild,
    route: current.route,
    platform: current.platform,
    status: current.status,
    occurrences,
    bundle: current.bundle,
    tenantId: current.tenantId,
    owner: current.owner,
    dueDate: current.dueDate,
    checklistItemId: current.checklistItemId,
    remediationEvidence: current.remediationEvidence,
  });
  log.findings[index] = finding;
  return { ok: true, finding, created: false };
}
