export const CHECKLIST_AREAS = Object.freeze([
  "website",
  "API",
  "data engine",
  "mobile iOS",
  "mobile Android",
  "security",
  "performance",
  "backup",
  "release",
]);

const AREA_SET = new Set(CHECKLIST_AREAS);

export function createTemplateStore() {
  return { nextId: 1, templates: [], audits: [] };
}

function blank(value) {
  return typeof value !== "string" || value.trim().length === 0;
}

function denied(actor, tenantId) {
  if (!actor || actor.role !== "Admin" || actor.tenantId !== tenantId) {
    return { ok: false, error: "role scope denied" };
  }
  return null;
}

function requireText(value, error) {
  if (blank(value)) {
    return { ok: false, error };
  }
  return null;
}

export function assertAreaCoverage(areas) {
  if (areas.includes("mobile")) {
    return { ok: false, error: "mobile lists must be separate" };
  }
  const counts = new Map();
  for (const area of areas) {
    if (!AREA_SET.has(area)) {
      return { ok: false, error: "unknown checklist area" };
    }
    counts.set(area, (counts.get(area) ?? 0) + 1);
  }
  for (const area of CHECKLIST_AREAS) {
    if (counts.get(area) !== 1) {
      return { ok: false, error: "project checklist must cover each area once" };
    }
  }
  return { ok: true };
}

function writeAudit(store, input) {
  store.audits.push({
    tenantId: input.tenantId,
    actor: input.actor,
    beforeValue: input.beforeValue,
    afterValue: input.afterValue,
    reason: input.reason ?? null,
    approval: input.approval ?? null,
    changedAt: input.changedAt,
    configChecksum: null,
    lineageId: input.lineageId,
  });
}

function snapshot(template) {
  return JSON.stringify({
    id: template.id,
    lineageId: template.lineageId,
    version: template.version,
    areaPlatform: template.areaPlatform,
    requirement: template.requirement,
    retiredAt: template.retiredAt,
  });
}

export function createTemplate(store, input) {
  const tenantId = input.project?.tenantId;
  const denial = denied(input.actor, tenantId);
  if (denial) {
    return denial;
  }
  if (!AREA_SET.has(input.areaPlatform)) {
    return { ok: false, error: "unknown checklist area" };
  }
  for (const [value, error] of [
    [input.requirement, "requirement is required"],
    [input.testMethod, "test method is required"],
    [input.expectedValue, "expected value is required"],
    [input.version, "version is required"],
    [input.changedAt, "changedAt is required"],
  ]) {
    const missing = requireText(value, error);
    if (missing) {
      return missing;
    }
  }
  const id = store.nextId;
  store.nextId += 1;
  const template = {
    id,
    tenantId,
    projectId: input.project.id,
    lineageId: id,
    areaPlatform: input.areaPlatform,
    requirement: input.requirement,
    testMethod: input.testMethod,
    expectedValue: input.expectedValue,
    owner: input.owner ?? null,
    dependencyGate: input.dependencyGate ?? null,
    version: input.version,
    retiredAt: null,
  };
  store.templates.push(template);
  writeAudit(store, {
    tenantId,
    actor: input.actor.id,
    beforeValue: null,
    afterValue: snapshot(template),
    reason: input.reason ?? null,
    changedAt: input.changedAt,
    lineageId: id,
  });
  return { ok: true, template };
}

export function createProjectChecklists(store, input) {
  const coverage = assertAreaCoverage(input.entries.map((entry) => entry.areaPlatform));
  if (!coverage.ok) {
    return coverage;
  }
  const templates = [];
  for (const entry of input.entries) {
    const created = createTemplate(store, { ...input, ...entry });
    if (!created.ok) {
      return created;
    }
    templates.push(created.template);
  }
  return { ok: true, templates };
}

function lineageTemplates(store, lineageId) {
  return store.templates.filter((template) => template.lineageId === lineageId);
}

export function readTemplateHistory(store, input) {
  const versions = lineageTemplates(store, input.lineageId);
  if (versions.length === 0) {
    return { ok: false, error: "template not found" };
  }
  const denial = denied(input.actor, versions[0].tenantId);
  if (denial) {
    return denial;
  }
  const audits = store.audits.filter((audit) => audit.lineageId === input.lineageId);
  return {
    ok: true,
    versions: versions.map((template) => ({ ...template })),
    audits: audits.map((audit) => ({ ...audit })),
  };
}

export function updateTemplate(store, input) {
  const versions = lineageTemplates(store, input.lineageId);
  if (versions.length === 0) {
    return { ok: false, error: "template not found" };
  }
  const current = [...versions].reverse().find((template) => template.retiredAt == null);
  if (!current) {
    return { ok: false, error: "template is retired" };
  }
  const denial = denied(input.actor, current.tenantId);
  if (denial) {
    return denial;
  }
  if (input.areaPlatform != null && input.areaPlatform !== current.areaPlatform) {
    return { ok: false, error: "area cannot change" };
  }
  for (const [value, error] of [
    [input.version, "version is required"],
    [input.changedAt, "changedAt is required"],
  ]) {
    const missing = requireText(value, error);
    if (missing) {
      return missing;
    }
  }
  const id = store.nextId;
  store.nextId += 1;
  const template = {
    ...current,
    id,
    requirement: input.requirement ?? current.requirement,
    testMethod: input.testMethod ?? current.testMethod,
    expectedValue: input.expectedValue ?? current.expectedValue,
    owner: input.owner === undefined ? current.owner : input.owner,
    dependencyGate: input.dependencyGate === undefined ? current.dependencyGate : input.dependencyGate,
    version: input.version,
    retiredAt: null,
  };
  store.templates.push(template);
  writeAudit(store, {
    tenantId: current.tenantId,
    actor: input.actor.id,
    beforeValue: snapshot(current),
    afterValue: snapshot(template),
    reason: input.reason ?? null,
    changedAt: input.changedAt,
    lineageId: current.lineageId,
  });
  return { ok: true, template };
}

export function retireTemplate(store, input) {
  const versions = lineageTemplates(store, input.lineageId);
  if (versions.length === 0) {
    return { ok: false, error: "template not found" };
  }
  const denial = denied(input.actor, versions[0].tenantId);
  if (denial) {
    return denial;
  }
  const missing = requireText(input.changedAt, "changedAt is required");
  if (missing) {
    return missing;
  }
  for (const template of versions) {
    if (template.retiredAt == null) {
      template.retiredAt = input.changedAt;
    }
  }
  writeAudit(store, {
    tenantId: versions[0].tenantId,
    actor: input.actor.id,
    beforeValue: snapshot(versions[versions.length - 1]),
    afterValue: JSON.stringify({ lineageId: input.lineageId, retiredAt: input.changedAt }),
    reason: input.reason ?? null,
    changedAt: input.changedAt,
    lineageId: input.lineageId,
  });
  return { ok: true, versions: versions.map((template) => ({ ...template })) };
}
