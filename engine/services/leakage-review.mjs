// Leakage review and report export for TASK 13.C.02.
// The checklist is lookahead, survivorship, selection, and label leakage.
// Lookahead reuses the feature-quality check. Design page 8 says a feature
// comes only from data up to the decision time, and the label is the future return.
// A feature taken from that future interval, or a label that is not after the
// decision, is label leakage.
// The source names no survivorship threshold and no selection criterion.
// A non-survivor missing from the sample is survivorship. A sample that differs
// from the declared candidates is selection.
// The export names the reviewer and the evidence and keeps those limitations.
// The seed is not used. This module does not place an order.

import { checkFeatureQuality } from "./feature-quality.mjs";
import { resolveExperimentRerun } from "./experiment-manifests.mjs";

const DIGITS = /^(?:0|[1-9]\d*)$/;
const EMAIL = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i;
const INPUT_KEYS = Object.freeze([
  "actor",
  "evidence",
  "runId",
  "universe",
  "candidates",
  "rows",
]);
const ACTOR_KEYS = Object.freeze(["id", "role", "tenantId"]);
const MEMBER_KEYS = Object.freeze(["id", "survived"]);
const ROW_KEYS = Object.freeze([
  "id",
  "cutoff",
  "receiveTime",
  "lagThreshold",
  "features",
  "label",
]);
const LABEL_KEYS = Object.freeze(["outcomeTime"]);

export const LEAKAGE_CHECKLIST = Object.freeze([
  "lookahead",
  "survivorship",
  "selection",
  "label leakage",
]);

export const LEAKAGE_LIMITATIONS = Object.freeze([
  "survivorship threshold is NOT IN SOURCE",
  "selection criterion is NOT IN SOURCE",
  "a leakage score is NOT IN SOURCE",
  "experiment tenant is NOT IN SOURCE",
]);

function fail(error) {
  return Object.freeze({
    ok: false,
    blocked: "BLOCKED",
    error,
    caught: false,
    reviewer: null,
    evidence: null,
    limitations: null,
    checklist: null,
    result: null,
  });
}

function plainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function unknownKey(value, allowed) {
  for (const key of Object.keys(value)) {
    if (!allowed.includes(key)) return true;
  }
  return false;
}

function filled(value) {
  return typeof value === "string" && value.length > 0 && value === value.trim();
}

function leaked(value) {
  return typeof value === "string" && (
    EMAIL.test(value)
    || /bearer\s+/i.test(value)
    || value.includes("BEGIN PRIVATE KEY")
    || /seed phrase/i.test(value)
  );
}

function named(value, missing) {
  if (value === undefined || value === null || (typeof value === "string" && value.trim() === "")) {
    return { ok: false, error: missing };
  }
  if (!filled(value)) return { ok: false, error: "unsupported field" };
  if (leaked(value)) return { ok: false, error: "secret value is not allowed" };
  return { ok: true, value };
}

function timeValue(value) {
  if (typeof value === "number") return Number.isSafeInteger(value) && value >= 0;
  return typeof value === "string" && DIGITS.test(value);
}

function timeBig(value) {
  return BigInt(typeof value === "number" ? String(value) : value);
}

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const key of Object.keys(value)) deepFreeze(value[key]);
  return Object.freeze(value);
}

function actorOf(actor) {
  if (!plainObject(actor) || unknownKey(actor, ACTOR_KEYS)) return { ok: false, error: "unsupported field" };
  if (actor.role !== "Admin" || !filled(actor.id) || !filled(actor.tenantId)) {
    return { ok: false, error: "role scope denied" };
  }
  if (leaked(actor.id) || leaked(actor.tenantId)) return { ok: false, error: "secret value is not allowed" };
  return {
    ok: true,
    reviewer: { id: actor.id, role: actor.role, tenantId: actor.tenantId },
  };
}

function entry(kind, caught, extra = {}) {
  return {
    kind,
    caught,
    check: caught ? extra.check : null,
    id: caught ? (extra.id ?? null) : null,
    feature: caught ? (extra.feature ?? null) : null,
    source: caught ? (extra.source ?? null) : null,
  };
}

function boundsOf(feature) {
  if (!plainObject(feature) || !plainObject(feature.window)) return null;
  if (!timeValue(feature.eventTime) || !timeValue(feature.window.from) || !timeValue(feature.window.to)) {
    return null;
  }
  return [
    timeBig(feature.eventTime),
    timeBig(feature.window.from),
    timeBig(feature.window.to),
  ];
}

function quality(row, feature, asOf) {
  return checkFeatureQuality({
    asOf,
    receiveTime: row.receiveTime,
    lagThreshold: row.lagThreshold,
    features: [feature],
  });
}

function inspectRows(rows) {
  const lookahead = [];
  const labelLeak = [];
  let withheld = null;
  for (const row of rows) {
    const cutoff = timeBig(row.cutoff);
    const outcome = timeBig(row.label.outcomeTime);
    let clockLeak = outcome <= cutoff;
    for (const feature of row.features) {
      const bounds = boundsOf(feature);
      if (!bounds) {
        const checked = quality(row, feature, row.cutoff);
        if (!checked.ok && !checked.check) return { ok: false, error: checked.error };
        if (checked.check === "lookahead window") {
          lookahead.push({ feature: checked.feature, source: checked.source });
        } else if (!checked.ok) {
          withheld = withheld ?? checked.error;
        }
        continue;
      }
      const beyond = outcome > cutoff && bounds.some((bound) => bound > outcome);
      const inLabel = bounds.some((bound) => bound > cutoff);
      if (beyond) {
        const checked = quality(row, feature, row.label.outcomeTime);
        if (!checked.ok && !checked.check) return { ok: false, error: checked.error };
        if (checked.ok || checked.check === "lookahead window") {
          lookahead.push({
            feature: checked.feature ?? feature.name,
            source: checked.source ?? feature.source,
          });
        } else {
          withheld = withheld ?? checked.error;
        }
        continue;
      }
      if (inLabel) {
        const asOf = bounds.reduce((max, bound) => (bound > max ? bound : max)).toString();
        const checked = quality(row, feature, asOf);
        if (!checked.ok && !checked.check) return { ok: false, error: checked.error };
        if (!checked.ok && checked.check !== "lookahead window") {
          withheld = withheld ?? checked.error;
          continue;
        }
        labelLeak.push({
          feature: checked.feature ?? feature.name,
          source: checked.source ?? feature.source,
        });
        clockLeak = false;
        continue;
      }
      const checked = quality(row, feature, row.cutoff);
      if (!checked.ok && !checked.check) return { ok: false, error: checked.error };
      if (checked.check === "lookahead window") {
        lookahead.push({ feature: checked.feature, source: checked.source });
      } else if (!checked.ok) {
        withheld = withheld ?? checked.error;
      }
    }
    if (clockLeak) labelLeak.push({ feature: null, source: null });
  }
  return { ok: true, lookahead, labelLeak, withheld };
}

function membersOf(value) {
  if (!Array.isArray(value) || value.length === 0) return { ok: false, error: "universe is not configured" };
  const members = [];
  const seen = new Set();
  for (const member of value) {
    if (!plainObject(member) || unknownKey(member, MEMBER_KEYS)) return { ok: false, error: "unsupported field" };
    const id = named(member.id, "universe is not configured");
    if (!id.ok) return id;
    if (seen.has(id.value)) return { ok: false, error: "universe is already recorded" };
    seen.add(id.value);
    if (typeof member.survived !== "boolean") return { ok: false, error: "survivorship is not configured" };
    members.push({ id: id.value, survived: member.survived });
  }
  return { ok: true, members };
}

function candidatesOf(value) {
  if (!Array.isArray(value) || value.length === 0) return { ok: false, error: "candidate is not configured" };
  const candidates = [];
  const seen = new Set();
  for (const candidate of value) {
    const id = named(candidate, "candidate is not configured");
    if (!id.ok) return id;
    if (seen.has(id.value)) return { ok: false, error: "candidate is already recorded" };
    seen.add(id.value);
    candidates.push(id.value);
  }
  return { ok: true, candidates };
}

function rowsOf(value) {
  if (!Array.isArray(value) || value.length === 0) return { ok: false, error: "sample is not configured" };
  const rows = [];
  const seen = new Set();
  for (const row of value) {
    if (!plainObject(row) || unknownKey(row, ROW_KEYS)) return { ok: false, error: "unsupported field" };
    const id = named(row.id, "sample is not configured");
    if (!id.ok) return id;
    if (seen.has(id.value)) return { ok: false, error: "sample is already recorded" };
    seen.add(id.value);
    if (!timeValue(row.cutoff)) {
      return { ok: false, error: row.cutoff == null || row.cutoff === "" ? "decision time is not configured" : "unsupported field" };
    }
    if (!plainObject(row.label) || unknownKey(row.label, LABEL_KEYS)) {
      return { ok: false, error: "unsupported field" };
    }
    if (!timeValue(row.label.outcomeTime)) {
      return {
        ok: false,
        error: row.label.outcomeTime == null || row.label.outcomeTime === ""
          ? "label is not configured"
          : "unsupported field",
      };
    }
    if (!Array.isArray(row.features) || row.features.length === 0) {
      return { ok: false, error: "feature is not configured" };
    }
    rows.push(row);
  }
  return { ok: true, rows };
}

export function exportLeakageReview(store, input) {
  if (!plainObject(input) || unknownKey(input, INPUT_KEYS)) return fail("unsupported field");
  if (input.actor == null) return fail("reviewer is not configured");
  const actor = actorOf(input.actor);
  if (!actor.ok) return fail(actor.error);
  const evidence = named(input.evidence, "evidence is not configured");
  if (!evidence.ok) return fail(evidence.error);
  const runId = named(input.runId, "run is not configured");
  if (!runId.ok) return fail(runId.error);
  const resolved = resolveExperimentRerun(store, { runId: runId.value });
  if (!resolved.resolved) return fail(resolved.error);
  const universe = membersOf(input.universe);
  if (!universe.ok) return fail(universe.error);
  const candidates = candidatesOf(input.candidates);
  if (!candidates.ok) return fail(candidates.error);
  const parsed = rowsOf(input.rows);
  if (!parsed.ok) return fail(parsed.error);
  const inspected = inspectRows(parsed.rows);
  if (!inspected.ok) return fail(inspected.error);

  const rowIds = new Set(parsed.rows.map((row) => row.id));
  const candidateIds = new Set(candidates.candidates);
  const dropped = universe.members.find((member) => member.survived === false && !rowIds.has(member.id));
  const droppedIds = new Set(
    universe.members.filter((member) => member.survived === false && !rowIds.has(member.id)).map((member) => member.id),
  );
  const omitted = candidates.candidates.find((id) => !rowIds.has(id) && !droppedIds.has(id));
  const extra = parsed.rows.find((row) => !candidateIds.has(row.id) && !droppedIds.has(row.id));
  const selected = omitted ?? extra?.id ?? null;
  const ahead = inspected.lookahead[0] ?? null;
  const labeled = inspected.labelLeak[0] ?? null;

  const checklist = [
    entry("lookahead", Boolean(ahead), {
      check: "lookahead window",
      feature: ahead?.feature ?? null,
      source: ahead?.source ?? null,
    }),
    entry("survivorship", Boolean(dropped), {
      check: "survivorship",
      id: dropped?.id ?? null,
    }),
    entry("selection", Boolean(selected), {
      check: "selection",
      id: selected,
    }),
    entry("label leakage", Boolean(labeled), {
      check: "label leakage",
      feature: labeled?.feature ?? null,
      source: labeled?.source ?? null,
    }),
  ];
  const hit = checklist.find((item) => item.caught);
  const ok = !hit && inspected.withheld == null;
  return deepFreeze({
    ok,
    blocked: ok ? null : "BLOCKED",
    error: ok ? null : (hit ? hit.check : inspected.withheld),
    caught: Boolean(hit),
    reviewer: actor.reviewer,
    evidence: evidence.value,
    limitations: LEAKAGE_LIMITATIONS,
    checklist,
    result: {
      runId: resolved.runId,
      codeSha: resolved.codeSha,
      modelVersion: resolved.modelVersion,
      dataVersion: resolved.dataVersion,
      featureVersion: resolved.featureVersion,
      configChecksum: resolved.configChecksum,
      outputChecksum: resolved.outputChecksum,
      seedUsed: false,
      sampleSize: parsed.rows.length,
      rows: parsed.rows.map((row) => row.id),
    },
  });
}
