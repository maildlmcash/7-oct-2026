// Futures paper orders and positions for TASK 15.A.01.
// This store is separate from the Spot paper-order log. A Spot order is rejected.
// Direction is long or short. Position mode is hedge or one-way. Margin mode is
// isolated or cross. The contract multiplier and the PnL come from the registered
// contract. Linear and inverse formulas stay the ones in contract-specs.
// Reduce-only decreases an open side and never opens a side. A different entry
// price is not averaged. Leverage, maintenance margin, liquidation, funding, and
// fees are not applied. This module does not open a venue client.

import { convertContractPnl } from "./contract-specs.mjs";
import { POSITION_MODES } from "./derivatives-features.mjs";

const DECIMAL = /^(?:0|[1-9]\d*)(?:\.\d+)?$/;
const EMAIL = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i;
const ACTOR_KEYS = Object.freeze(["id", "role", "tenantId"]);
const INPUT_KEYS = Object.freeze([
  "actor",
  "orderId",
  "idempotencyKey",
  "contractId",
  "direction",
  "quantity",
  "price",
  "reduceOnly",
  "positionMode",
  "marginMode",
  "product",
]);
const READ_KEYS = Object.freeze(["actor", "contractId"]);
const MARGIN_MODES = new Set(["isolated", "cross"]);
const DIRECTIONS = new Set(["long", "short"]);

export const FUTURES_PRODUCT = "futures";
export const FUTURES_MARGIN_MODES = Object.freeze(["isolated", "cross"]);
export const FUTURES_PAPER_LIMITATIONS = Object.freeze([
  "leverage is NOT IN SOURCE",
  "maintenance margin is NOT IN SOURCE",
  "liquidation price is NOT IN SOURCE",
  "funding payment is NOT IN SOURCE",
  "fee is NOT IN SOURCE",
  "average entry across different prices is NOT IN SOURCE",
]);

function fail(error) {
  return Object.freeze({
    ok: false,
    blocked: "BLOCKED",
    error,
    idempotentReplay: false,
    order: null,
    position: null,
    pnl: null,
    formula: null,
    liveTrading: "OFF",
    liveOrdersLocked: true,
    liveOrderSubmitted: false,
    venueClient: null,
    mode: "paper",
    product: null,
    limitations: FUTURES_PAPER_LIMITATIONS,
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
  if (typeof value !== "string" || value !== value.trim()) return { ok: false, error: "unsupported field" };
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
  const [whole, frac = ""] = value.split(".");
  const digits = `${whole}${frac}`.replace(/^0+(?=\d)/, "");
  return { n: BigInt(digits), scale: frac.length };
}

function scaleTo(part, scale) {
  return part.n * 10n ** BigInt(scale - part.scale);
}

function format(part) {
  let digits = part.n.toString();
  if (part.scale > 0) {
    if (digits.length <= part.scale) digits = digits.padStart(part.scale + 1, "0");
    const cut = digits.length - part.scale;
    const frac = digits.slice(cut).replace(/0+$/, "");
    digits = frac.length > 0 ? `${digits.slice(0, cut)}.${frac}` : digits.slice(0, cut);
  }
  return digits === "0" ? "0" : digits;
}

function compare(left, right) {
  const scale = Math.max(left.scale, right.scale);
  const a = scaleTo(left, scale);
  const b = scaleTo(right, scale);
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}

function subtract(left, right) {
  const scale = Math.max(left.scale, right.scale);
  return { n: scaleTo(left, scale) - scaleTo(right, scale), scale };
}

function addQuantity(left, right) {
  const scale = Math.max(left.scale, right.scale);
  return format({ n: scaleTo(left, scale) + scaleTo(right, scale), scale });
}

function gcd(left, right) {
  let a = left < 0n ? -left : left;
  let b = right < 0n ? -right : right;
  while (b !== 0n) {
    const next = a % b;
    a = b;
    b = next;
  }
  return a;
}

function ratio(numerator, denominator) {
  if (denominator === 0n) return null;
  const neg = (numerator < 0n) !== (denominator < 0n);
  let num = numerator < 0n ? -numerator : numerator;
  let den = denominator < 0n ? -denominator : denominator;
  const divisor = gcd(num, den);
  num /= divisor;
  den /= divisor;
  let rest = den;
  let twos = 0n;
  let fives = 0n;
  while (rest % 2n === 0n) {
    rest /= 2n;
    twos += 1n;
  }
  while (rest % 5n === 0n) {
    rest /= 5n;
    fives += 1n;
  }
  if (rest !== 1n) return `${neg ? "-" : ""}${num.toString()}/${den.toString()}`;
  const scale = twos > fives ? twos : fives;
  const scaled = num * 2n ** (scale - twos) * 5n ** (scale - fives);
  const text = format({ n: scaled, scale: Number(scale) });
  return neg && text !== "0" ? `-${text}` : text;
}

function parsePnl(value) {
  const negative = value.startsWith("-");
  const body = negative ? value.slice(1) : value;
  const sign = negative ? -1n : 1n;
  if (body.includes("/")) {
    const [num, den] = body.split("/");
    return { n: BigInt(num) * sign, d: BigInt(den) };
  }
  const parsed = parseDecimal(body);
  return { n: parsed.n * sign, d: 10n ** BigInt(parsed.scale) };
}

function addPnl(current, next) {
  if (current == null) return next;
  const left = parsePnl(current);
  const right = parsePnl(next);
  return ratio(left.n * right.d + right.n * left.d, left.d * right.d);
}

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const key of Object.keys(value)) deepFreeze(value[key]);
  return Object.freeze(value);
}

function storesOf(stores) {
  return plainObject(stores)
    && plainObject(stores.contracts)
    && stores.contracts.kind === "contract"
    && stores.contracts.contracts instanceof Map
    && plainObject(stores.futures)
    && stores.futures.orders instanceof Map
    && stores.futures.keys instanceof Map
    && stores.futures.positions instanceof Map;
}

function paperStore(store) {
  return plainObject(store)
    && store.orders instanceof Map
    && store.keys instanceof Map
    && store.positions instanceof Map;
}

function positionKey(tenantId, contractId) {
  return `${tenantId}\u0000${contractId}`;
}

function priced(store, contractId, side, quantity, entryPrice, exitPrice) {
  return convertContractPnl(store, {
    contractId,
    side,
    quantity,
    entryPrice,
    exitPrice,
  });
}

function snapshot(position) {
  return deepFreeze({
    contractId: position.contractId,
    positionMode: position.positionMode,
    marginMode: position.marginMode,
    multiplier: position.multiplier,
    long: position.long ? { quantity: position.long.quantity, entry: position.long.entry } : null,
    short: position.short ? { quantity: position.short.quantity, entry: position.short.entry } : null,
    realizedPnl: position.realizedPnl,
    liveTrading: "OFF",
    liveOrdersLocked: true,
    liveOrderSubmitted: false,
    venueClient: null,
    mode: "paper",
    product: FUTURES_PRODUCT,
    limitations: FUTURES_PAPER_LIMITATIONS,
  });
}

function blank(contractId, actor, mode, margin, multiplier) {
  return {
    contractId,
    tenantId: actor.tenantId,
    positionMode: mode,
    marginMode: margin,
    multiplier,
    long: null,
    short: null,
    realizedPnl: null,
  };
}

function flat(position) {
  return !position.long && !position.short;
}

function openSide(position) {
  if (position.long && position.short) return null;
  if (position.long) return "long";
  if (position.short) return "short";
  return null;
}

function withSide(position, direction, bucket) {
  return {
    ...position,
    long: direction === "long" ? bucket : position.long,
    short: direction === "short" ? bucket : position.short,
  };
}

function plan(contracts, position, input) {
  const grid = priced(contracts, input.contractId, input.direction, input.quantity, input.price, input.price);
  if (!position || flat(position)) {
    if (input.reduceOnly) return { ok: false, error: "reduce-only has no position" };
    if (!grid.ok) return { ok: false, error: grid.error };
    const next = position ? {
      ...position,
      positionMode: input.positionMode,
      marginMode: input.marginMode,
      multiplier: grid.units.multiplier,
    } : blank(input.contractId, input.actor, input.positionMode, input.marginMode, grid.units.multiplier);
    return {
      ok: true,
      position: withSide(next, input.direction, { quantity: input.quantity, entry: input.price }),
      pnl: null,
      formula: grid.formula,
      closedQuantity: "0",
      multiplier: grid.units.multiplier,
    };
  }
  if (position.positionMode !== input.positionMode) return { ok: false, error: "position mode does not match" };
  if (position.marginMode !== input.marginMode) return { ok: false, error: "margin mode does not match" };
  const current = openSide(position);
  if (position.positionMode === "one-way" && current && current !== input.direction) {
    if (input.reduceOnly) return { ok: false, error: "reduce-only side does not match" };
    return closeOpposite(contracts, position, input, current);
  }
  const bucket = position[input.direction];
  if (input.reduceOnly) {
    if (!bucket) return { ok: false, error: "reduce-only has no position" };
    const have = parseDecimal(bucket.quantity);
    const need = parseDecimal(input.quantity);
    if (!have || !need || compare(need, have) > 0) {
      return { ok: false, error: "reduce-only quantity is larger than the position" };
    }
    const closed = priced(contracts, input.contractId, input.direction, input.quantity, bucket.entry, input.price);
    if (!closed.ok) return { ok: false, error: closed.error };
    const left = compare(need, have) === 0 ? null : { quantity: format(subtract(have, need)), entry: bucket.entry };
    return {
      ok: true,
      position: {
        ...withSide(position, input.direction, left),
        multiplier: closed.units.multiplier,
        realizedPnl: addPnl(position.realizedPnl, closed.pnl),
      },
      pnl: closed.pnl,
      formula: closed.formula,
      closedQuantity: input.quantity,
      multiplier: closed.units.multiplier,
    };
  }
  if (!grid.ok) return { ok: false, error: grid.error };
  if (bucket && compare(parseDecimal(bucket.entry), parseDecimal(input.price)) !== 0) {
    return { ok: false, error: "entry price is already recorded" };
  }
  const quantity = bucket ? addQuantity(parseDecimal(bucket.quantity), parseDecimal(input.quantity)) : input.quantity;
  return {
    ok: true,
    position: {
      ...withSide(position, input.direction, { quantity, entry: bucket ? bucket.entry : input.price }),
      multiplier: grid.units.multiplier,
    },
    pnl: null,
    formula: grid.formula,
    closedQuantity: "0",
    multiplier: grid.units.multiplier,
  };
}

function closeOpposite(contracts, position, input, current) {
  const bucket = position[current];
  const have = parseDecimal(bucket.quantity);
  const need = parseDecimal(input.quantity);
  if (!have || !need) return { ok: false, error: "unsupported field" };
  const closing = compare(need, have) >= 0;
  const closedQuantity = closing ? bucket.quantity : input.quantity;
  const closed = priced(contracts, input.contractId, current, closedQuantity, bucket.entry, input.price);
  if (!closed.ok) return { ok: false, error: closed.error };
  let next = {
    ...position,
    long: null,
    short: null,
    multiplier: closed.units.multiplier,
    realizedPnl: addPnl(position.realizedPnl, closed.pnl),
  };
  if (!closing) {
    next = withSide(next, current, { quantity: format(subtract(have, need)), entry: bucket.entry });
  } else if (compare(need, have) > 0) {
    const remainder = format(subtract(need, have));
    const opened = priced(contracts, input.contractId, input.direction, remainder, input.price, input.price);
    if (!opened.ok) return { ok: false, error: opened.error };
    next = withSide(next, input.direction, { quantity: remainder, entry: input.price });
    next.multiplier = opened.units.multiplier;
  }
  return {
    ok: true,
    position: next,
    pnl: closed.pnl,
    formula: closed.formula,
    closedQuantity,
    multiplier: next.multiplier,
  };
}

function orderOf(input, effect) {
  return deepFreeze({
    orderId: input.orderId,
    idempotencyKey: input.idempotencyKey,
    contractId: input.contractId,
    direction: input.direction,
    quantity: input.quantity,
    price: input.price,
    reduceOnly: input.reduceOnly,
    positionMode: input.positionMode,
    marginMode: input.marginMode,
    multiplier: effect.multiplier,
    pnl: effect.pnl,
    formula: effect.formula,
    closedQuantity: effect.closedQuantity,
    position: snapshot(effect.position),
    liveTrading: "OFF",
    liveOrdersLocked: true,
    liveOrderSubmitted: false,
    venueClient: null,
    mode: "paper",
    product: FUTURES_PRODUCT,
    limitations: FUTURES_PAPER_LIMITATIONS,
  });
}

function canonical(input) {
  return JSON.stringify({
    actorId: input.actor.id,
    orderId: input.orderId,
    contractId: input.contractId,
    direction: input.direction,
    quantity: input.quantity,
    price: input.price,
    reduceOnly: input.reduceOnly,
    positionMode: input.positionMode,
    marginMode: input.marginMode,
    product: input.product,
  });
}

function success(order, replay) {
  return deepFreeze({
    ok: true,
    blocked: null,
    error: null,
    idempotentReplay: replay,
    order,
    position: order.position,
    pnl: order.pnl,
    formula: order.formula,
    liveTrading: "OFF",
    liveOrdersLocked: true,
    liveOrderSubmitted: false,
    venueClient: null,
    mode: "paper",
    product: FUTURES_PRODUCT,
    limitations: FUTURES_PAPER_LIMITATIONS,
  });
}

function spotShape(input) {
  if (!plainObject(input)) return false;
  if (input.product === "spot") return true;
  if (input.product !== FUTURES_PRODUCT && Object.hasOwn(input, "state")) return true;
  return false;
}

export function createFuturesPaperStore() {
  return { orders: new Map(), keys: new Map(), positions: new Map() };
}

export function appendFuturesPaperOrder(stores, input) {
  if (!storesOf(stores)) return fail("unsupported field");
  if (spotShape(input) || !plainObject(input) || input.product !== FUTURES_PRODUCT) {
    return fail("product is not supported");
  }
  if (unknownKey(input, INPUT_KEYS)) return fail("unsupported field");
  const actor = actorOf(input.actor);
  if (!actor.ok) return fail(actor.error);
  const orderId = named(input.orderId, "order is not configured");
  if (!orderId.ok) return fail(orderId.error);
  const idempotencyKey = named(input.idempotencyKey, "idempotency key is not configured");
  if (!idempotencyKey.ok) return fail(idempotencyKey.error);
  const contractId = named(input.contractId, "contract is not configured");
  if (!contractId.ok) return fail(contractId.error);
  if (input.direction == null || input.direction === "") return fail("direction is not configured");
  if (!DIRECTIONS.has(input.direction)) return fail("unsupported field");
  if (input.reduceOnly == null) return fail("reduce-only is not configured");
  if (typeof input.reduceOnly !== "boolean") return fail("unsupported field");
  if (!POSITION_MODES.includes(input.positionMode)) {
    return fail(input.positionMode ? "unsupported field" : "position mode is not configured");
  }
  if (!MARGIN_MODES.has(input.marginMode)) {
    return fail(input.marginMode ? "unsupported field" : "margin mode is not configured");
  }
  const quantity = parseDecimal(input.quantity);
  const price = parseDecimal(input.price);
  if (!quantity || quantity.n === 0n || !price || price.n === 0n) return fail("unsupported field");
  const body = {
    actor: actor.actor,
    orderId: orderId.value,
    idempotencyKey: idempotencyKey.value,
    contractId: contractId.value,
    direction: input.direction,
    quantity: input.quantity,
    price: input.price,
    reduceOnly: input.reduceOnly,
    positionMode: input.positionMode,
    marginMode: input.marginMode,
    product: FUTURES_PRODUCT,
  };
  const key = `${actor.actor.tenantId}\u0000${idempotencyKey.value}`;
  const prior = stores.futures.keys.get(key);
  const bodyText = canonical(body);
  if (prior) {
    if (prior.canonical !== bodyText) return fail("idempotency key is already recorded");
    return success(prior.order, true);
  }
  const slot = positionKey(actor.actor.tenantId, contractId.value);
  const effect = plan(stores.contracts, stores.futures.positions.get(slot) ?? null, body);
  if (!effect.ok) return fail(effect.error);
  const order = orderOf(body, effect);
  stores.futures.positions.set(slot, effect.position);
  stores.futures.orders.set(`${actor.actor.tenantId}\u0000${orderId.value}`, order);
  stores.futures.keys.set(key, { canonical: bodyText, order });
  return success(order, false);
}

export function readFuturesPaperPosition(store, input) {
  if (!paperStore(store)) return fail("unsupported field");
  if (!plainObject(input) || unknownKey(input, READ_KEYS)) return fail("unsupported field");
  const actor = actorOf(input.actor);
  if (!actor.ok) return fail(actor.error);
  const contractId = named(input.contractId, "contract is not configured");
  if (!contractId.ok) return fail(contractId.error);
  const position = store.positions.get(positionKey(actor.actor.tenantId, contractId.value));
  if (!position || position.tenantId !== actor.actor.tenantId) return fail("position is not configured");
  const viewed = snapshot(position);
  return deepFreeze({
    ok: true,
    blocked: null,
    error: null,
    idempotentReplay: false,
    order: null,
    position: viewed,
    pnl: viewed.realizedPnl,
    formula: null,
    liveTrading: "OFF",
    liveOrdersLocked: true,
    liveOrderSubmitted: false,
    venueClient: null,
    mode: "paper",
    product: FUTURES_PRODUCT,
    limitations: FUTURES_PAPER_LIMITATIONS,
  });
}
