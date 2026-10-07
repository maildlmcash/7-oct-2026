export const TECHNOLOGY_TRACKING_STATUSES = Object.freeze([
  "PASS",
  "FAIL",
  "UNKNOWN/STALE",
]);

export const UNKNOWN_FIELD = "UNKNOWN";

const USAGE_KINDS = new Set(["runtime", "build"]);

function blank(value) {
  return typeof value !== "string" || value.trim().length === 0;
}

function displayText(value) {
  return blank(value) ? UNKNOWN_FIELD : value.trim();
}

function evidenceText(items) {
  return items
    .map((item) => (blank(item.detail) ? item.kind : item.detail.trim()))
    .join("; ");
}

function usageKind(items) {
  const kinds = [];
  if (items.some((item) => item.kind === "runtime")) {
    kinds.push("runtime");
  }
  if (items.some((item) => item.kind === "build")) {
    kinds.push("build");
  }
  return kinds.length === 0 ? null : kinds.join(",");
}

export function displayTechnologyTracking(entry) {
  if (blank(entry?.requiredTechnology)) {
    return { ok: false, error: "required technology is required" };
  }
  if (blank(entry?.requiredVersion)) {
    return { ok: false, error: "required version is required" };
  }
  const evidence = entry.evidence ?? [];
  if (!Array.isArray(evidence)) {
    return { ok: false, error: "evidence must be a list" };
  }

  let packagePresence = false;
  const usage = [];
  for (const item of evidence) {
    if (blank(item?.kind)) {
      return { ok: false, error: "evidence kind is required" };
    }
    if (item.kind === "package") {
      packagePresence = true;
      continue;
    }
    if (USAGE_KINDS.has(item.kind)) {
      usage.push(item);
    }
  }

  const fresh = usage.filter((item) => item.stale !== true);
  const evidenceStale = usage.length > 0 && fresh.length === 0;
  let status = "FAIL";
  let detectedUsageEvidence = null;
  if (fresh.length > 0) {
    status = "PASS";
    detectedUsageEvidence = evidenceText(fresh);
  } else if (evidenceStale) {
    status = "UNKNOWN/STALE";
    detectedUsageEvidence = evidenceText(usage);
  }

  const display = {
    requirementId: entry.requirementId ?? null,
    requiredTechnology: entry.requiredTechnology.trim(),
    requiredVersion: entry.requiredVersion.trim(),
    detectedUsageEvidence,
    owner: displayText(entry.owner),
    limitSlo: displayText(entry.limitSlo),
    currentMeasurement: displayText(entry.currentMeasurement),
    lastCheckedAt: blank(entry.lastCheckedAt) ? null : entry.lastCheckedAt.trim(),
    status,
  };

  return {
    ok: true,
    display,
    record: {
      packagePresence,
      usagePresent: usage.length > 0,
      usageKind: usageKind(fresh.length > 0 ? fresh : usage),
      evidenceStale,
      detectedUsageEvidence,
      status,
    },
  };
}

export function displayRequirementTechnology(requirements) {
  if (!Array.isArray(requirements)) {
    return { ok: false, error: "requirements must be a list" };
  }
  const displays = [];
  for (const requirement of requirements) {
    const dependencies = requirement?.dependencies;
    if (!Array.isArray(dependencies) || dependencies.length === 0) {
      return { ok: false, error: "required technology is required" };
    }
    for (const dependency of dependencies) {
      const tracked = displayTechnologyTracking({
        requirementId: requirement.requirementId ?? null,
        owner: requirement.owner,
        ...dependency,
      });
      if (!tracked.ok) {
        return tracked;
      }
      displays.push(tracked.display);
    }
  }
  return { ok: true, displays };
}
