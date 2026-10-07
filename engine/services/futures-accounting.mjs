// Futures fills, funding, fees, and mark-to-market for TASK 15.B.01.
// Position value and realized PnL use convertContractPnl, so linear and inverse
// quantities stay in the registered contract units. A fee is the caller rate
// times the filled notional. A funding payment is the caller amount in the
// settlement currency. The funding interval is not converted. Assumptions are
// the frozen contract-units version. This module does not open a venue client.

import { convertContractPnl, readContract } from "./contract-specs.mjs";

const DECIMAL = /^(?:0|[1-9]\d*)(?:\.\d+)?$/;
const AMOUNT = /^-?(?:0|[1-9]\d*)(?:\.\d+)?$/;
const FRACTION = /^-?(?:0|[1-9]\d*)\/(?:[1-9]\d*)$/;
const EMAIL = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i;
const ACTOR_KEYS = Object.freeze(["id", "role", "tenantId"]);
const LEVEL_KEYS = Object.freeze(["price", "quantity"]);
const STATEMENT_KEYS = Object.freeze([
  "positionQuantity",
  "positionValue",
  "fees",
  "funding",
  "pnl",
]);
const INPUT_KEYS = Object.freeze([
  "actor",
  "accountId",
  "idempotencyKey",
  "assumptionsVersion",
  "contractId",
  "kind",
  "product",
  "statement",
  "direction",
  "quantity",
  "feeRate",
  "bids",
  "asks",
  "mark",
  "amount",
]);
const FILL_KEYS = Object.freeze([
  "actor", "accountId", "idempotencyKey", "assumptionsVersion", "contractId",
  "kind", "product", "statement", "direction", "quantity", "feeRate", "bids", "asks", "mark",
]);
const FUNDING_KEYS = Object.freeze([
  "actor", "accountId", "idempotencyKey", "assumptionsVersion", "contractId",
  "kind", "product", "statement", "amount", "mark",
]);
const MARK_KEYS = Object.freeze([
  "actor", "accountId", "idempotencyKey", "assumptionsVersion", "contractId",
  "kind", "product", "statement", "mark",
]);
const READ_KEYS = Object.freeze(["actor", "accountId"]);
const KINDS = new Set(["fill", "funding", "mark"]);
const DIRECTIONS = new Set(["long", "short"]);

export const FUTURES_ACCOUNTING_VERSION = "contract-units";
export const FUTURES_FILL_NOTIONAL_LINEAR = "price * quantity * multiplier";
export const FUTURES_FILL_NOTIONAL_INVERSE = "quantity * multiplier / price";
export const FUTURES_FILL_FEE = "fee rate * filled notional";
export const FUTURES_ACCOUNTING_PNL = "realized pnl plus position value plus funding minus fees";
export const FUTURES_ACCOUNTING_ASSUMPTIONS = Object.freeze([
  FUTURES_FILL_NOTIONAL_LINEAR,
  FUTURES_FILL_NOTIONAL_INVERSE,
  FUTURES_FILL_FEE,
  "funding payment is the caller amount in the settlement currency",
  "funding interval is not converted",
  "mark to market uses the contract pnl formula with exit equal to mark",
  "open lots close first-in first-out",
  "average entry is not calculated",
]);
export const FUTURES_ACCOUNTING_LIMITATIONS = Object.freeze([
  "slippage is NOT IN SOURCE",
  "latency is NOT IN SOURCE",
  "fee tier is NOT IN SOURCE",
  "rounding scale is NOT IN SOURCE",
  "liquidation is not applied",
  "reduce-only is not applied",
]);

function fail(error) {
  return Object.freeze({
    ok: false,
    blocked: "BLOCKED",
    error,
    reconciled: false,
    alert: false,
    promoted: false,
    idempotentReplay: false,
    report: null,
    liveTrading: "OFF",
    liveOrdersLocked: true,
    liveOrderSubmitted: false,
    venueClient: null,
    mode: "paper",
    product: null,
    assumptionsVersion: null,
    limitations: FUTURES_ACCOUNTING_LIMITATIONS,
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

function containsSecret(value) {
  if (typeof value === "string") return leaked(value);
  if (Array.isArray(value)) return value.some(containsSecret);
  if (!plainObject(value)) return false;
  return Object.keys(value).some((key) => leaked(key) || containsSecret(value[key]));
}

function named(value, missing) {
  if (value === undefined || value === null || (typeof value === "string" && value.trim() === "")) {
    return { ok: false, error: missing };
  }
  if (!filled(value)) return { ok: false, error: "unsupported field" };
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

function parseSigned(value) {
  if (typeof value !== "string" || !AMOUNT.test(value)) return null;
  const negative = value.startsWith("-");
  const parsed = parseDecimal(negative ? value.slice(1) : value);
  if (!parsed) return null;
  return negative ? { n: -parsed.n, scale: parsed.scale } : parsed;
}

function positive(value, missing) {
  if (value === undefined || value === null || (typeof value === "string" && value.trim() === "")) {
    return { ok: false, error: missing };
  }
  const parsed = parseDecimal(value);
  if (!parsed || parsed.n === 0n) return { ok: false, error: parsed ? missing : "unsupported field" };
  return { ok: true, value, parsed };
}

function format(n, scale) {
  const neg = n < 0n;
  let digits = (neg ? -n : n).toString();
  if (scale > 0) {
    if (digits.length <= scale) digits = digits.padStart(scale + 1, "0");
    const cut = digits.length - scale;
    const frac = digits.slice(cut).replace(/0+$/, "");
    digits = frac.length > 0 ? `${digits.slice(0, cut)}.${frac}` : digits.slice(0, cut);
  }
  if (digits === "0") return "0";
  return neg ? `-${digits}` : digits;
}

function scaleTo(part, scale) {
  return part.n * 10n ** BigInt(scale - part.scale);
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
  return format(neg ? -scaled : scaled, Number(scale));
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
  const left = parsePnl(current);
  const right = parsePnl(next);
  return ratio(left.n * right.d + right.n * left.d, left.d * right.d);
}

function subPnl(current, next) {
  const left = parsePnl(current);
  const right = parsePnl(next);
  return ratio(left.n * right.d - right.n * left.d, left.d * right.d);
}

function addDecimal(left, right) {
  const scale = Math.max(left.scale, right.scale);
  return { n: scaleTo(left, scale) + scaleTo(right, scale), scale };
}

function subDecimal(left, right) {
  const scale = Math.max(left.scale, right.scale);
  return { n: scaleTo(left, scale) - scaleTo(right, scale), scale };
}

function compare(left, right) {
  const scale = Math.max(left.scale, right.scale);
  const a = scaleTo(left, scale);
  const b = scaleTo(right, scale);
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const key of Object.keys(value)) deepFreeze(value[key]);
  return Object.freeze(value);
}

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (!plainObject(value)) return value;
  const out = {};
  for (const key of Object.keys(value).sort()) out[key] = stable(value[key]);
  return out;
}

function spotShape(input) {
  if (!plainObject(input)) return false;
  if (input.product === "spot") return true;
  if (input.product !== "futures" && Object.hasOwn(input, "state")) return true;
  return false;
}

function storesOf(stores) {
  return plainObject(stores)
    && unknownKey(stores, ["contracts", "accounting"]) === false
    && plainObject(stores.contracts)
    && stores.contracts.kind === "contract"
    && stores.contracts.contracts instanceof Map
    && plainObject(stores.accounting)
    && stores.accounting.accounts instanceof Map
    && stores.accounting.keys instanceof Map;
}

function accountKey(tenantId, accountId) {
  return `${tenantId}\u0000${accountId}`;
}

function requestKey(tenantId, idempotencyKey) {
  return `${tenantId}\u0000${idempotencyKey}`;
}

function amountText(value) {
  return typeof value === "string" && (AMOUNT.test(value) || FRACTION.test(value));
}

function statementOf(value) {
  if (!plainObject(value) || unknownKey(value, STATEMENT_KEYS)) return { ok: false, error: "unsupported field" };
  for (const key of STATEMENT_KEYS) {
    if (!Object.hasOwn(value, key)) return { ok: false, error: "statement is not configured" };
    if (!amountText(value[key])) return { ok: false, error: "unsupported field" };
  }
  return {
    ok: true,
    statement: {
      positionQuantity: value.positionQuantity,
      positionValue: value.positionValue,
      fees: value.fees,
      funding: value.funding,
      pnl: value.pnl,
    },
  };
}

function levelsOf(value) {
  if (!Array.isArray(value)) return { ok: false, error: "unsupported field" };
  const rows = [];
  for (const level of value) {
    if (!plainObject(level) || unknownKey(level, LEVEL_KEYS)) return { ok: false, error: "unsupported field" };
    const price = positive(level.price, "price is not configured");
    if (!price.ok) return price;
    const quantity = positive(level.quantity, "quantity is not configured");
    if (!quantity.ok) return quantity;
    rows.push({
      price: price.parsed,
      quantity: quantity.parsed,
      priceText: price.value,
      quantityText: quantity.value,
    });
  }
  const grouped = [];
  for (const row of rows) {
    const found = grouped.find((item) => compare(item.price, row.price) === 0);
    if (found) found.quantity = addDecimal(found.quantity, row.quantity);
    else grouped.push({ ...row });
  }
  return { ok: true, rows: grouped };
}

function walk(levels, quantity) {
  let remaining = { n: quantity.n, scale: quantity.scale };
  let filled = { n: 0n, scale: 0 };
  const consumed = [];
  for (const level of levels) {
    if (remaining.n === 0n) break;
    const scale = Math.max(remaining.scale, level.quantity.scale);
    const need = scaleTo(remaining, scale);
    const have = scaleTo(level.quantity, scale);
    const take = need < have ? need : have;
    if (take === 0n) continue;
    consumed.push({
      price: level.priceText,
      quantity: format(take, scale),
      remaining: format(have - take, scale),
    });
    filled = addDecimal(filled, { n: take, scale });
    remaining = { n: need - take, scale };
  }
  if (filled.n === 0n) return { ok: false, error: "depth is not sufficient" };
  return {
    ok: true,
    partial: remaining.n !== 0n,
    levels: consumed,
    filledQuantity: format(filled.n, filled.scale),
    unfilledQuantity: format(remaining.n, remaining.scale),
  };
}

function notionalOf(style, levels, multiplier) {
  const mult = parseDecimal(multiplier);
  let total = "0";
  for (const level of levels) {
    const price = parseDecimal(level.price);
    const quantity = parseDecimal(level.quantity);
    const piece = style === "linear"
      ? ratio(
        price.n * quantity.n * mult.n,
        10n ** BigInt(price.scale + quantity.scale + mult.scale),
      )
      : ratio(
        quantity.n * mult.n * 10n ** BigInt(price.scale),
        price.n * 10n ** BigInt(quantity.scale + mult.scale),
      );
    if (piece == null) return null;
    total = addPnl(total, piece);
  }
  return total;
}

function grid(contracts, contractId, price, quantity) {
  return convertContractPnl(contracts, {
    contractId,
    side: "long",
    quantity,
    entryPrice: price,
    exitPrice: price,
  });
}

function markValue(contracts, contractId, lots, mark) {
  if (lots.length === 0) return { ok: true, pnl: "0", formula: null };
  let value = "0";
  let formula = null;
  for (const lot of lots) {
    const pnl = convertContractPnl(contracts, {
      contractId,
      side: lot.side,
      quantity: lot.quantity,
      entryPrice: lot.entry,
      exitPrice: mark,
    });
    if (!pnl.ok) return pnl;
    value = addPnl(value, pnl.pnl);
    formula = pnl.formula;
  }
  return { ok: true, pnl: value, formula };
}

function positionOf(lots) {
  if (lots.length === 0) return { side: null, quantity: "0" };
  let total = { n: 0n, scale: 0 };
  for (const lot of lots) total = addDecimal(total, parseDecimal(lot.quantity));
  return { side: lots[0].side, quantity: format(total.n, total.scale) };
}

function applyFill(contracts, account, input) {
  const direction = input.direction;
  if (direction == null || direction === "") return { ok: false, error: "direction is not configured" };
  if (!DIRECTIONS.has(direction)) return { ok: false, error: "unsupported field" };
  const quantity = positive(input.quantity, "quantity is not configured");
  if (!quantity.ok) return quantity;
  const rate = input.feeRate === "0"
    ? { ok: true, value: "0", parsed: { n: 0n, scale: 0 } }
    : positive(input.feeRate, "fee is not configured");
  if (!rate.ok) return rate;
  const mark = positive(input.mark, "mark is not configured");
  if (!mark.ok) return mark;
  const bids = levelsOf(input.bids);
  if (!bids.ok) return bids;
  const asks = levelsOf(input.asks);
  if (!asks.ok) return asks;
  const bidBook = [...bids.rows].sort((left, right) => compare(right.price, left.price));
  const askBook = [...asks.rows].sort((left, right) => compare(left.price, right.price));
  if (bidBook.length > 0 && askBook.length > 0 && compare(bidBook[0].price, askBook[0].price) >= 0) {
    return { ok: false, error: "crossed book" };
  }
  const onBook = grid(contracts, account.contractId, mark.value, quantity.value);
  if (!onBook.ok) return onBook;
  const book = direction === "long" ? askBook : bidBook;
  const walked = walk(book, quantity.parsed);
  if (!walked.ok) return walked;
  for (const level of walked.levels) {
    const checked = grid(contracts, account.contractId, level.price, level.quantity);
    if (!checked.ok) return checked;
  }
  const lots = account.lots.map((lot) => ({ ...lot }));
  let realized = account.realized;
  for (const level of walked.levels) {
    let left = parseDecimal(level.quantity);
    while (left.n !== 0n) {
      const index = lots.findIndex((lot) => lot.side !== direction);
      if (index < 0) {
        lots.push({ side: direction, quantity: format(left.n, left.scale), entry: level.price });
        break;
      }
      const lot = lots[index];
      const have = parseDecimal(lot.quantity);
      const scale = Math.max(left.scale, have.scale);
      const need = scaleTo(left, scale);
      const held = scaleTo(have, scale);
      const take = need < held ? need : held;
      const taken = { n: take, scale };
      const pnl = convertContractPnl(contracts, {
        contractId: account.contractId,
        side: lot.side,
        quantity: format(take, scale),
        entryPrice: lot.entry,
        exitPrice: level.price,
      });
      if (!pnl.ok) return pnl;
      realized = addPnl(realized, pnl.pnl);
      const rest = subDecimal(have, taken);
      if (rest.n === 0n) lots.splice(index, 1);
      else lots[index] = { side: lot.side, quantity: format(rest.n, rest.scale), entry: lot.entry };
      left = subDecimal(left, taken);
    }
  }
  const notional = notionalOf(account.style, walked.levels, account.multiplier);
  if (notional == null) return { ok: false, error: "contract is not configured" };
  const eventFee = ratio(
    parsePnl(notional).n * rate.parsed.n,
    parsePnl(notional).d * 10n ** BigInt(rate.parsed.scale),
  );
  if (eventFee == null) return { ok: false, error: "contract is not configured" };
  return {
    ok: true,
    lots,
    realized,
    fees: addPnl(account.fees, eventFee),
    funding: account.funding,
    mark: mark.value,
    eventFee,
    eventFunding: "0",
    state: walked.partial ? "partial fill" : "fill",
    partial: walked.partial,
    filledQuantity: walked.filledQuantity,
    unfilledQuantity: walked.unfilledQuantity,
    levels: walked.levels,
  };
}

function applyCash(account, input) {
  if (input.kind === "funding") {
    if (input.amount == null || input.amount === "") return { ok: false, error: "funding is not configured" };
    const amount = parseSigned(input.amount);
    if (!amount) return { ok: false, error: "unsupported field" };
    const funding = ratio(amount.n, 10n ** BigInt(amount.scale));
    return {
      ok: true,
      lots: account.lots.map((lot) => ({ ...lot })),
      realized: account.realized,
      fees: account.fees,
      funding: addPnl(account.funding, funding),
      mark: input.mark == null || input.mark === "" ? account.mark : input.mark,
      eventFee: "0",
      eventFunding: funding,
      state: "funding",
      partial: false,
      filledQuantity: null,
      unfilledQuantity: null,
      levels: null,
      markSupplied: input.mark,
    };
  }
  const mark = positive(input.mark, "mark is not configured");
  if (!mark.ok) return mark;
  return {
    ok: true,
    lots: account.lots.map((lot) => ({ ...lot })),
    realized: account.realized,
    fees: account.fees,
    funding: account.funding,
    mark: mark.value,
    eventFee: "0",
    eventFunding: "0",
    state: "mark",
    partial: false,
    filledQuantity: null,
    unfilledQuantity: null,
    levels: null,
  };
}

function blankAccount(actor, input, contract) {
  return {
    accountId: input.accountId,
    contractId: contract.contractId,
    tenantId: actor.tenantId,
    style: contract.style,
    formula: contract.formula,
    settlement: contract.units.settlement,
    quantityUnit: contract.units.quantity,
    multiplier: contract.units.multiplier,
    fundingInterval: contract.contract.fundingInterval,
    assumptionsVersion: FUTURES_ACCOUNTING_VERSION,
    lots: [],
    realized: "0",
    fees: "0",
    funding: "0",
    mark: null,
    reports: Object.freeze([]),
  };
}

function mismatch(statement, derived) {
  if (statement.positionQuantity !== derived.positionQuantity) return "position quantity does not match";
  if (statement.positionValue !== derived.positionValue) return "position value does not match";
  if (statement.fees !== derived.fees) return "fees do not match";
  if (statement.funding !== derived.funding) return "funding does not match";
  if (statement.pnl !== derived.pnl) return "pnl does not match";
  return null;
}

function reportOf(account, applied, statement, sequence) {
  const position = positionOf(applied.lots);
  const marked = markValue(
    applied.contracts,
    account.contractId,
    applied.lots,
    applied.mark,
  );
  if (!marked.ok) return marked;
  const pnl = subPnl(addPnl(addPnl(applied.realized, marked.pnl), applied.funding), applied.fees);
  const derived = {
    positionQuantity: position.quantity,
    positionValue: marked.pnl,
    fees: applied.fees,
    funding: applied.funding,
    pnl,
  };
  const error = mismatch(statement, derived);
  const lots = applied.lots.map((lot) => ({ side: lot.side, quantity: lot.quantity, entry: lot.entry }));
  return {
    ok: error == null,
    report: {
      accountId: account.accountId,
      contractId: account.contractId,
      tenantId: account.tenantId,
      assumptionsVersion: FUTURES_ACCOUNTING_VERSION,
      assumptions: FUTURES_ACCOUNTING_ASSUMPTIONS,
      formula: marked.formula ?? account.formula,
      notionalFormula: account.style === "linear" ? FUTURES_FILL_NOTIONAL_LINEAR : FUTURES_FILL_NOTIONAL_INVERSE,
      feeFormula: FUTURES_FILL_FEE,
      pnlFormula: FUTURES_ACCOUNTING_PNL,
      settlement: account.settlement,
      quantityUnit: account.quantityUnit,
      multiplier: account.multiplier,
      fundingInterval: account.fundingInterval,
      fundingIntervalApplied: false,
      positionSide: position.side,
      positionQuantity: derived.positionQuantity,
      positionValue: derived.positionValue,
      realizedPnl: applied.realized,
      fees: derived.fees,
      funding: derived.funding,
      pnl: derived.pnl,
      eventFee: applied.eventFee,
      eventFunding: applied.eventFunding,
      state: applied.state,
      partial: applied.partial,
      filledQuantity: applied.filledQuantity,
      unfilledQuantity: applied.unfilledQuantity,
      levels: applied.levels,
      lots,
      mark: applied.mark,
      statement,
      reconciled: error == null,
      alert: error != null,
      promoted: false,
      error,
      sequence,
    },
  };
}

function publish(report, replay) {
  const matched = report.reconciled === true;
  return deepFreeze({
    ok: matched,
    blocked: matched ? null : "BLOCKED",
    error: report.error,
    reconciled: report.reconciled,
    alert: report.alert,
    promoted: false,
    idempotentReplay: replay,
    ...report,
    report,
    liveTrading: "OFF",
    liveOrdersLocked: true,
    liveOrderSubmitted: false,
    venueClient: null,
    mode: "paper",
    product: "futures",
    assumptionsVersion: FUTURES_ACCOUNTING_VERSION,
    limitations: FUTURES_ACCOUNTING_LIMITATIONS,
  });
}

export function createFuturesAccountingStore() {
  return { accounts: new Map(), keys: new Map() };
}

export function postFuturesAccounting(stores, input) {
  if (!storesOf(stores)) return fail("unsupported field");
  if (spotShape(input)) return fail("product is not supported");
  if (!plainObject(input) || unknownKey(input, INPUT_KEYS)) return fail("unsupported field");
  if (Object.hasOwn(input, "lastPrice")) return fail("last price is not a fill");
  const actor = actorOf(input.actor);
  if (!actor.ok) return fail(actor.error);
  const accountId = named(input.accountId, "account is not configured");
  if (!accountId.ok) return fail(accountId.error);
  const idempotencyKey = named(input.idempotencyKey, "idempotency key is not configured");
  if (!idempotencyKey.ok) return fail(idempotencyKey.error);
  const contractId = named(input.contractId, "contract is not configured");
  if (!contractId.ok) return fail(contractId.error);
  if (input.kind == null || input.kind === "") return fail("kind is not configured");
  if (!KINDS.has(input.kind)) return fail("unsupported field");
  const kindKeys = input.kind === "fill" ? FILL_KEYS : input.kind === "funding" ? FUNDING_KEYS : MARK_KEYS;
  if (unknownKey(input, kindKeys)) return fail("unsupported field");
  if (input.product !== "futures") return fail("product is not supported");
  if (input.assumptionsVersion == null || input.assumptionsVersion === "") {
    return fail("assumptions version is not configured");
  }
  if (input.assumptionsVersion !== FUTURES_ACCOUNTING_VERSION) {
    return fail("assumptions version does not match");
  }
  if (containsSecret(input)) return fail("secret value is not allowed");
  const statement = statementOf(input.statement);
  if (!statement.ok) return fail(statement.error);
  const contract = readContract(stores.contracts, contractId.value);
  if (!contract.ok) return fail(contract.error);
  const body = JSON.stringify(stable({
    actorId: actor.actor.id,
    tenantId: actor.actor.tenantId,
    accountId: accountId.value,
    idempotencyKey: idempotencyKey.value,
    contractId: contractId.value,
    assumptionsVersion: FUTURES_ACCOUNTING_VERSION,
    kind: input.kind,
    product: "futures",
    direction: input.direction ?? null,
    quantity: input.quantity ?? null,
    feeRate: input.feeRate ?? null,
    bids: input.bids ?? null,
    asks: input.asks ?? null,
    mark: input.mark ?? null,
    amount: input.amount ?? null,
    statement: statement.statement,
  }));
  const prior = stores.accounting.keys.get(requestKey(actor.actor.tenantId, idempotencyKey.value));
  if (prior) {
    if (prior.canonical !== body) return fail("idempotency key is already recorded");
    return publish(prior.report, true);
  }
  const slot = accountKey(actor.actor.tenantId, accountId.value);
  let account = stores.accounting.accounts.get(slot);
  if (account && account.contractId !== contract.contractId) return fail("contract does not match");
  if (!account) account = blankAccount(actor.actor, { accountId: accountId.value }, contract);
  const applied = input.kind === "fill"
    ? applyFill(stores.contracts, account, input)
    : applyCash(account, input);
  if (!applied.ok) return fail(applied.error);
  if (applied.markSupplied != null && applied.markSupplied !== "") {
    const checked = positive(applied.markSupplied, "mark is not configured");
    if (!checked.ok) return fail(checked.error);
    const probe = grid(stores.contracts, account.contractId, checked.value, contract.units.lotSize);
    if (!probe.ok) return fail(probe.error);
    applied.mark = checked.value;
  }
  if (applied.lots.length > 0 && (applied.mark == null || applied.mark === "")) {
    return fail("mark is not configured");
  }
  if (applied.mark != null && applied.mark !== "" && applied.lots.length > 0) {
    const priced = markValue(stores.contracts, account.contractId, applied.lots, applied.mark);
    if (!priced.ok) return fail(priced.error);
  }
  const built = reportOf(
    account,
    { ...applied, contracts: stores.contracts },
    statement.statement,
    String(account.reports.length + 1),
  );
  if (!built.ok && built.error && built.report == null) return fail(built.error);
  const next = {
    ...account,
    lots: applied.lots.map((lot) => ({ ...lot })),
    realized: applied.realized,
    fees: applied.fees,
    funding: applied.funding,
    mark: applied.mark,
    reports: Object.freeze([...account.reports, built.report]),
  };
  stores.accounting.accounts.set(slot, next);
  stores.accounting.keys.set(requestKey(actor.actor.tenantId, idempotencyKey.value), {
    canonical: body,
    report: built.report,
  });
  return publish(built.report, false);
}

export function readFuturesAccounting(store, input) {
  if (!plainObject(store) || !(store.accounts instanceof Map) || !(store.keys instanceof Map)) {
    return fail("unsupported field");
  }
  if (!plainObject(input) || unknownKey(input, READ_KEYS)) return fail("unsupported field");
  const actor = actorOf(input.actor);
  if (!actor.ok) return fail(actor.error);
  const accountId = named(input.accountId, "account is not configured");
  if (!accountId.ok) return fail(accountId.error);
  const account = store.accounts.get(accountKey(actor.actor.tenantId, accountId.value));
  if (!account || account.tenantId !== actor.actor.tenantId || account.reports.length === 0) {
    return fail("account is not configured");
  }
  return publish(account.reports[account.reports.length - 1], false);
}
