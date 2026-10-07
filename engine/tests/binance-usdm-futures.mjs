import assert from "node:assert/strict";
import test from "node:test";
import { health } from "../apps/web/health.mjs";
import { parseExchangeInfo } from "../services/binance-spot-public.mjs";
import {
  BINANCE_USDM_PUBLIC_DOCS,
  parsePremiumIndex,
  parseUsdMContract,
  publicUsdMUrl,
  useUsdMMarket,
} from "../services/binance-usdm-futures-public.mjs";

const futuresContract = {
  symbol: "BLZUSDT",
  pair: "BLZUSDT",
  contractType: "PERPETUAL",
  deliveryDate: 4133404800000,
  onboardDate: 1598252400000,
  status: "TRADING",
  baseAsset: "BLZ",
  quoteAsset: "USDT",
  marginAsset: "USDT",
};

const spotInstrument = {
  timezone: "UTC",
  serverTime: 1565246363776,
  symbols: [{
    symbol: "ETHBTC",
    status: "TRADING",
    baseAsset: "ETH",
    baseAssetPrecision: 8,
    quoteAsset: "BTC",
    quoteAssetPrecision: 8,
    isSpotTradingAllowed: true,
  }],
};

test("USD-M contract units stay distinct from Spot and missing metadata blocks use", () => {
  assert.equal(BINANCE_USDM_PUBLIC_DOCS.product, "USD-M");
  assert.equal(BINANCE_USDM_PUBLIC_DOCS.version, "1.0.0");
  assert.equal(BINANCE_USDM_PUBLIC_DOCS.checkedAt, "2026-10-06");
  assert.equal(BINANCE_USDM_PUBLIC_DOCS.origin, "https://fapi.binance.com");

  const contract = parseUsdMContract(futuresContract);
  assert.equal(contract.contract.product, "USD-M");
  assert.equal(contract.contract.symbol, "BLZUSDT");
  assert.equal(contract.contract.contractType, "PERPETUAL");
  assert.equal(contract.contract.quantityUnit, "BLZ");
  assert.equal(contract.contract.priceUnit, "USDT");
  assert.equal(contract.contract.marginUnit, "USDT");

  const spot = parseExchangeInfo(spotInstrument);
  assert.equal(spot.kind, "spot-instrument");
  assert.equal(spot.symbols[0].symbol, "ETHBTC");
  assert.equal(spot.symbols[0].baseAsset, "ETH");
  assert.equal(spot.symbols[0].quoteAsset, "BTC");
  assert.equal(Object.hasOwn(spot.symbols[0], "marginAsset"), false);
  assert.equal(Object.hasOwn(spot.symbols[0], "contractType"), false);
  assert.equal(parseUsdMContract(spot.symbols[0]).error, "contract metadata is required");
  assert.equal(parseExchangeInfo({
    timezone: "UTC",
    serverTime: 1565613908500,
    symbols: [futuresContract],
  }).error, "instrument schema is not allowed");
  assert.notEqual(contract.contract.symbol, spot.symbols[0].symbol);
  assert.notEqual(contract.contract.quantityUnit, spot.symbols[0].baseAsset);
  assert.notEqual(contract.contract.marginUnit, spot.symbols[0].quoteAsset);

  const prices = parsePremiumIndex({
    symbol: "BLZUSDT",
    markPrice: "11793.63104562",
    indexPrice: "11781.80495970",
  });
  assert.equal(prices.prices.markPrice, "11793.63104562");
  assert.equal(prices.prices.indexPrice, "11781.80495970");
  assert.notEqual(prices.prices.markPrice, prices.prices.indexPrice);

  const used = useUsdMMarket(futuresContract, {
    symbol: "BLZUSDT",
    markPrice: "11793.63104562",
    indexPrice: "11781.80495970",
  });
  assert.equal(used.ok, true);
  assert.equal(used.blocked, null);
  assert.equal(used.market.markPrice, "11793.63104562");
  assert.equal(used.market.indexPrice, "11781.80495970");
  assert.equal(used.market.quantityUnit, "BLZ");
  assert.equal(used.market.marginUnit, "USDT");

  const missingMargin = useUsdMMarket({ ...futuresContract, marginAsset: "" }, {
    symbol: "BLZUSDT",
    markPrice: "11793.63104562",
    indexPrice: "11781.80495970",
  });
  assert.equal(missingMargin.blocked, "BLOCKED");
  assert.equal(missingMargin.error, "contract metadata is required");
  assert.equal(Object.hasOwn(missingMargin, "market"), false);

  const missingIndex = useUsdMMarket(futuresContract, {
    symbol: "BLZUSDT",
    markPrice: "11793.63104562",
  });
  assert.equal(missingIndex.blocked, "BLOCKED");
  assert.equal(missingIndex.error, "index price is required");
  assert.equal(Object.hasOwn(missingIndex, "market"), false);

  const mismatched = useUsdMMarket(futuresContract, {
    symbol: "BTCUSDT",
    markPrice: "11793.63104562",
    indexPrice: "11781.80495970",
  });
  assert.equal(mismatched.blocked, "BLOCKED");
  assert.equal(Object.hasOwn(mismatched, "market"), false);
  assert.equal(parsePremiumIndex({
    symbol: "BLZUSDT",
    markPrice: 11793.63,
    indexPrice: "11781.80495970",
  }).error, "mark price is required");
  assert.equal(parseUsdMContract({ ...futuresContract, contractType: "SPOT" }).error, "contract type is not allowed");

  const order = publicUsdMUrl("/fapi/v1/order", { symbol: "BLZUSDT" });
  assert.equal(order.error, "orders are closed");
  const info = publicUsdMUrl("/fapi/v1/exchangeInfo");
  assert.equal(info.url, "https://fapi.binance.com/fapi/v1/exchangeInfo");
  const premium = publicUsdMUrl("/fapi/v1/premiumIndex", { symbol: "BLZUSDT" });
  assert.equal(premium.method, "GET");
  assert.equal(premium.url, "https://fapi.binance.com/fapi/v1/premiumIndex?symbol=BLZUSDT");
  assert.equal(premium.url.includes("signature"), false);
  assert.equal(health.liveTrading, "OFF");
  assert.equal(health.liveOrdersLocked, true);
});
