// Auditable eligibility for exactly 15 active whale entities.
// Design section 6: do not hard-code wallet addresses and do not invent a current top 15.
// Activity defaults are one material non-internal event in 7 days and three material events in 30 days.
// Materiality is relative to 24h volume and depth. No fixed USD cutoff is named.
// WhaleRank sorts the watchlist. It is not a trade-direction score.
// A transfer is not a buy or a sell. The confidence floor number is NOT IN SOURCE.
// This module does not place orders and does not open a network connection.

const DAY_MS = 86400000;
const UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/;
const UNIT = /^(?:0(?:\.\d+)?|1(?:\.0+)?)$/;
const POSITIVE = /^(?:[1-9]\d*(?:\.\d+)?|0\.\d*[1-9]\d*)$/;
const ASSET = /^[A-Z0-9]+$/;

const INPUT_KEYS = Object.freeze(["asOf", "universe", "gate", "entities"]);
const GATE_KEYS = Object.freeze(["recentDays", "recentMinEvents", "activityDays", "activityMinEvents"]);
const ENTITY_KEYS = Object.freeze([
  "entityId",
  "addresses",
  "chain",
  "labels",
  "labelSource",
  "attributionConfidence",
  "activityRecency",
  "liquidityRelativeSize",
  "verifiedExternalFlow",
  "historicalImpact",
  "evidence",
  "events",
  "labelStale",
  "classificationChanged",
  "providerGap",
  "anomaly",
  "identity",
]);
const EVIDENCE_KEYS = Object.freeze(["source", "reference", "observedAt", "verifiedAt"]);
const EVENT_KEYS = Object.freeze([
  "eventId",
  "at",
  "asset",
  "kind",
  "internal",
  "selfTransfer",
  "from",
  "to",
  "usdValue",
  "volume24h",
  "depth",
  "direction",
]);
const DIRECTIONAL_KINDS = Object.freeze(["dex swap", "venue flow", "verified execution"]);
const EVENT_KINDS = Object.freeze(["transfer", ...DIRECTIONAL_KINDS]);

export const WHALE_LIST_SIZE = 15;
export const WHALE_RANK_WEIGHTS = Object.freeze({
  activityRecency: "0.30",
  liquidityRelativeSize: "0.25",
  attributionConfidence: "0.20",
  verifiedExternalFlow: "0.15",
  historicalImpact: "0.10",
});
export const DEFAULT_ACTIVITY_GATE = Object.freeze({
  recentDays: 7,
  recentMinEvents: 1,
  activityDays: 30,
  activityMinEvents: 3,
});
export const DEFAULT_UNIVERSE = Object.freeze(["BTC", "ETH", "SOL", "BNB"]);
export const EXCLUDED_LABELS = Object.freeze([
  "dormant",
  "deactivated",
  "exchange",
  "bridge",
  "custodian",
  "treasury migration",
  "smart contract",
  "router",
  "self-transfer",
]);

const LABEL_REASONS = Object.freeze([
  ["dormant", "dormant", "Dormant account."],
  ["deactivated", "deactivated", "Deactivated account."],
  ["exchange", "exchange wallet", "Exchange wallet. Internal transfers are not buys or sells."],
  ["bridge", "bridge wallet", "Bridge wallet."],
  ["custodian", "custodian", "Custodian wallet."],
  ["treasury migration", "treasury migration", "Treasury migration."],
  ["smart contract", "smart contract", "Smart contract."],
  ["router", "router", "Router."],
  ["self-transfer", "self-transfer", "Likely self-transfer."],
  ["ambiguous", "low attribution confidence", "Ambiguous attribution."],
  ["low-confidence", "low attribution confidence", "Low attribution confidence."],
]);

function plainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function unknownKey(value, allowed) {
  for (const key of Object.keys(value)) {
    if (!allowed.includes(key)) return true;
  }
  return false;
}

function text(value) {
  return typeof value === "string" && value.length > 0 && value === value.trim();
}

function parseUtc(value) {
  if (typeof value !== "string" || !UTC.test(value)) return null;
  const ms = Date.parse(value);
  if (!Number.isFinite(ms)) return null;
  return ms;
}

function unit(value) {
  return typeof value === "string" && UNIT.test(value);
}

function positiveDecimal(value) {
  return typeof value === "string" && POSITIVE.test(value);
}

function parseUnit(value) {
  if (!unit(value)) return null;
  const [whole, frac = ""] = value.split(".");
  if (whole === "1") return { num: 1n, scale: 1n };
  if (frac.length === 0) return { num: 0n, scale: 1n };
  return { num: BigInt(frac), scale: 10n ** BigInt(frac.length) };
}

function formatRatio(sum, den) {
  const whole = sum / den;
  let rem = sum % den;
  if (rem === 0n) return whole.toString();
  let digits = "";
  while (rem !== 0n && digits.length < 80) {
    rem *= 10n;
    digits += (rem / den).toString();
    rem %= den;
  }
  return `${whole}.${digits.replace(/0+$/, "")}`;
}

function whaleRank(components) {
  const weighted = [
    [30n, components.activityRecency],
    [25n, components.liquidityRelativeSize],
    [20n, components.attributionConfidence],
    [15n, components.verifiedExternalFlow],
    [10n, components.historicalImpact],
  ];
  const parts = [];
  let maxScale = 1n;
  for (const [weight, value] of weighted) {
    const parsed = parseUnit(value);
    if (!parsed) return null;
    if (parsed.scale > maxScale) maxScale = parsed.scale;
    parts.push({ weight, ...parsed });
  }
  let sum = 0n;
  for (const part of parts) sum += part.weight * part.num * (maxScale / part.scale);
  return formatRatio(sum, 100n * maxScale);
}

function compareDecimal(left, right) {
  const a = parseUnit(left);
  const b = parseUnit(right);
  const av = a.num * b.scale;
  const bv = b.num * a.scale;
  if (av < bv) return -1;
  if (av > bv) return 1;
  return 0;
}

function freeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const key of Object.keys(value)) freeze(value[key]);
  return Object.freeze(value);
}

function blockedResult(error, asOf, exclusions, extra = {}) {
  return freeze({
    ok: false,
    blocked: "BLOCKED",
    error,
    asOf,
    observationWindow: extra.observationWindow || null,
    eligibleCount: extra.eligibleCount || 0,
    entries: [],
    exclusions,
    withheld: extra.withheld || [],
    tiedEntityIds: extra.tiedEntityIds || [],
  });
}

function gateOf(input) {
  if (!Object.hasOwn(input, "gate")) return { ...DEFAULT_ACTIVITY_GATE };
  const gate = input.gate;
  if (!plainObject(gate) || unknownKey(gate, GATE_KEYS)) return null;
  for (const key of GATE_KEYS) {
    if (!Object.hasOwn(gate, key)) return null;
    if (typeof gate[key] !== "number" || !Number.isSafeInteger(gate[key]) || gate[key] < 1) return null;
  }
  return {
    recentDays: gate.recentDays,
    recentMinEvents: gate.recentMinEvents,
    activityDays: gate.activityDays,
    activityMinEvents: gate.activityMinEvents,
  };
}

function universeOf(input) {
  if (!Object.hasOwn(input, "universe")) return [...DEFAULT_UNIVERSE];
  if (!Array.isArray(input.universe) || input.universe.length === 0) return null;
  if (input.universe.some((asset) => typeof asset !== "string" || !ASSET.test(asset))) return null;
  return input.universe.slice();
}

function exclusion(entityId, reason, explanation, lastSeen) {
  return { entityId, reason, explanation, lastSeen };
}

function ownTransfer(entity, event) {
  if (event.selfTransfer === true) return true;
  if (!text(event.from) || !text(event.to)) return false;
  const owned = new Set(entity.addresses);
  return owned.has(event.from) && owned.has(event.to);
}

function eventUsable(event) {
  if (!plainObject(event) || unknownKey(event, EVENT_KEYS)) return false;
  if (!text(event.eventId) || parseUtc(event.at) == null) return false;
  if (typeof event.asset !== "string" || !ASSET.test(event.asset)) return false;
  if (!EVENT_KINDS.includes(event.kind)) return false;
  if (typeof event.internal !== "boolean" || typeof event.selfTransfer !== "boolean") return false;
  if (event.direction !== null && event.direction !== "buy" && event.direction !== "sell") return false;
  if (event.from !== undefined && !text(event.from)) return false;
  if (event.to !== undefined && !text(event.to)) return false;
  return positiveDecimal(event.usdValue) && positiveDecimal(event.volume24h) && positiveDecimal(event.depth);
}

function materialEvents(entity, asOfMs, universe, days) {
  const found = [];
  for (const event of entity.events) {
    if (!eventUsable(event)) continue;
    if (!universe.includes(event.asset)) continue;
    if (event.internal === true || ownTransfer(entity, event)) continue;
    const atMs = parseUtc(event.at);
    if (atMs > asOfMs || asOfMs - atMs > days * DAY_MS) continue;
    found.push(event);
  }
  return found;
}

function latest(events) {
  let best = null;
  let bestMs = -1;
  for (const event of events) {
    const atMs = parseUtc(event.at);
    if (atMs >= bestMs) {
      best = event;
      bestMs = atMs;
    }
  }
  return best;
}

function flowDirection(events) {
  const directional = events.filter((event) => DIRECTIONAL_KINDS.includes(event.kind));
  const chosen = latest(directional);
  if (!chosen) return null;
  return chosen.direction === "buy" || chosen.direction === "sell" ? chosen.direction : null;
}

function evidenceReady(evidence, asOfMs) {
  if (!plainObject(evidence) || unknownKey(evidence, EVIDENCE_KEYS)) return false;
  if (!text(evidence.source) || !text(evidence.reference)) return false;
  const observed = parseUtc(evidence.observedAt);
  const verified = parseUtc(evidence.verifiedAt);
  return observed != null && verified != null && observed <= asOfMs && verified <= asOfMs;
}

function componentsOf(entity) {
  return {
    activityRecency: entity.activityRecency,
    liquidityRelativeSize: entity.liquidityRelativeSize,
    attributionConfidence: entity.attributionConfidence,
    verifiedExternalFlow: entity.verifiedExternalFlow,
    historicalImpact: entity.historicalImpact,
  };
}

function labelExclusion(labels) {
  for (const [label, reason, explanation] of LABEL_REASONS) {
    if (labels.includes(label)) return { reason, explanation };
  }
  return null;
}

function flagExclusion(entity) {
  if (entity.labelStale === true) return { reason: "stale label", explanation: "Label is stale." };
  if (entity.classificationChanged === true) {
    return { reason: "contract classification changed", explanation: "Address contract classification changed." };
  }
  if (entity.providerGap === true) return { reason: "provider data gap", explanation: "Provider data gap." };
  if (entity.anomaly === true) return { reason: "anomaly", explanation: "Anomaly matched." };
  return null;
}

function assess(entity, asOfMs, universe, gate, duplicateIds) {
  const entityId = plainObject(entity) && text(entity.entityId) ? entity.entityId : "UNKNOWN";
  if (!plainObject(entity) || unknownKey(entity, ENTITY_KEYS)) {
    return exclusion(entityId, "evidence is insufficient", "Entity evidence is incomplete.", null);
  }
  if (duplicateIds.has(entity.entityId)) {
    return exclusion(entity.entityId, "duplicate address", "The same address is listed on more than one entity.", null);
  }
  if (!Array.isArray(entity.addresses) || entity.addresses.length === 0 || entity.addresses.some((item) => !text(item))) {
    return exclusion(entity.entityId, "evidence is insufficient", "Entity evidence is incomplete.", null);
  }
  if (!text(entity.chain) || !Array.isArray(entity.labels) || entity.labels.some((item) => !text(item))) {
    return exclusion(entity.entityId, "evidence is insufficient", "Entity evidence is incomplete.", null);
  }
  if (!text(entity.labelSource) || !Array.isArray(entity.events)) {
    return exclusion(entity.entityId, "evidence is insufficient", "Entity evidence is incomplete.", null);
  }
  const labelled = labelExclusion(entity.labels);
  if (labelled) return exclusion(entity.entityId, labelled.reason, labelled.explanation, null);
  const flagged = flagExclusion(entity);
  if (flagged) return exclusion(entity.entityId, flagged.reason, flagged.explanation, null);
  const confidence = entity.attributionConfidence;
  const confidenceValue = parseUnit(confidence);
  if (confidence === "low" || confidence === "ambiguous" || (confidenceValue && confidenceValue.num === 0n)) {
    return exclusion(entity.entityId, "low attribution confidence", "Attribution confidence is missing or low.", null);
  }
  const parts = componentsOf(entity);
  if (Object.values(parts).some((value) => !unit(value)) || !evidenceReady(entity.evidence, asOfMs)) {
    return exclusion(entity.entityId, "evidence is insufficient", "Rank evidence or timestamps are missing.", null);
  }
  const activity = materialEvents(entity, asOfMs, universe, gate.activityDays);
  const recent = materialEvents(entity, asOfMs, universe, gate.recentDays);
  const lastSeen = activity.length > 0 ? latest(activity).at : null;
  const sawSelf = entity.events.some((event) => plainObject(event) && ownTransfer(entity, event));
  const sawInternal = entity.events.some((event) => plainObject(event) && event.internal === true);
  if (activity.length === 0 && sawSelf) {
    return exclusion(entity.entityId, "self-transfer", "Self-transfers are not buys, sells, or material external activity.", null);
  }
  if (activity.length === 0 && sawInternal) {
    return exclusion(entity.entityId, "exchange wallet", "Exchange-internal transfers are not buys or sells.", null);
  }
  if (activity.length < gate.activityMinEvents) {
    const outside = entity.events.some((event) => {
      if (!eventUsable(event) || !universe.includes(event.asset)) return false;
      const atMs = parseUtc(event.at);
      return atMs != null && atMs <= asOfMs && asOfMs - atMs > gate.activityDays * DAY_MS;
    });
    const reason = outside && activity.length === 0 ? "no material activity" : "activity gate";
    const explanation = outside && activity.length === 0
      ? "No material event in the activity window."
      : "Fewer material non-internal events than the activity gate.";
    return exclusion(entity.entityId, reason, explanation, lastSeen);
  }
  if (recent.length < gate.recentMinEvents) {
    return exclusion(entity.entityId, "no recent movement", "No material non-internal event in the recent window.", lastSeen);
  }
  const rank = whaleRank(parts);
  return {
    eligible: true,
    row: {
      entityId: entity.entityId,
      addresses: entity.addresses.slice(),
      chain: entity.chain,
      identity: "unlabelled entity",
      labels: entity.labels.slice(),
      labelSource: entity.labelSource,
      lastSeen: latest(recent).at,
      verifiedAt: entity.evidence.verifiedAt,
      whaleRank: rank,
      components: parts,
      evidence: {
        source: entity.evidence.source,
        reference: entity.evidence.reference,
        observedAt: entity.evidence.observedAt,
        verifiedAt: entity.evidence.verifiedAt,
      },
      flowDirection: flowDirection(recent),
      materialEventCount: activity.length,
      recentMaterialEventCount: recent.length,
    },
  };
}

function duplicateEntityIds(entities) {
  const owner = new Map();
  const duplicated = new Set();
  for (const entity of entities) {
    if (!plainObject(entity) || !text(entity.entityId) || !Array.isArray(entity.addresses)) continue;
    for (const address of entity.addresses) {
      if (!text(address)) continue;
      const prior = owner.get(address);
      if (prior && prior !== entity.entityId) {
        duplicated.add(prior);
        duplicated.add(entity.entityId);
      } else {
        owner.set(address, entity.entityId);
      }
    }
  }
  return duplicated;
}

export function readCurrentWhaleEligibility() {
  // No evidenced active set is stored. Arkham's top-100 holdings note is not an active trader list.
  return blockedResult("evidence is insufficient", null, []);
}

export function rankWhaleEligibility(input) {
  if (!plainObject(input) || unknownKey(input, INPUT_KEYS) || !Array.isArray(input.entities)) {
    return blockedResult("evidence is insufficient", null, []);
  }
  const asOfMs = parseUtc(input.asOf);
  if (asOfMs == null) return blockedResult("evidence is insufficient", null, []);
  const gate = gateOf(input);
  if (!gate) return blockedResult("activity gate is not configured", input.asOf, []);
  const universe = universeOf(input);
  if (!universe) return blockedResult("evidence is insufficient", input.asOf, []);
  const duplicateIds = duplicateEntityIds(input.entities);
  const exclusions = [];
  const eligible = [];
  for (const entity of input.entities) {
    const judged = assess(entity, asOfMs, universe, gate, duplicateIds);
    if (judged.eligible) eligible.push(judged.row);
    else exclusions.push(judged);
  }
  const observationWindow = {
    asOf: input.asOf,
    recentDays: gate.recentDays,
    recentMinEvents: gate.recentMinEvents,
    activityDays: gate.activityDays,
    activityMinEvents: gate.activityMinEvents,
    universe,
  };
  if (eligible.length < WHALE_LIST_SIZE) {
    return blockedResult("evidence is insufficient", input.asOf, exclusions, {
      observationWindow,
      eligibleCount: eligible.length,
    });
  }
  eligible.sort((left, right) => {
    const byRank = compareDecimal(right.whaleRank, left.whaleRank);
    if (byRank !== 0) return byRank;
    if (left.entityId < right.entityId) return -1;
    if (left.entityId > right.entityId) return 1;
    return 0;
  });
  if (eligible.length > WHALE_LIST_SIZE && compareDecimal(eligible[14].whaleRank, eligible[15].whaleRank) === 0) {
    const boundary = eligible[14].whaleRank;
    const tiedEntityIds = eligible.filter((row) => compareDecimal(row.whaleRank, boundary) === 0).map((row) => row.entityId);
    return blockedResult("tie at rank boundary", input.asOf, exclusions, {
      observationWindow,
      eligibleCount: eligible.length,
      tiedEntityIds,
    });
  }
  const selected = eligible.slice(0, WHALE_LIST_SIZE).map((row, index) => ({ ...row, rank: index + 1 }));
  const withheld = eligible.slice(WHALE_LIST_SIZE).map((row) => ({
    entityId: row.entityId,
    reason: "outside top 15",
    explanation: "Eligible, and ranked outside the 15.",
    whaleRank: row.whaleRank,
    lastSeen: row.lastSeen,
  }));
  return freeze({
    ok: true,
    blocked: null,
    error: null,
    asOf: input.asOf,
    observationWindow,
    eligibleCount: eligible.length,
    entries: selected,
    exclusions,
    withheld,
    tiedEntityIds: [],
  });
}
