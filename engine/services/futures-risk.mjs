// Futures risk diagnostics for TASK 12.B.02.
// Design page 9 says max leverage, max notional, the maintenance-margin
// buffer, and the liquidation-distance floor are admin-configured.
// The source names no numeric cap and no liquidation-distance formula.
// The source names no margin-mode list. The supplied mode is recorded.
// A missing input or a failed cap returns NO_TRADE.
// This module does not change leverage and does not submit an order.

const DECIMAL = /^(?:0|[1-9]\d*)(?:\.\d+)?$/;
const EMAIL = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i;
const KEYS = Object.freeze([
  "leverage",
  "maxLeverage",
  "marginMode",
  "notional",
  "maxNotional",
  "maintenanceMarginBuffer",
  "maintenanceMarginBufferFloor",
  "liquidationDistance",
  "liquidationDistanceFloor",
]);

export const FUTURES_RISK_ACTION = "NO_TRADE";
export const LIQUIDATION_DISTANCE_FORMULA = "NOT IN SOURCE";

function abstain(error, values = {}) {
  return Object.freeze({
    ok: false,
    blocked: "BLOCKED",
    error,
    action: FUTURES_RISK_ACTION,
    leverageAssumption: values.leverage ?? null,
    maxLeverage: values.maxLeverage ?? null,
    marginMode: values.marginMode ?? null,
    notional: values.notional ?? null,
    maxNotional: values.maxNotional ?? null,
    maintenanceMarginBuffer: values.maintenanceMarginBuffer ?? null,
    maintenanceMarginBufferFloor: values.maintenanceMarginBufferFloor ?? null,
    liquidationDistance: values.liquidationDistance ?? null,
    liquidationDistanceFloor: values.liquidationDistanceFloor ?? null,
    liquidationDistanceFormula: LIQUIDATION_DISTANCE_FORMULA,
    leverageChanged: false,
    orderSubmitted: false,
  });
}

function plainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function unknownKey(value) {
  for (const key of Object.keys(value)) {
    if (!KEYS.includes(key)) return true;
  }
  return false;
}

function missingKey(value) {
  for (const key of KEYS) {
    if (!Object.prototype.hasOwnProperty.call(value, key)) return true;
  }
  return false;
}

function filled(value) {
  return typeof value === "string" && value.length > 0 && value === value.trim();
}

function blank(value) {
  return value === undefined || value === null || (typeof value === "string" && value.trim() === "");
}

function leaked(value) {
  if (typeof value !== "string" || value.length === 0) return false;
  if (EMAIL.test(value)) return true;
  if (/bearer\s+/i.test(value)) return true;
  if (value.includes("BEGIN PRIVATE KEY")) return true;
  if (/seed phrase/i.test(value)) return true;
  return false;
}

function parseDecimal(value) {
  if (typeof value !== "string" || !DECIMAL.test(value)) return null;
  const [whole, frac = ""] = value.split(".");
  const digits = `${whole}${frac}`.replace(/^0+(?=\d)/, "");
  return { n: BigInt(digits), scale: frac.length };
}

function compare(left, right) {
  const scale = Math.max(left.scale, right.scale);
  const a = left.n * 10n ** BigInt(scale - left.scale);
  const b = right.n * 10n ** BigInt(scale - right.scale);
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}

function decimalField(value, missing) {
  if (blank(value)) return { ok: false, error: missing };
  const parsed = parseDecimal(value);
  if (!parsed) return { ok: false, error: "unsupported field" };
  return { ok: true, value, parsed };
}

export function readFuturesRisk(input) {
  if (!plainObject(input) || unknownKey(input) || missingKey(input)) {
    return abstain("unsupported field");
  }
  const leverage = decimalField(input.leverage, "leverage is not configured");
  if (!leverage.ok) return abstain(leverage.error);
  const maxLeverage = decimalField(input.maxLeverage, "max leverage is not configured");
  if (!maxLeverage.ok) return abstain(maxLeverage.error, { leverage: leverage.value });
  if (blank(input.marginMode)) {
    return abstain("margin mode is not configured", {
      leverage: leverage.value,
      maxLeverage: maxLeverage.value,
    });
  }
  if (!filled(input.marginMode)) return abstain("unsupported field");
  if (leaked(input.marginMode)) return abstain("secret value is not allowed");
  const notional = decimalField(input.notional, "notional is not configured");
  if (!notional.ok) {
    return abstain(notional.error, {
      leverage: leverage.value,
      maxLeverage: maxLeverage.value,
      marginMode: input.marginMode,
    });
  }
  const maxNotional = decimalField(input.maxNotional, "max notional is not configured");
  if (!maxNotional.ok) {
    return abstain(maxNotional.error, {
      leverage: leverage.value,
      maxLeverage: maxLeverage.value,
      marginMode: input.marginMode,
      notional: notional.value,
    });
  }
  const buffer = decimalField(input.maintenanceMarginBuffer, "maintenance-margin buffer is not configured");
  if (!buffer.ok) {
    return abstain(buffer.error, {
      leverage: leverage.value,
      maxLeverage: maxLeverage.value,
      marginMode: input.marginMode,
      notional: notional.value,
      maxNotional: maxNotional.value,
    });
  }
  const bufferFloor = decimalField(
    input.maintenanceMarginBufferFloor,
    "maintenance-margin buffer floor is not configured",
  );
  if (!bufferFloor.ok) {
    return abstain(bufferFloor.error, {
      leverage: leverage.value,
      maxLeverage: maxLeverage.value,
      marginMode: input.marginMode,
      notional: notional.value,
      maxNotional: maxNotional.value,
      maintenanceMarginBuffer: buffer.value,
    });
  }
  const distance = decimalField(input.liquidationDistance, "liquidation distance is not configured");
  if (!distance.ok) {
    return abstain(distance.error, {
      leverage: leverage.value,
      maxLeverage: maxLeverage.value,
      marginMode: input.marginMode,
      notional: notional.value,
      maxNotional: maxNotional.value,
      maintenanceMarginBuffer: buffer.value,
      maintenanceMarginBufferFloor: bufferFloor.value,
    });
  }
  const distanceFloor = decimalField(
    input.liquidationDistanceFloor,
    "liquidation-distance floor is not configured",
  );
  if (!distanceFloor.ok) {
    return abstain(distanceFloor.error, {
      leverage: leverage.value,
      maxLeverage: maxLeverage.value,
      marginMode: input.marginMode,
      notional: notional.value,
      maxNotional: maxNotional.value,
      maintenanceMarginBuffer: buffer.value,
      maintenanceMarginBufferFloor: bufferFloor.value,
      liquidationDistance: distance.value,
    });
  }
  const values = {
    leverage: leverage.value,
    maxLeverage: maxLeverage.value,
    marginMode: input.marginMode,
    notional: notional.value,
    maxNotional: maxNotional.value,
    maintenanceMarginBuffer: buffer.value,
    maintenanceMarginBufferFloor: bufferFloor.value,
    liquidationDistance: distance.value,
    liquidationDistanceFloor: distanceFloor.value,
  };
  if (compare(leverage.parsed, maxLeverage.parsed) > 0) return abstain("leverage cap is exceeded", values);
  if (compare(notional.parsed, maxNotional.parsed) > 0) return abstain("notional cap is exceeded", values);
  if (compare(buffer.parsed, bufferFloor.parsed) < 0) return abstain("maintenance-margin buffer is not met", values);
  if (compare(distance.parsed, distanceFloor.parsed) < 0) {
    return abstain("liquidation distance is below the floor", values);
  }
  return Object.freeze({
    ok: true,
    blocked: null,
    error: null,
    action: null,
    leverageAssumption: values.leverage,
    maxLeverage: values.maxLeverage,
    marginMode: values.marginMode,
    notional: values.notional,
    maxNotional: values.maxNotional,
    maintenanceMarginBuffer: values.maintenanceMarginBuffer,
    maintenanceMarginBufferFloor: values.maintenanceMarginBufferFloor,
    liquidationDistance: values.liquidationDistance,
    liquidationDistanceFloor: values.liquidationDistanceFloor,
    liquidationDistanceFormula: LIQUIDATION_DISTANCE_FORMULA,
    leverageChanged: false,
    orderSubmitted: false,
  });
}
