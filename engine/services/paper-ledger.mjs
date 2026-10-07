// Paper ledger reconciliation for TASK 14.C.02.
// Positions and cash are replayed from append-only rows. A second replay must
// match the first. The source names no rounding scale, so equality is exact.
// A mismatch stays visible and blocks ledger promotion. Recovery appends a
// reconciliation row and does not overwrite a fill or plug cash.
// Realized PnL is trading cash only when at least one fill leaves position at zero.
// Unrealized PnL, average-cost lots, and a funding interval are not calculated.
// This module does not open a venue client and does not append a paper order.

import { readPaperOrder } from "./paper-orders.mjs";

const DECIMAL = /^-?(?:0|[1-9]\d*)(?:\.\d+)?$/;
const EMAIL = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i;
const ACTOR_KEYS = Object.freeze(["id", "role", "tenantId"]);
const STATED_KEYS = Object.freeze(["position", "cash", "realizedPnl"]);
const LEVEL_KEYS = Object.freeze(["price", "quantity"]);
const FILL_KEYS = Object.freeze([
  "actor",
  "idempotencyKey",
  "kind",
  "orderId",
  "side",
  "levels",
  "feeRate",
  "fee",
]);
const AMOUNT_KEYS = Object.freeze(["actor", "idempotencyKey", "kind", "amount"]);
const POSITION_KEYS = Object.freeze(["actor", "idempotencyKey", "kind", "quantity"]);
const RECOVERY_KEYS = Object.freeze(["actor", "idempotencyKey", "stated"]);
const ZERO = Object.freeze({ n: 0n, scale: 0 });

export const PAPER_LEDGER_KINDS = Object.freeze([
  "cash",
  "position",
  "fill",
  "fee",
  "funding",
  "reconciliation",
]);
export const PAPER_LEDGER_ASSUMPTIONS = Object.freeze([
  "a buy increases position and decreases cash by notional plus the computed fee",
  "a sell decreases position and increases cash by notional minus the computed fee",
  "a fill fee is the fee rate times the fill notional",
  "external cash is not realized pnl",
  "realized pnl is trading cash after at least one fill when position is exactly zero",
  "spread and slippage stay inside the fill price",
  "equality is exact because the rounding scale is NOT IN SOURCE",
  "a paper fill is not a live execution",
]);
export const PAPER_LEDGER_LIMITATIONS = Object.freeze([
  "rounding scale is NOT IN SOURCE",
  "funding interval is NOT IN SOURCE",
  "unrealized pnl is NOT IN SOURCE",
  "average-cost lots are NOT IN SOURCE",
  "order fill quantity is NOT IN SOURCE",
  "the 28-day paper promotion gate is not applied",
  "two-person approval is not applied",
  "latency cash effect is NOT IN SOURCE",
]);

function fail(error) {
  return Object.freeze({
    ok: false,
    blocked: "BLOCKED",
    error,
    promoted: false,
    alert: false,
    discrepancies: null,
    position: null,
    cash: null,
    realizedPnl: null,
    fee: null,
    funding: null,
    fillCount: null,
    rowCount: null,
    idempotentReplay: false,
    assumptions: PAPER_LEDGER_ASSUMPTIONS,
    limitations: PAPER_LEDGER_LIMITATIONS,
    liveTrading: "OFF",
    liveOrdersLocked: true,
    liveOrderSubmitted: false,
    venueClient: null,
    mode: "paper",
    product: "spot",
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
  if (typeof value !== "string" || value !== value.trim() || value.length === 0) {
    return { ok: false, error: "unsupported field" };
  }
  if (leaked(value)) return { ok: false, error: "secret value is not allowed" };
  return { ok: true, value };
}

function actorOf(actor) {
  if (!plainObject(actor) || unknownKey(actor, ACTOR_KEYS)) return { ok: false, error: "unsupported field" };
  const id = named(actor.id, "role scope denied");
  if (!id.ok) return id;
  const tenantId = named(actor.tenantId, "role scope denied");
  if (!tenantId.ok) return tenantId;
  if (actor.role !== "Admin") return { ok: false, error: "role scope denied" };
  return { ok: true, actor: { id: id.value, role: actor.role, tenantId: tenantId.value } };
}

function parseDecimal(value) {
  if (typeof value !== "string" || !DECIMAL.test(value)) return null;
  const negative = value.startsWith("-");
  const body = negative ? value.slice(1) : value;
  const [whole, frac = ""] = body.split(".");
  const digits = `${whole}${frac}`.replace(/^0+(?=\d)/, "");
  const n = BigInt(digits);
  return { n: negative ? -n : n, scale: frac.length };
}

function decimalField(value, missing, sign) {
  if (value === undefined || value === null || (typeof value === "string" && value.trim() === "")) {
    return { ok: false, error: missing };
  }
  if (typeof value !== "string" || leaked(value)) {
    return { ok: false, error: leaked(value) ? "secret value is not allowed" : "unsupported field" };
  }
  const parsed = parseDecimal(value);
  if (!parsed) return { ok: false, error: "unsupported field" };
  if (sign === "positive" && parsed.n <= 0n) return { ok: false, error: "unsupported field" };
  if (sign === "nonnegative" && parsed.n < 0n) return { ok: false, error: "unsupported field" };
  return { ok: true, value, parsed };
}

function scaleTo(part, scale) {
  return part.n * 10n ** BigInt(scale - part.scale);
}

function format(part) {
  const neg = part.n < 0n;
  let digits = (neg ? -part.n : part.n).toString();
  if (part.scale > 0) {
    if (digits.length <= part.scale) digits = digits.padStart(part.scale + 1, "0");
    const cut = digits.length - part.scale;
    const frac = digits.slice(cut).replace(/0+$/, "");
    digits = frac.length > 0 ? `${digits.slice(0, cut)}.${frac}` : digits.slice(0, cut);
  }
  if (digits === "0") return "0";
  return neg ? `-${digits}` : digits;
}

function add(left, right) {
  const scale = Math.max(left.scale, right.scale);
  return { n: scaleTo(left, scale) + scaleTo(right, scale), scale };
}

function neg(part) {
  return { n: -part.n, scale: part.scale };
}

function same(left, right) {
  const scale = Math.max(left.scale, right.scale);
  return scaleTo(left, scale) === scaleTo(right, scale);
}

function storesOf(stores) {
  return plainObject(stores)
    && plainObject(stores.orders)
    && stores.orders.orders instanceof Map
    && stores.orders.keys instanceof Map
    && plainObject(stores.ledger)
    && Array.isArray(stores.ledger.rows)
    && stores.ledger.keys instanceof Map;
}

function blankRow(fields) {
  return Object.freeze({
    sequence: fields.sequence,
    kind: fields.kind,
    idempotencyKey: fields.idempotencyKey,
    tenantId: fields.tenantId,
    actorId: fields.actorId,
    orderId: fields.orderId ?? null,
    side: fields.side ?? null,
    levels: fields.levels ?? null,
    feeRate: fields.feeRate ?? null,
    fee: fields.fee ?? null,
    amount: fields.amount ?? null,
    quantity: fields.quantity ?? null,
    statedPosition: fields.statedPosition ?? null,
    statedCash: fields.statedCash ?? null,
    statedRealizedPnl: fields.statedRealizedPnl ?? null,
    alert: fields.alert === true,
    mode: "paper",
    product: "spot",
    liveTrading: "OFF",
    liveOrdersLocked: true,
    liveOrderSubmitted: false,
    venueClient: null,
  });
}

function canonical(row) {
  return JSON.stringify({
    kind: row.kind,
    orderId: row.orderId,
    side: row.side,
    levels: row.levels,
    feeRate: row.feeRate,
    fee: row.fee,
    amount: row.amount,
    quantity: row.quantity,
    statedPosition: row.statedPosition,
    statedCash: row.statedCash,
    statedRealizedPnl: row.statedRealizedPnl,
    alert: row.alert,
  });
}

function issue(code, field, derived, stated, orderId = null) {
  return Object.freeze({
    code,
    field,
    derived,
    stated,
    orderId,
  });
}

function levelsOf(value) {
  if (!Array.isArray(value) || value.length === 0) return { ok: false, error: "unsupported field" };
  const levels = [];
  for (const level of value) {
    if (!plainObject(level) || unknownKey(level, LEVEL_KEYS)) return { ok: false, error: "unsupported field" };
    const price = decimalField(level.price, "price is not configured", "positive");
    if (!price.ok) return price;
    const quantity = decimalField(level.quantity, "quantity is not configured", "positive");
    if (!quantity.ok) return quantity;
    levels.push(Object.freeze({ price: price.value, quantity: quantity.value }));
  }
  return { ok: true, levels: Object.freeze(levels) };
}

function movement(row) {
  return row.kind === "fill" || row.kind === "fee" || row.kind === "funding" || row.kind === "cash";
}

function derive(stores, actor) {
  let position = ZERO;
  let cash = ZERO;
  let trading = ZERO;
  let fee = ZERO;
  let funding = ZERO;
  let sawFee = false;
  let sawFunding = false;
  let movements = 0;
  let fills = 0;
  const issues = [];
  const rows = stores.ledger.rows.filter((row) => row.tenantId === actor.tenantId);
  for (const row of rows) {
    if (row.kind === "fill") {
      let notional = ZERO;
      for (const level of row.levels) {
        const price = parseDecimal(level.price);
        const quantity = parseDecimal(level.quantity);
        notional = add(notional, { n: price.n * quantity.n, scale: price.scale + quantity.scale });
        position = add(position, row.side === "buy" ? quantity : neg(quantity));
      }
      const rate = parseDecimal(row.feeRate);
      const computed = { n: notional.n * rate.n, scale: notional.scale + rate.scale };
      const statedFee = parseDecimal(row.fee);
      if (!same(computed, statedFee)) {
        issues.push(issue("fee does not match", "fee", format(computed), row.fee, row.orderId));
      }
      const delta = row.side === "buy" ? neg(add(notional, computed)) : add(notional, neg(computed));
      cash = add(cash, delta);
      trading = add(trading, delta);
      fee = add(fee, computed);
      sawFee = true;
      fills += 1;
      movements += 1;
      const order = readPaperOrder(stores.orders, { actor, orderId: row.orderId });
      const states = order.ok ? order.order.events.map((event) => event.state) : [];
      if (!states.includes("fill") && !states.includes("partial fill")) {
        issues.push(issue("order event does not match", "order", null, null, row.orderId));
      }
    } else if (row.kind === "fee") {
      const amount = parseDecimal(row.amount);
      cash = add(cash, neg(amount));
      trading = add(trading, neg(amount));
      fee = add(fee, amount);
      sawFee = true;
      movements += 1;
    } else if (row.kind === "funding") {
      const amount = parseDecimal(row.amount);
      cash = add(cash, amount);
      trading = add(trading, amount);
      funding = add(funding, amount);
      sawFunding = true;
      movements += 1;
    } else if (row.kind === "cash") {
      cash = add(cash, parseDecimal(row.amount));
      movements += 1;
    } else if (row.kind === "position") {
      const stated = parseDecimal(row.quantity);
      if (!same(position, stated)) {
        issues.push(issue("position does not match", "position", format(position), row.quantity));
      }
    }
  }
  return {
    position,
    cash,
    trading,
    fee: sawFee ? fee : null,
    funding: sawFunding ? funding : null,
    movements,
    fills,
    issues,
    rows,
  };
}

function statedOf(value) {
  if (!plainObject(value) || unknownKey(value, STATED_KEYS)) return { ok: false, error: "unsupported field" };
  const position = decimalField(value.position, "position is not configured", "signed");
  if (!position.ok) return position;
  const cash = decimalField(value.cash, "cash is not configured", "signed");
  if (!cash.ok) return cash;
  if (!Object.hasOwn(value, "realizedPnl") || value.realizedPnl === null) {
    return { ok: true, position, cash, realizedPnl: null };
  }
  const realizedPnl = decimalField(value.realizedPnl, "realized pnl is not configured", "signed");
  if (!realizedPnl.ok) return realizedPnl;
  return { ok: true, position, cash, realizedPnl };
}

function realizedOf(derived) {
  if (derived.fills > 0 && same(derived.position, ZERO)) return derived.trading;
  return null;
}

function comparisonIssues(derived, stated) {
  const issues = [];
  const realized = realizedOf(derived);
  if (!same(derived.position, stated.position.parsed)) {
    issues.push(issue("position does not match", "position", format(derived.position), stated.position.value));
  }
  if (!same(derived.cash, stated.cash.parsed)) {
    issues.push(issue("cash does not match", "cash", format(derived.cash), stated.cash.value));
  }
  if (realized) {
    if (!stated.realizedPnl) issues.push(issue("realized pnl is not configured", "realizedPnl", format(realized), null));
    else if (!same(realized, stated.realizedPnl.parsed)) {
      issues.push(issue("realized pnl does not match", "realizedPnl", format(realized), stated.realizedPnl.value));
    }
  } else if (stated.realizedPnl) {
    issues.push(issue("realized pnl is not closed", "realizedPnl", null, stated.realizedPnl.value));
  }
  return issues;
}

function finish(stores, actor, stated, replay) {
  const first = derive(stores, actor);
  if (first.movements === 0) return fail("ledger is not configured");
  const second = derive(stores, actor);
  const issues = [...first.issues];
  if (!same(first.position, second.position) || !same(first.cash, second.cash) || !same(first.trading, second.trading)) {
    issues.push(issue("replay does not match", "replay", format(first.cash), format(second.cash)));
  }
  issues.push(...comparisonIssues(first, stated));
  const realized = realizedOf(first);
  const promoted = issues.length === 0;
  return Object.freeze({
    ok: promoted,
    blocked: promoted ? null : "BLOCKED",
    error: promoted ? null : issues[0].code,
    promoted,
    alert: !promoted,
    discrepancies: Object.freeze(issues),
    position: format(first.position),
    cash: format(first.cash),
    realizedPnl: realized ? format(realized) : null,
    fee: first.fee ? format(first.fee) : null,
    funding: first.funding ? format(first.funding) : null,
    fillCount: first.fills,
    rowCount: first.rows.length,
    idempotentReplay: replay === true,
    assumptions: PAPER_LEDGER_ASSUMPTIONS,
    limitations: PAPER_LEDGER_LIMITATIONS,
    liveTrading: "OFF",
    liveOrdersLocked: true,
    liveOrderSubmitted: false,
    venueClient: null,
    mode: "paper",
    product: "spot",
  });
}

function appendRow(store, actor, fields) {
  const row = blankRow({
    ...fields,
    sequence: String(store.rows.length + 1),
    tenantId: actor.tenantId,
    actorId: actor.id,
  });
  const key = `${actor.tenantId}\u0000${fields.idempotencyKey}`;
  const prior = store.keys.get(key);
  if (prior) {
    if (prior.canonical !== canonical(row)) return fail("idempotency key is already recorded");
    return Object.freeze({ ok: true, blocked: null, error: null, idempotentReplay: true, row: prior.row });
  }
  store.rows.push(row);
  store.keys.set(key, { canonical: canonical(row), row });
  return Object.freeze({ ok: true, blocked: null, error: null, idempotentReplay: false, row });
}

export function createPaperLedgerStore() {
  return { rows: [], keys: new Map() };
}

export function appendPaperLedger(store, input) {
  if (!plainObject(store) || !Array.isArray(store.rows) || !(store.keys instanceof Map)) {
    return fail("unsupported field");
  }
  if (!plainObject(input) || input.kind === "reconciliation" || !PAPER_LEDGER_KINDS.includes(input.kind)) {
    return fail("unsupported field");
  }
  const actor = actorOf(input.actor);
  if (!actor.ok) return fail(actor.error);
  const idempotencyKey = named(input.idempotencyKey, "idempotency key is not configured");
  if (!idempotencyKey.ok) return fail(idempotencyKey.error);
  if (input.kind === "fill") {
    if (unknownKey(input, FILL_KEYS)) return fail("unsupported field");
    const orderId = named(input.orderId, "order is not configured");
    if (!orderId.ok) return fail(orderId.error);
    if (input.side !== "buy" && input.side !== "sell") return fail("unsupported field");
    const levels = levelsOf(input.levels);
    if (!levels.ok) return fail(levels.error);
    const feeRate = decimalField(input.feeRate, "fee is not configured", "nonnegative");
    if (!feeRate.ok) return fail(feeRate.error);
    const fee = decimalField(input.fee, "fee is not configured", "nonnegative");
    if (!fee.ok) return fail(fee.error);
    return appendRow(store, actor.actor, {
      kind: "fill",
      idempotencyKey: idempotencyKey.value,
      orderId: orderId.value,
      side: input.side,
      levels: levels.levels,
      feeRate: feeRate.value,
      fee: fee.value,
    });
  }
  if (input.kind === "position") {
    if (unknownKey(input, POSITION_KEYS)) return fail("unsupported field");
    const quantity = decimalField(input.quantity, "position is not configured", "signed");
    if (!quantity.ok) return fail(quantity.error);
    return appendRow(store, actor.actor, {
      kind: "position",
      idempotencyKey: idempotencyKey.value,
      quantity: quantity.value,
    });
  }
  if (unknownKey(input, AMOUNT_KEYS)) return fail("unsupported field");
  const sign = input.kind === "fee" ? "nonnegative" : "signed";
  const amount = decimalField(input.amount, `${input.kind} is not configured`, sign);
  if (!amount.ok) return fail(amount.error);
  return appendRow(store, actor.actor, {
    kind: input.kind,
    idempotencyKey: idempotencyKey.value,
    amount: amount.value,
  });
}

export function reconcilePaperLedger(stores, input) {
  if (!storesOf(stores)) return fail("unsupported field");
  if (!plainObject(input) || unknownKey(input, ["actor", "stated"])) return fail("unsupported field");
  const actor = actorOf(input.actor);
  if (!actor.ok) return fail(actor.error);
  const stated = statedOf(input.stated);
  if (!stated.ok) return fail(stated.error);
  return finish(stores, actor.actor, stated, false);
}

export function recoverPaperLedger(stores, input) {
  if (!storesOf(stores)) return fail("unsupported field");
  if (!plainObject(input) || unknownKey(input, RECOVERY_KEYS)) return fail("unsupported field");
  const actor = actorOf(input.actor);
  if (!actor.ok) return fail(actor.error);
  const idempotencyKey = named(input.idempotencyKey, "idempotency key is not configured");
  if (!idempotencyKey.ok) return fail(idempotencyKey.error);
  const stated = statedOf(input.stated);
  if (!stated.ok) return fail(stated.error);
  const preview = derive(stores, actor.actor);
  if (preview.movements === 0) return fail("ledger is not configured");
  const mismatched = preview.issues.length > 0 || comparisonIssues(preview, stated).length > 0;
  const appended = appendRow(stores.ledger, actor.actor, {
    kind: "reconciliation",
    idempotencyKey: idempotencyKey.value,
    statedPosition: stated.position.value,
    statedCash: stated.cash.value,
    statedRealizedPnl: stated.realizedPnl ? stated.realizedPnl.value : null,
    alert: mismatched,
  });
  if (!appended.ok) return appended;
  return finish(stores, actor.actor, stated, appended.idempotentReplay);
}
