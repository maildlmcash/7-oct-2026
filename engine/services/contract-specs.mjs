// Contract specifications for TASK 12.A.01.
// Design page 6 records an instrument as symbol, base, quote, contract type,
// tick size, lot size, multiplier, expiry, and funding interval.
// Design page 8 says perpetual and dated futures, and linear and inverse
// contracts, keep separate multipliers and PnL. It does not write the algebra.
// Linear PnL is side * (exit - entry) * quantity * multiplier.
// Inverse PnL is side * quantity * multiplier * (1/entry - 1/exit).
// No fee, funding payment, or FX rate is applied. The futures signed score is
// not calculated. A missing contract blocks that score. This module does not
// place orders.

const DECIMAL = /^(?:0|[1-9]\d*)(?:\.\d+)?$/;
const DIGITS = /^(?:0|[1-9]\d*)$/;
const EMAIL = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i;
const STYLES = new Set(["linear", "inverse"]);
const TENORS = new Set(["perpetual", "dated"]);
const SIDES = new Set(["long", "short"]);
const REGISTER_KEYS = Object.freeze([
  "id",
  "canonicalSymbol",
  "venueSymbol",
  "base",
  "quote",
  "style",
  "tenor",
  "multiplier",
  "settlementCurrency",
  "tickSize",
  "lotSize",
  "markSource",
  "indexSource",
  "expiry",
  "fundingInterval",
]);
const CONVERT_KEYS = Object.freeze([
  "contractId",
  "side",
  "quantity",
  "entryPrice",
  "exitPrice",
]);
const SCORE_KEYS = Object.freeze(["contractId"]);

export const CONTRACT_STYLES = Object.freeze(["linear", "inverse"]);
export const CONTRACT_TENORS = Object.freeze(["perpetual", "dated"]);
export const LINEAR_PNL = "side * (exit - entry) * quantity * multiplier";
export const INVERSE_PNL = "side * quantity * multiplier * (1/entry - 1/exit)";
export const INVERSE_QUANTITY_UNIT = "contract";

function fail(error) {
  return Object.freeze({
    ok: false,
    blocked: "BLOCKED",
    error,
    score: null,
    pnl: null,
    formula: null,
    contractId: null,
    style: null,
    tenor: null,
    units: null,
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
  if (typeof value !== "string" || value.length === 0) return false;
  if (EMAIL.test(value)) return true;
  if (/bearer\s+/i.test(value)) return true;
  if (value.includes("BEGIN PRIVATE KEY")) return true;
  if (/seed phrase/i.test(value)) return true;
  return false;
}

function textField(value, missing) {
  if (value === undefined || value === null || (typeof value === "string" && value.trim() === "")) {
    return { ok: false, error: missing };
  }
  if (!filled(value)) return { ok: false, error: "unsupported field" };
  if (leaked(value)) return { ok: false, error: "secret value is not allowed" };
  return { ok: true, value };
}

function choice(value, allowed, missing, unsupported) {
  const read = textField(value, missing);
  if (!read.ok) return read;
  if (!allowed.has(read.value)) return { ok: false, error: unsupported };
  return read;
}

function decimal(value) {
  return typeof value === "string" && DECIMAL.test(value);
}

function parseDecimal(value) {
  if (!decimal(value)) return null;
  const [whole, frac = ""] = value.split(".");
  const digits = `${whole}${frac}`.replace(/^0+(?=\d)/, "");
  return { n: BigInt(digits), scale: frac.length };
}

function positiveDecimal(value, missing) {
  if (value === undefined || value === null || (typeof value === "string" && value.trim() === "")) {
    return { ok: false, error: missing };
  }
  const parsed = parseDecimal(value);
  if (!parsed) return { ok: false, error: "unsupported field" };
  if (parsed.n === 0n) return { ok: false, error: missing };
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

function scaleTo(part, scale) {
  return part.n * 10n ** BigInt(scale - part.scale);
}

function onGrid(value, step) {
  const scale = Math.max(value.scale, step.scale);
  const right = scaleTo(step, scale);
  if (right === 0n) return false;
  return scaleTo(value, scale) % right === 0n;
}

function timeValue(value) {
  if (typeof value === "number") return Number.isSafeInteger(value) && value >= 0;
  return typeof value === "string" && DIGITS.test(value);
}

function timeText(value) {
  return BigInt(typeof value === "number" ? String(value) : value).toString();
}

function storeOf(store) {
  return Boolean(store) && store.kind === "contract" && store.contracts instanceof Map;
}

function sameRecord(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function linearPnl(entry, exit, quantity, multiplier, sign) {
  const scale = Math.max(entry.scale, exit.scale);
  const diff = scaleTo(exit, scale) - scaleTo(entry, scale);
  const numerator = diff * quantity.n * multiplier.n * sign;
  const denominator = 10n ** BigInt(scale + quantity.scale + multiplier.scale);
  return ratio(numerator, denominator);
}

function inversePnl(entry, exit, quantity, multiplier, sign) {
  const numerator = exit.n * 10n ** BigInt(entry.scale) - entry.n * 10n ** BigInt(exit.scale);
  const signed = numerator * quantity.n * multiplier.n * sign;
  const denominator = entry.n * exit.n * 10n ** BigInt(quantity.scale + multiplier.scale);
  return ratio(signed, denominator);
}

function unitsOf(contract) {
  return Object.freeze({
    price: contract.quote,
    quantity: contract.style === "linear" ? contract.base : INVERSE_QUANTITY_UNIT,
    settlement: contract.settlementCurrency,
    tickSize: contract.tickSize,
    lotSize: contract.lotSize,
    multiplier: contract.multiplier,
  });
}

export function createContractStore() {
  return { kind: "contract", contracts: new Map() };
}

export function registerContract(store, input) {
  if (!storeOf(store)) return fail("contract is not configured");
  if (!plainObject(input) || unknownKey(input, REGISTER_KEYS)) return fail("unsupported field");
  const id = textField(input.id, "contract is not configured");
  if (!id.ok) return fail(id.error);
  const canonicalSymbol = textField(input.canonicalSymbol, "symbol is not configured");
  if (!canonicalSymbol.ok) return fail(canonicalSymbol.error);
  const venueSymbol = textField(input.venueSymbol, "symbol is not configured");
  if (!venueSymbol.ok) return fail(venueSymbol.error);
  const base = textField(input.base, "base is not configured");
  if (!base.ok) return fail(base.error);
  const quote = textField(input.quote, "quote is not configured");
  if (!quote.ok) return fail(quote.error);
  const style = choice(input.style, STYLES, "contract style is not configured", "contract style is not supported");
  if (!style.ok) return fail(style.error);
  const tenor = choice(input.tenor, TENORS, "contract tenor is not configured", "contract tenor is not supported");
  if (!tenor.ok) return fail(tenor.error);
  const multiplier = positiveDecimal(input.multiplier, "multiplier is not configured");
  if (!multiplier.ok) return fail(multiplier.error);
  const settlementCurrency = textField(input.settlementCurrency, "settlement currency is not configured");
  if (!settlementCurrency.ok) return fail(settlementCurrency.error);
  const tickSize = positiveDecimal(input.tickSize, "tick size is not configured");
  if (!tickSize.ok) return fail(tickSize.error);
  const lotSize = positiveDecimal(input.lotSize, "lot size is not configured");
  if (!lotSize.ok) return fail(lotSize.error);
  const markSource = textField(input.markSource, "mark source is not configured");
  if (!markSource.ok) return fail(markSource.error);
  const indexSource = textField(input.indexSource, "index source is not configured");
  if (!indexSource.ok) return fail(indexSource.error);

  let expiry = null;
  if (tenor.value === "perpetual") {
    if (Object.hasOwn(input, "expiry") && input.expiry !== null) return fail("expiry is not allowed");
    if (!Object.hasOwn(input, "fundingInterval")) return fail("funding schedule is not configured");
  } else if (!Object.hasOwn(input, "expiry") || input.expiry === null) {
    return fail("expiry is not configured");
  } else if (!timeValue(input.expiry)) {
    return fail(typeof input.expiry === "string" && input.expiry.trim() === "" ? "expiry is not configured" : "unsupported field");
  } else {
    expiry = timeText(input.expiry);
  }

  let fundingInterval = null;
  if (Object.hasOwn(input, "fundingInterval") && input.fundingInterval !== null) {
    const interval = positiveDecimal(input.fundingInterval, "funding schedule is not configured");
    if (!interval.ok) return fail(interval.error);
    fundingInterval = interval.value;
  } else if (tenor.value === "perpetual") {
    return fail("funding schedule is not configured");
  }

  const record = Object.freeze({
    id: id.value,
    canonicalSymbol: canonicalSymbol.value,
    venueSymbol: venueSymbol.value,
    base: base.value,
    quote: quote.value,
    style: style.value,
    tenor: tenor.value,
    multiplier: multiplier.value,
    settlementCurrency: settlementCurrency.value,
    tickSize: tickSize.value,
    lotSize: lotSize.value,
    markSource: markSource.value,
    indexSource: indexSource.value,
    expiry,
    fundingInterval,
  });
  const existing = store.contracts.get(record.id);
  if (existing) {
    if (!sameRecord(existing, record)) return fail("contract is already registered");
    return Object.freeze({
      ok: true,
      blocked: null,
      error: null,
      score: null,
      pnl: null,
      formula: null,
      contractId: existing.id,
      style: existing.style,
      tenor: existing.tenor,
      units: unitsOf(existing),
    });
  }
  store.contracts.set(record.id, record);
  return Object.freeze({
    ok: true,
    blocked: null,
    error: null,
    score: null,
    pnl: null,
    formula: null,
    contractId: record.id,
    style: record.style,
    tenor: record.tenor,
    units: unitsOf(record),
  });
}

export function readContract(store, contractId) {
  if (!storeOf(store)) return fail("contract is not configured");
  const id = textField(contractId, "contract is not configured");
  if (!id.ok) return fail(id.error);
  const contract = store.contracts.get(id.value);
  if (!contract) return fail("contract is not configured");
  return Object.freeze({
    ok: true,
    blocked: null,
    error: null,
    score: null,
    pnl: null,
    formula: contract.style === "linear" ? LINEAR_PNL : INVERSE_PNL,
    contractId: contract.id,
    style: contract.style,
    tenor: contract.tenor,
    units: unitsOf(contract),
    contract,
  });
}

export function convertContractPnl(store, input) {
  if (!storeOf(store)) return fail("contract is not configured");
  if (!plainObject(input) || unknownKey(input, CONVERT_KEYS)) return fail("unsupported field");
  const id = textField(input.contractId, "contract is not configured");
  if (!id.ok) return fail(id.error);
  const contract = store.contracts.get(id.value);
  if (!contract) return fail("contract is not configured");
  const side = choice(input.side, SIDES, "side is not configured", "side is not supported");
  if (!side.ok) return fail(side.error);
  const quantity = positiveDecimal(input.quantity, "quantity is not configured");
  if (!quantity.ok) return fail(quantity.error);
  const entry = positiveDecimal(input.entryPrice, "price is not configured");
  if (!entry.ok) return fail(entry.error);
  const exit = positiveDecimal(input.exitPrice, "price is not configured");
  if (!exit.ok) return fail(exit.error);
  const tick = parseDecimal(contract.tickSize);
  const lot = parseDecimal(contract.lotSize);
  const multiplier = parseDecimal(contract.multiplier);
  if (!tick || !lot || !multiplier) return fail("contract is not configured");
  if (!onGrid(entry.parsed, tick) || !onGrid(exit.parsed, tick)) return fail("price is not on the tick");
  if (!onGrid(quantity.parsed, lot)) return fail("quantity is not on the lot");
  const sign = side.value === "long" ? 1n : -1n;
  const pnl = contract.style === "linear"
    ? linearPnl(entry.parsed, exit.parsed, quantity.parsed, multiplier, sign)
    : inversePnl(entry.parsed, exit.parsed, quantity.parsed, multiplier, sign);
  if (pnl === null) return fail("contract is not configured");
  return Object.freeze({
    ok: true,
    blocked: null,
    error: null,
    score: null,
    pnl,
    formula: contract.style === "linear" ? LINEAR_PNL : INVERSE_PNL,
    contractId: contract.id,
    style: contract.style,
    tenor: contract.tenor,
    units: unitsOf(contract),
  });
}

export function readContractScore(store, input) {
  if (!storeOf(store)) return fail("contract is not configured");
  if (!plainObject(input) || unknownKey(input, SCORE_KEYS)) return fail("unsupported field");
  const id = textField(input.contractId, "contract is not configured");
  if (!id.ok) return fail(id.error);
  const contract = store.contracts.get(id.value);
  if (!contract) return fail("contract is not configured");
  return Object.freeze({
    ok: true,
    blocked: null,
    error: null,
    score: null,
    pnl: null,
    formula: null,
    contractId: contract.id,
    style: contract.style,
    tenor: contract.tenor,
    units: unitsOf(contract),
  });
}
