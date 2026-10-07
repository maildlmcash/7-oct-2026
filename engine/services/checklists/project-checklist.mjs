// Project checklist for task 1.C.2.
// Versions are appended. The older checklist_item status list is not changed.
// No secret, order, or wallet value is stored.

export const PROJECT_CHECK_TEMPLATES = Object.freeze([
  Object.freeze({ id: "web", title: "Web", dependsOn: null }),
  Object.freeze({ id: "api", title: "API", dependsOn: "web" }),
  Object.freeze({ id: "data", title: "Data", dependsOn: "api" }),
  Object.freeze({ id: "scoring", title: "Scoring", dependsOn: "data" }),
  Object.freeze({ id: "paper-engine", title: "Paper engine", dependsOn: "scoring" }),
  Object.freeze({ id: "ios", title: "iOS", dependsOn: "web" }),
  Object.freeze({ id: "android", title: "Android", dependsOn: "web" }),
]);

export const PROJECT_CHECK_STATUSES = Object.freeze([
  "TODO",
  "IN_PROGRESS",
  "PASS",
  "FAIL",
  "BLOCKED",
]);

export const PROJECT_TENANT = "desk";

const TEMPLATE_IDS = new Set(PROJECT_CHECK_TEMPLATES.map((item) => item.id));
const STATUS_SET = new Set(PROJECT_CHECK_STATUSES);
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DAY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const TIME_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/;

export function createProjectChecklistStore() {
  return { records: [], issues: [] };
}

function templateById(id) {
  return PROJECT_CHECK_TEMPLATES.find((item) => item.id === id) ?? null;
}

function blank(value) {
  return typeof value !== "string" || value.trim().length === 0;
}

function unsafe(value) {
  return /bearer|begin private key|seed phrase|api[_-]?key|api[_-]?secret|private[_-]?key/i.test(value);
}

function denied(actor) {
  if (!actor || actor.role !== "Admin" || actor.tenantId !== PROJECT_TENANT) {
    return { ok: false, error: "role scope denied" };
  }
  return null;
}

function versionsOf(store, templateId) {
  return store.records.filter((row) => row.tenantId === PROJECT_TENANT && row.templateId === templateId);
}

function latest(store, templateId) {
  const versions = versionsOf(store, templateId);
  return versions.length > 0 ? versions[versions.length - 1] : null;
}

function effectiveDependsOn(store, templateId) {
  const current = latest(store, templateId);
  if (current) return current.dependsOn;
  return templateById(templateId)?.dependsOn ?? null;
}

function textField(value, error) {
  if (value == null || value === "") return { ok: true, value: null };
  if (typeof value !== "string") return { ok: false, error };
  const trimmed = value.trim();
  if (trimmed.length === 0) return { ok: true, value: null };
  if (trimmed.length > 200 || unsafe(trimmed)) return { ok: false, error: "secret value is not allowed" };
  return { ok: true, value: trimmed };
}

function evidenceLink(value) {
  if (value == null || value === "") return { ok: true, value: null };
  if (typeof value !== "string" || unsafe(value)) return { ok: false, error: "secret value is not allowed" };
  let url;
  try {
    url = new URL(value);
  } catch {
    return { ok: false, error: "evidence link is not a URL" };
  }
  if (url.username || url.password) return { ok: false, error: "secret value is not allowed" };
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return { ok: false, error: "evidence link is not a URL" };
  }
  for (const key of url.searchParams.keys()) {
    if (/key|token|secret/i.test(key)) return { ok: false, error: "secret value is not allowed" };
  }
  return { ok: true, value: url.toString() };
}

function dayValue(value) {
  if (value == null || value === "") return { ok: true, value: null };
  if (typeof value !== "string" || !DAY_PATTERN.test(value) || Number.isNaN(Date.parse(`${value}T00:00:00Z`))) {
    return { ok: false, error: "due date is not valid" };
  }
  return { ok: true, value };
}

function timeValue(value) {
  if (value == null || value === "") return { ok: true, value: null };
  if (typeof value !== "string" || !TIME_PATTERN.test(value) || Number.isNaN(Date.parse(value))) {
    return { ok: false, error: "timestamp is not valid" };
  }
  return { ok: true, value };
}

function dependencyCycle(store, templateId, dependsOn) {
  if (!dependsOn) return false;
  const seen = new Set([templateId]);
  let cursor = dependsOn;
  while (cursor) {
    if (seen.has(cursor)) return true;
    seen.add(cursor);
    cursor = effectiveDependsOn(store, cursor);
  }
  return false;
}

function present(row) {
  return {
    templateId: row.templateId,
    title: row.title,
    version: row.version,
    owner: row.owner,
    dueOn: row.dueOn,
    evidenceUrl: row.evidenceUrl,
    status: row.status,
    dependsOn: row.dependsOn,
    reviewer: row.reviewer,
    reviewedAt: row.reviewedAt,
    recordedAt: row.recordedAt,
    history: row.history.map((item) => ({ ...item })),
  };
}

function presentIssue(row) {
  return {
    correlationId: row.correlationId,
    section: row.section,
    route: row.route,
    httpStatus: row.httpStatus,
    recordedAt: row.recordedAt,
    status: row.status,
  };
}

export function readProjectChecklist(store) {
  const checks = PROJECT_CHECK_TEMPLATES.map((template) => {
    const versions = versionsOf(store, template.id);
    const current = versions[versions.length - 1];
    const history = versions.map((row) => ({
      version: row.version,
      status: row.status,
      recordedAt: row.recordedAt,
    }));
    if (!current) {
      return present({
        templateId: template.id,
        title: template.title,
        version: 0,
        owner: null,
        dueOn: null,
        evidenceUrl: null,
        status: "TODO",
        dependsOn: template.dependsOn,
        reviewer: null,
        reviewedAt: null,
        recordedAt: null,
        history,
      });
    }
    return present({ ...current, history });
  });
  return {
    ok: true,
    truth: "MOCK",
    checks,
    issues: store.issues.filter((row) => row.tenantId === PROJECT_TENANT).map(presentIssue),
  };
}

export function saveProjectCheck(store, input, actor, now = () => new Date().toISOString()) {
  const denial = denied(actor);
  if (denial) return denial;
  const template = templateById(input?.templateId);
  if (!template) return { ok: false, error: "unknown checklist template" };
  if (!STATUS_SET.has(input?.status)) return { ok: false, error: "invalid status" };

  const owner = textField(input.owner, "owner is not valid");
  if (!owner.ok) return owner;
  const dueOn = dayValue(input.dueOn);
  if (!dueOn.ok) return dueOn;
  const evidenceUrl = evidenceLink(input.evidenceUrl);
  if (!evidenceUrl.ok) return evidenceUrl;
  const reviewer = textField(input.reviewer, "reviewer is not valid");
  if (!reviewer.ok) return reviewer;
  const reviewedAt = timeValue(input.reviewedAt);
  if (!reviewedAt.ok) return reviewedAt;

  let dependsOn = input.dependsOn == null || input.dependsOn === "" ? null : input.dependsOn;
  if (dependsOn != null) {
    if (typeof dependsOn !== "string" || !TEMPLATE_IDS.has(dependsOn)) {
      return { ok: false, error: "unknown checklist dependency" };
    }
  }
  if (dependencyCycle(store, template.id, dependsOn)) {
    return { ok: false, error: "checklist dependency cycle" };
  }

  if (input.status === "PASS") {
    if (!evidenceUrl.value) return { ok: false, error: "PASS requires evidence" };
    if (!reviewer.value) return { ok: false, error: "PASS requires a reviewer" };
    if (!reviewedAt.value) return { ok: false, error: "PASS requires a timestamp" };
  }

  if ((input.status === "IN_PROGRESS" || input.status === "PASS") && dependsOn) {
    const upstream = latest(store, dependsOn);
    const upstreamStatus = upstream ? upstream.status : "TODO";
    if (upstreamStatus === "BLOCKED") {
      return { ok: false, error: "a BLOCKED dependency locks the downstream task" };
    }
  }

  const previous = versionsOf(store, template.id);
  const recordedAt = now();
  if (typeof recordedAt !== "string" || !TIME_PATTERN.test(recordedAt)) {
    return { ok: false, error: "timestamp is not valid" };
  }
  const row = {
    tenantId: PROJECT_TENANT,
    templateId: template.id,
    title: template.title,
    version: previous.length + 1,
    owner: owner.value,
    dueOn: dueOn.value,
    evidenceUrl: evidenceUrl.value,
    status: input.status,
    dependsOn,
    reviewer: input.status === "PASS" ? reviewer.value : reviewer.value,
    reviewedAt: input.status === "PASS" ? reviewedAt.value : reviewedAt.value,
    recordedAt,
  };
  store.records.push(row);
  return { ok: true, ...readProjectChecklist(store) };
}

function knownSection(value) {
  if (value == null || value === "") return null;
  const sections = new Set([
    "Dashboard",
    "Market",
    "DEX",
    "Wallets",
    "Predictions",
    "Paper",
    "Search",
    "Checklist",
    "Bugs",
    "Admin",
  ]);
  return typeof value === "string" && sections.has(value) ? value : null;
}

function knownRoute(value) {
  if (value == null || value === "") return null;
  if (typeof value !== "string" || value.length > 80 || unsafe(value)) return null;
  if (!/^\/[a-z0-9/-]+$/.test(value)) return null;
  return value;
}

export function openIssueFromMonitoredError(store, event, actor) {
  const denial = denied(actor);
  if (denial) return denial;
  const source = event && typeof event === "object" ? event : {};
  const httpStatus = source.httpStatus;
  if (!Number.isInteger(httpStatus) || httpStatus < 400 || httpStatus > 599) {
    return { ok: false, error: "monitored event is not an error" };
  }
  if (typeof source.correlationId !== "string" || !UUID_PATTERN.test(source.correlationId)) {
    return { ok: false, error: "monitored event requires a correlation id" };
  }
  const recordedAt = timeValue(source.recordedAt);
  if (!recordedAt.ok) return recordedAt;
  if (!recordedAt.value) return { ok: false, error: "monitored event requires a timestamp" };

  const existing = store.issues.find((row) => (
    row.tenantId === PROJECT_TENANT && row.correlationId === source.correlationId.toLowerCase()
  ));
  if (existing) {
    return { ok: true, duplicate: true, issue: presentIssue(existing), ...readProjectChecklist(store) };
  }
  const issue = {
    tenantId: PROJECT_TENANT,
    correlationId: source.correlationId.toLowerCase(),
    section: knownSection(source.section),
    route: knownRoute(source.route),
    httpStatus,
    recordedAt: recordedAt.value,
    status: "TODO",
  };
  store.issues.push(issue);
  return { ok: true, duplicate: false, issue: presentIssue(issue), ...readProjectChecklist(store) };
}
