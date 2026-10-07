import { scanDiagnostic } from "./diagnostic-bundle.mjs";
import { assertChecklistStatus } from "./checklist-status.mjs";
import { canEditChecklist, canReadChecklistStatus } from "./checklist-status-view.mjs";

// PASS and NOT_APPLICABLE are the existing resolved checklist statuses.
const RESOLVED = new Set(["PASS", "NOT_APPLICABLE"]);

function blank(value) {
  return typeof value !== "string" || value.trim().length === 0;
}

function has(input, key) {
  return Object.prototype.hasOwnProperty.call(input, key);
}

function evidenceUrl(value) {
  const url = typeof value === "string" ? value : value?.url;
  if (blank(url)) return { ok: false, error: "status transition requires evidence" };
  const scan = scanDiagnostic({ url: url.trim() });
  if (!scan.ok) return scan;
  return { ok: true, url: url.trim() };
}

function dueDate(value) {
  if (value == null || value === "") return { ok: true, dueDate: null };
  if (typeof value !== "string" || Number.isNaN(Date.parse(value))) {
    return { ok: false, error: "invalid due date" };
  }
  return { ok: true, dueDate: value };
}

function copyFinding(current, changes) {
  return Object.freeze({
    fingerprint: current.fingerprint,
    severity: null,
    firstSeen: current.firstSeen,
    lastSeen: current.lastSeen,
    affectedBuild: current.affectedBuild,
    route: current.route,
    platform: current.platform,
    status: changes.status,
    occurrenceCount: current.occurrenceCount,
    occurrences: current.occurrences,
    bundle: current.bundle,
    tenantId: changes.tenantId,
    owner: changes.owner,
    dueDate: changes.dueDate,
    checklistItemId: changes.checklistItemId,
    remediationEvidence: changes.remediationEvidence,
  });
}

function ownerText(owner) {
  return blank(owner) ? "UNKNOWN" : owner;
}

export function triageFinding(log, input) {
  const source = input && typeof input === "object" ? input : {};
  if (!canEditChecklist(source.actor, source.tenantId)) {
    return { ok: false, error: "role scope denied" };
  }
  const index = log.findings.findIndex((finding) => finding.fingerprint === source.fingerprint);
  if (index === -1) return { ok: false, error: "unknown finding" };
  const current = log.findings[index];
  if (current.tenantId != null && current.tenantId !== source.tenantId) {
    return { ok: false, error: "role scope denied" };
  }

  let status = current.status;
  if (has(source, "status")) {
    const checked = assertChecklistStatus(source.status);
    if (!checked.ok) return checked;
    status = checked.status;
  }
  const changing = status !== current.status;
  let remediationEvidence = current.remediationEvidence ?? Object.freeze([]);
  if (changing) {
    const evidence = evidenceUrl(source.evidence);
    if (!evidence.ok) return evidence;
    const linked = has(source, "checklistItemId")
      ? source.checklistItemId
      : current.checklistItemId;
    if (RESOLVED.has(status) && blank(linked)) {
      return { ok: false, error: "checklist item is required" };
    }
    remediationEvidence = Object.freeze([
      ...remediationEvidence,
      Object.freeze({ url: evidence.url }),
    ]);
  }

  let owner = current.owner ?? null;
  if (has(source, "owner")) {
    if (blank(source.owner)) return { ok: false, error: "owner is required" };
    owner = source.owner.trim();
  }
  let nextDue = current.dueDate ?? null;
  if (has(source, "dueDate")) {
    const parsed = dueDate(source.dueDate);
    if (!parsed.ok) return parsed;
    nextDue = parsed.dueDate;
  }
  let checklistItemId = current.checklistItemId ?? null;
  if (has(source, "checklistItemId")) {
    if (blank(source.checklistItemId)) return { ok: false, error: "checklist item is required" };
    checklistItemId = source.checklistItemId.trim();
  }

  const finding = copyFinding(current, {
    status,
    tenantId: source.tenantId,
    owner,
    dueDate: nextDue,
    checklistItemId,
    remediationEvidence,
  });
  log.findings[index] = finding;
  return { ok: true, finding };
}

export function viewFinding(log, input) {
  const source = input && typeof input === "object" ? input : {};
  if (!canReadChecklistStatus(source.actor, source.tenantId)) {
    return { ok: false, error: "role scope denied" };
  }
  const finding = log.findings.find((item) => item.fingerprint === source.fingerprint);
  if (!finding) return { ok: false, error: "unknown finding" };
  if (finding.tenantId !== source.tenantId) return { ok: false, error: "role scope denied" };
  const canEdit = canEditChecklist(source.actor, source.tenantId);
  const view = {
    canEdit,
    fingerprint: finding.fingerprint,
    owner: ownerText(finding.owner),
    status: finding.status,
    severity: null,
    dueDate: finding.dueDate ?? null,
    checklistItemId: finding.checklistItemId ?? null,
    remediationEvidence: finding.remediationEvidence ?? Object.freeze([]),
  };
  if (canEdit) view.bundle = finding.bundle ?? null;
  return { ok: true, view: Object.freeze(view) };
}
