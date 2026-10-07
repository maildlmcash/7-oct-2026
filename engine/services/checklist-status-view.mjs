import { checklistPrerequisiteUnresolved } from "./checklist-status.mjs";

export const STATUS_VIEW_COUNTS = Object.freeze(["PASS", "FAIL", "BLOCKED", "STALE"]);

// Customer is the user-facing reader. Admin of the same tenant is the only editor.
// Other roles stay denied. UNKNOWN/STALE is not counted as the STALE total.
const USER_FACING_READ_ROLE = "Customer";
const ADMIN_EDIT_ROLE = "Admin";

function blank(value) {
  return typeof value !== "string" || value.trim().length === 0;
}

function sameTenant(actor, tenantId) {
  return Boolean(actor) && actor.tenantId === tenantId;
}

export function canReadChecklistStatus(actor, tenantId) {
  if (!sameTenant(actor, tenantId)) {
    return false;
  }
  return actor.role === USER_FACING_READ_ROLE || actor.role === ADMIN_EDIT_ROLE;
}

export function canEditChecklist(actor, tenantId) {
  return sameTenant(actor, tenantId) && actor.role === ADMIN_EDIT_ROLE;
}

function emptyCounts() {
  return { PASS: 0, FAIL: 0, BLOCKED: 0, STALE: 0 };
}

function ownerText(owner) {
  return blank(owner) ? "UNKNOWN" : owner.trim();
}

function copyRecord(record) {
  return {
    id: record.id,
    tenantId: record.tenantId,
    status: record.status,
    owner: record.owner ?? null,
    evidenceLinks: [...(record.evidenceLinks ?? [])],
    prerequisites: (record.prerequisites ?? []).map((item) => ({
      id: item.id,
      status: item.status,
      owner: item.owner ?? null,
      evidenceLinks: [...(item.evidenceLinks ?? [])],
    })),
  };
}

export function createChecklistStatusStore(records = []) {
  return { records: records.map(copyRecord) };
}

export function emptyChecklistStatusView() {
  return {
    state: "empty",
    canEdit: false,
    counts: emptyCounts(),
    unresolvedPrerequisites: [],
    owners: [],
    evidenceLinks: [],
    error: null,
  };
}

function viewFromRecords(records, canEdit) {
  if (records.length === 0) {
    return { ...emptyChecklistStatusView(), canEdit };
  }
  const counts = emptyCounts();
  const unresolvedPrerequisites = [];
  const owners = [];
  const evidenceLinks = [];
  for (const record of records) {
    if (Object.hasOwn(counts, record.status)) {
      counts[record.status] += 1;
    }
    owners.push({ recordId: record.id, owner: ownerText(record.owner) });
    for (const url of record.evidenceLinks) {
      evidenceLinks.push({ recordId: record.id, url });
    }
    for (const prerequisite of record.prerequisites) {
      if (!checklistPrerequisiteUnresolved(prerequisite.status)) {
        continue;
      }
      unresolvedPrerequisites.push({
        recordId: record.id,
        prerequisiteId: prerequisite.id,
        status: prerequisite.status,
        owner: ownerText(prerequisite.owner),
        evidenceLinks: [...prerequisite.evidenceLinks],
      });
      for (const url of prerequisite.evidenceLinks) {
        evidenceLinks.push({ recordId: prerequisite.id, url });
      }
    }
  }
  return {
    state: "ready",
    canEdit,
    counts,
    unresolvedPrerequisites,
    owners,
    evidenceLinks,
    error: null,
  };
}

export function publishChecklistStatus(store, input) {
  const tenantId = input?.tenantId;
  if (!canReadChecklistStatus(input?.actor, tenantId)) {
    return { ok: false, error: "role scope denied" };
  }
  const canEdit = canEditChecklist(input.actor, tenantId);
  if (input.state === "loading") {
    return {
      ok: true,
      view: { ...emptyChecklistStatusView(), state: "loading", canEdit: false },
    };
  }
  if (input.state === "error") {
    return {
      ok: true,
      view: {
        ...emptyChecklistStatusView(),
        state: "error",
        canEdit: false,
        error: blank(input.error) ? "checklist status error" : input.error.trim(),
      },
    };
  }
  const records = store.records.filter((record) => record.tenantId === tenantId);
  return { ok: true, view: viewFromRecords(records, canEdit) };
}

export function editChecklistOwner(store, input) {
  if (!canEditChecklist(input?.actor, input?.tenantId)) {
    return { ok: false, error: "role scope denied" };
  }
  if (blank(input.owner)) {
    return { ok: false, error: "owner is required" };
  }
  const record = store.records.find(
    (item) => item.id === input.recordId && item.tenantId === input.tenantId,
  );
  if (!record) {
    return { ok: false, error: "checklist record not found" };
  }
  const statusBefore = record.status;
  record.owner = input.owner.trim();
  return { ok: true, record: copyRecord(record), status: statusBefore };
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

export function renderChecklistStatusView(view) {
  if (view.state === "loading") {
    return '<section data-checklist-status-view="loading"><p>checklist status loading</p></section>';
  }
  if (view.state === "error") {
    return `<section data-checklist-status-view="error"><p>checklist status error</p><p>${escapeHtml(view.error)}</p></section>`;
  }
  const counts = STATUS_VIEW_COUNTS.map(
    (status) => `<span data-count-${status.toLowerCase()}>${status} ${view.counts[status]}</span>`,
  ).join("");
  const unresolved = view.unresolvedPrerequisites.length === 0
    ? "<p>unresolved prerequisites none</p>"
    : `<ul data-unresolved-prerequisites>${view.unresolvedPrerequisites
      .map((item) => `<li>${escapeHtml(item.prerequisiteId)} ${escapeHtml(item.status)} ${escapeHtml(item.owner)}</li>`)
      .join("")}</ul>`;
  const owners = view.owners.length === 0
    ? "<p>owners none</p>"
    : `<ul data-owners>${view.owners
      .map((item) => `<li>${escapeHtml(item.recordId)} ${escapeHtml(item.owner)}</li>`)
      .join("")}</ul>`;
  const links = view.evidenceLinks.length === 0
    ? "<p>evidence links none</p>"
    : `<ul data-evidence-links>${view.evidenceLinks
      .map((item) => `<li><a href="${escapeHtml(item.url)}">${escapeHtml(item.url)}</a></li>`)
      .join("")}</ul>`;
  const edit = view.state === "ready" && view.canEdit
    ? '<button type="button">Edit checklist</button>'
    : "";
  const label = view.state === "empty" ? "<p>checklist status empty</p>" : "<p>checklist status ready</p>";
  return `<section data-checklist-status-view="${view.state}">${label}${counts}${unresolved}${owners}${links}${edit}</section>`;
}
