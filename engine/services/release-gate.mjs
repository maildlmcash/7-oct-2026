import { CHECKLIST_STATUSES } from "./checklist-status.mjs";
import { canEditChecklist } from "./checklist-status-view.mjs";

// The source names no numeric release threshold. An empty configuration fails closed.
// FAIL and BLOCKED are existing checklist statuses. The caller chooses which of the
// known statuses block. This module does not edit code or deploy a fix.
const STATUS_SET = new Set(CHECKLIST_STATUSES);
const RESOLVED = new Set(["PASS", "NOT_APPLICABLE"]);

function blank(value) {
  return typeof value !== "string" || value.trim().length === 0;
}

function knownThreshold(value) {
  const statuses = value && Array.isArray(value.blockingStatuses) ? value.blockingStatuses : null;
  if (!statuses || statuses.length === 0) return { ok: false, error: "release threshold is not configured" };
  if (statuses.some((status) => !STATUS_SET.has(status))) return { ok: false, error: "invalid status" };
  return { ok: true, blockingStatuses: statuses };
}

function evidenceUrl(value) {
  const url = typeof value === "string" ? value : value?.url;
  if (blank(url)) return { ok: false, error: "evidence reference is required" };
  return { ok: true, url: url.trim() };
}

function appendAudit(store, input, result, reason) {
  const row = Object.freeze({
    tenantId: input.tenantId,
    actor: input.actor,
    action: "release-gate",
    target: typeof input.target === "string" && input.target.length > 0 ? input.target : "release",
    reason,
    result,
    changedAt: typeof input.changedAt === "string" ? input.changedAt : null,
    configChecksum: null,
    edited: false,
    deployed: false,
  });
  store.audits.push(row);
  return row;
}

export function createReleaseGate() {
  return { audits: [], reruns: [] };
}

export function recordReleaseRerun(store, input) {
  const source = input && typeof input === "object" ? input : {};
  if (!canEditChecklist(source.actor, source.tenantId)) {
    return { ok: false, error: "role scope denied" };
  }
  if (!STATUS_SET.has(source.result)) return { ok: false, error: "invalid status" };
  if (blank(source.fingerprint)) return { ok: false, error: "unknown finding" };
  const evidence = evidenceUrl(source.evidence);
  if (!evidence.ok) return evidence;
  const rerun = Object.freeze({
    tenantId: source.tenantId,
    fingerprint: source.fingerprint,
    result: source.result,
    evidence: evidence.url,
    at: typeof source.at === "string" ? source.at : null,
  });
  store.reruns.push(rerun);
  return { ok: true, rerun };
}

export function evaluateReleaseGate(store, input) {
  const source = input && typeof input === "object" ? input : {};
  if (!canEditChecklist(source.actor, source.tenantId)) {
    return { ok: false, error: "role scope denied", edited: false, deployed: false };
  }
  const findings = Array.isArray(source.findings) ? source.findings : [];
  const scoped = findings.filter((finding) => finding && finding.tenantId === source.tenantId);
  const threshold = knownThreshold(source.threshold);
  let result = "passed";
  let reason = "release gate passed";
  if (!threshold.ok) {
    result = "blocked";
    reason = threshold.error;
  } else if (scoped.some((finding) => threshold.blockingStatuses.includes(finding.status))) {
    result = "blocked";
    reason = "critical checklist failure";
  } else {
    const unmet = scoped.filter((finding) => {
      if (!RESOLVED.has(finding.status)) return false;
      const evidence = finding.remediationEvidence ?? [];
      if (evidence.length === 0) return true;
      const latest = evidence[evidence.length - 1].url;
      return !store.reruns.some((rerun) => (
        rerun.tenantId === source.tenantId
        && rerun.fingerprint === finding.fingerprint
        && rerun.evidence === latest
        && !threshold.blockingStatuses.includes(rerun.result)
      ));
    });
    if (unmet.length > 0) {
      result = "blocked";
      reason = "rerun is required";
    }
  }
  const audit = appendAudit(store, source, result, reason);
  return {
    ok: result === "passed",
    result,
    reason,
    blocked: result === "blocked" ? "BLOCKED" : null,
    edited: false,
    deployed: false,
    audit,
  };
}
