export const CHECKLIST_RUN_PATHS = Object.freeze(["manual", "scheduled"]);

const PATH_SET = new Set(CHECKLIST_RUN_PATHS);

function blank(value) {
  return typeof value !== "string" || value.trim().length === 0;
}

function requestKey(input) {
  return [
    String(input.tenantId),
    String(input.checklistItemId),
    input.path,
    input.environment.trim(),
    input.buildSha.trim(),
    input.startedAt.trim(),
  ].join("\0");
}

function copyRun(run) {
  return {
    id: run.id,
    tenantId: run.tenantId,
    checklistItemId: run.checklistItemId,
    path: run.path,
    environment: run.environment,
    buildSha: run.buildSha,
    startedAt: run.startedAt,
    endedAt: run.endedAt,
    evidence: run.evidence.map((item) => ({ id: item.id, url: item.url })),
    destructiveEnabled: run.destructiveEnabled,
    isolatedTestEnvironment: run.isolatedTestEnvironment,
    result: run.result,
  };
}

export function createRunStore() {
  return { nextId: 1, runs: [] };
}

export function requestChecklistRun(store, input) {
  if (!PATH_SET.has(input?.path)) {
    return { ok: false, error: "run path must be manual or scheduled" };
  }
  if (blank(input.environment)) {
    return { ok: false, error: "environment is required" };
  }
  if (blank(input.buildSha)) {
    return { ok: false, error: "build SHA is required" };
  }
  if (blank(input.startedAt)) {
    return { ok: false, error: "startedAt is required" };
  }
  if (input.tenantId == null || input.checklistItemId == null) {
    return { ok: false, error: "checklist item is required" };
  }
  if (!blank(input.endedAt)) {
    const started = Date.parse(input.startedAt);
    const ended = Date.parse(input.endedAt);
    if (Number.isNaN(started) || Number.isNaN(ended) || ended < started) {
      return { ok: false, error: "endedAt is before startedAt" };
    }
  }

  const evidenceInput = input.evidence ?? [];
  if (!Array.isArray(evidenceInput)) {
    return { ok: false, error: "evidence must be a list" };
  }
  const evidenceUrls = [];
  for (const entry of evidenceInput) {
    const url = typeof entry === "string" ? entry : entry?.url;
    if (blank(url)) {
      return { ok: false, error: "evidence reference is required" };
    }
    evidenceUrls.push(url.trim());
  }

  const key = requestKey(input);
  const existing = store.runs.find((run) => run.requestKey === key);
  if (existing) {
    return { ok: true, run: copyRun(existing), idempotentReplay: true };
  }

  const wantsDestructive = input.destructive === true;
  if (
    wantsDestructive &&
    (input.destructiveChecksConfigured !== true || input.isolatedTestEnvironment !== true)
  ) {
    return { ok: false, error: "destructive checks are disabled" };
  }

  const id = store.nextId;
  store.nextId += 1;
  const run = {
    id,
    requestKey: key,
    tenantId: input.tenantId,
    checklistItemId: input.checklistItemId,
    path: input.path,
    environment: input.environment.trim(),
    buildSha: input.buildSha.trim(),
    startedAt: input.startedAt.trim(),
    endedAt: blank(input.endedAt) ? null : input.endedAt.trim(),
    evidence: evidenceUrls.map((url) => {
      const evidenceId = store.nextId;
      store.nextId += 1;
      return { id: evidenceId, url };
    }),
    destructiveEnabled: wantsDestructive,
    isolatedTestEnvironment: input.isolatedTestEnvironment === true,
    result: "NOT_STARTED",
  };
  store.runs.push(run);
  return { ok: true, run: copyRun(run), idempotentReplay: false };
}
