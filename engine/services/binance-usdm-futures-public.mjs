// Public Binance USD-M futures market data for TASK 07.A.02.
// Checked 2026-10-06 against Futures (USDⓈ-M) REST API 1.0.0.
// Quantity is the base asset. Price is the quote asset. Margin is marginAsset.
// Mark price and index price stay separate fields from GET /fapi/v1/premiumIndex.
// Contract metadata is required before either price can be used.
// This module does not place orders and does not read Spot instruments.

export const BINANCE_USDM_PUBLIC_DOCS = Object.freeze({
  venueDocsUrl: "https://developers.binance.com/en/docs",
  restUrl: "https://developers.binance.com/docs/derivatives/usds-margined-futures/market-data/rest-api",
  definitionsUrl: "https://developers.binance.com/docs/products/derivatives-trading-usds-futures/common-definition",
  catalog: "Futures (USDⓈ-M) REST API (1.0.0)",
  version: "1.0.0",
  checkedAt: "2026-10-06",
  origin: "https://fapi.binance.com",
  product: "USD-M",
});

const CONTRACT_TYPES = new Set([
  "PERPETUAL",
  "CURRENT_MONTH",
  "CURRENT_QUARTER",
  "PERPETUAL_DELIVERING",
]);

const CONTRACT_STATUSES = new Set([
  "PENDING_TRADING",
  "TRADING",
  "PRE_DELIVERING",
  "DELIVERING",
  "DELIVERED",
  "PRE_SETTLE",
  "SETTLING",
  "TRADING_HALT",
  "TRADING_CANCEL_ONLY",
]);

const DECIMAL = /^(?:0|[1-9]\d*)(?:\.\d+)?$/;
const SYMBOL = /^[A-Z0-9]+$/;
const PATHS = Object.freeze({
  exchangeInfo: "/fapi/v1/exchangeInfo",
  premiumIndex: "/fapi/v1/premiumIndex",
});

function fail(error) {
  return { ok: false, error, blocked: "BLOCKED" };
}

function decimal(value) {
  return typeof value === "string" && DECIMAL.test(value);
}

function whole(value) {
  return typeof value === "number" && Number.isInteger(value) && value >= 0;
}

function asset(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function symbol(value) {
  return typeof value === "string" && SYMBOL.test(value);
}

export function publicUsdMUrl(path, query) {
  if (path !== PATHS.exchangeInfo && path !== PATHS.premiumIndex) {
    return fail("orders are closed");
  }
  const source = query && typeof query === "object" ? query : {};
  const keys = Object.keys(source);
  if (path === PATHS.exchangeInfo) {
    if (keys.length > 0) return fail("orders are closed");
    return { ok: true, method: "GET", url: `${BINANCE_USDM_PUBLIC_DOCS.origin}${path}` };
  }
  if (!symbol(source.symbol) || keys.length !== 1) return fail("orders are closed");
  return {
    ok: true,
    method: "GET",
    url: `${BINANCE_USDM_PUBLIC_DOCS.origin}${path}?symbol=${source.symbol}`,
  };
}

export function parseUsdMContract(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return fail("contract metadata is required");
  }
  if (!symbol(value.symbol) || !asset(value.pair)) return fail("contract metadata is required");
  if (!asset(value.contractType)) return fail("contract metadata is required");
  if (!CONTRACT_TYPES.has(value.contractType)) return fail("contract type is not allowed");
  if (!whole(value.deliveryDate) || !whole(value.onboardDate)) return fail("contract metadata is required");
  if (!asset(value.status)) return fail("contract metadata is required");
  if (!CONTRACT_STATUSES.has(value.status)) return fail("contract status is not allowed");
  if (!asset(value.baseAsset) || !asset(value.quoteAsset) || !asset(value.marginAsset)) {
    return fail("contract metadata is required");
  }
  return {
    ok: true,
    blocked: null,
    contract: {
      product: BINANCE_USDM_PUBLIC_DOCS.product,
      symbol: value.symbol,
      pair: value.pair,
      contractType: value.contractType,
      deliveryDate: value.deliveryDate,
      onboardDate: value.onboardDate,
      status: value.status,
      quantityUnit: value.baseAsset,
      priceUnit: value.quoteAsset,
      marginUnit: value.marginAsset,
    },
  };
}

export function parsePremiumIndex(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return fail("mark price is required");
  }
  if (!symbol(value.symbol)) return fail("mark price is required");
  if (!decimal(value.markPrice)) return fail("mark price is required");
  if (!decimal(value.indexPrice)) return fail("index price is required");
  return {
    ok: true,
    blocked: null,
    prices: {
      symbol: value.symbol,
      markPrice: value.markPrice,
      indexPrice: value.indexPrice,
    },
  };
}

export function useUsdMMarket(contractInput, premiumInput) {
  const contract = parseUsdMContract(contractInput);
  if (!contract.ok) return contract;
  const prices = parsePremiumIndex(premiumInput);
  if (!prices.ok) return { ok: false, error: prices.error, blocked: "BLOCKED" };
  if (prices.prices.symbol !== contract.contract.symbol) {
    return fail("contract metadata is required");
  }
  return {
    ok: true,
    blocked: null,
    market: {
      ...contract.contract,
      markPrice: prices.prices.markPrice,
      indexPrice: prices.prices.indexPrice,
    },
  };
}
