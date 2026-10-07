import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { health } from "../apps/web/health.mjs";
import {
  INVERSE_PNL,
  INVERSE_QUANTITY_UNIT,
  LINEAR_PNL,
  convertContractPnl,
  createContractStore,
  readContract,
  readContractScore,
  registerContract,
} from "../services/contract-specs.mjs";
import * as specs from "../services/contract-specs.mjs";

const TIME = 1499865549590;

function contract(overrides) {
  return {
    id: "fixture-linear-perpetual",
    canonicalSymbol: "fixture-canonical",
    venueSymbol: "fixture-venue",
    base: "BTC",
    quote: "USDT",
    style: "linear",
    tenor: "perpetual",
    multiplier: "1",
    settlementCurrency: "USDT",
    tickSize: "0.5",
    lotSize: "1",
    markSource: "fixture-mark",
    indexSource: "fixture-index",
    expiry: null,
    fundingInterval: "8",
    ...overrides,
  };
}

function move(contractId, overrides) {
  return {
    contractId,
    side: "long",
    quantity: "2",
    entryPrice: "100",
    exitPrice: "110",
    ...overrides,
  };
}

test("contract fixtures keep units and convert linear and inverse PnL", () => {
  const store = createContractStore();
  const linearPerp = registerContract(store, contract({}));
  const inversePerp = registerContract(store, contract({
    id: "fixture-inverse-perpetual",
    style: "inverse",
    quote: "USD",
    settlementCurrency: "BTC",
  }));
  const linearDated = registerContract(store, contract({
    id: "fixture-linear-dated",
    tenor: "dated",
    multiplier: "0.01",
    tickSize: "0.1",
    expiry: TIME,
    fundingInterval: null,
  }));
  const inverseDated = registerContract(store, contract({
    id: "fixture-inverse-dated",
    style: "inverse",
    tenor: "dated",
    quote: "USD",
    settlementCurrency: "BTC",
    multiplier: "10",
    tickSize: "1",
    expiry: String(TIME),
    fundingInterval: null,
  }));
  assert.equal(linearPerp.ok, true);
  assert.equal(inversePerp.ok, true);
  assert.equal(linearDated.ok, true);
  assert.equal(inverseDated.ok, true);
  assert.equal(store.contracts.size, 4);

  const again = registerContract(store, structuredClone(contract({})));
  assert.equal(again.ok, true);
  assert.equal(store.contracts.size, 4);
  assert.deepEqual(readContract(store, "fixture-linear-perpetual"), readContract(store, "fixture-linear-perpetual"));

  const linear = convertContractPnl(store, move("fixture-linear-perpetual"));
  assert.equal(linear.ok, true);
  assert.equal(linear.blocked, null);
  assert.equal(linear.score, null);
  assert.equal(linear.formula, LINEAR_PNL);
  assert.equal(linear.pnl, "20");
  assert.equal(linear.units.price, "USDT");
  assert.equal(linear.units.quantity, "BTC");
  assert.equal(linear.units.settlement, "USDT");
  assert.equal(linear.units.tickSize, "0.5");
  assert.equal(linear.units.lotSize, "1");
  assert.equal(linear.units.multiplier, "1");
  assert.deepEqual(convertContractPnl(store, structuredClone(move("fixture-linear-perpetual"))), linear);

  const flat = convertContractPnl(store, move("fixture-linear-perpetual", { exitPrice: "100" }));
  assert.equal(flat.pnl, "0");

  const inverse = convertContractPnl(store, move("fixture-inverse-perpetual"));
  assert.equal(inverse.formula, INVERSE_PNL);
  assert.equal(inverse.pnl, "1/550");
  assert.equal(inverse.units.price, "USD");
  assert.equal(inverse.units.quantity, INVERSE_QUANTITY_UNIT);
  assert.equal(inverse.units.settlement, "BTC");
  const inverseShort = convertContractPnl(store, move("fixture-inverse-perpetual", { side: "short" }));
  assert.equal(inverseShort.pnl, "-1/550");

  const dated = convertContractPnl(store, move("fixture-linear-dated", { side: "short" }));
  assert.equal(dated.tenor, "dated");
  assert.equal(dated.pnl, "-0.2");
  assert.equal(dated.units.multiplier, "0.01");
  assert.equal(readContract(store, "fixture-linear-dated").contract.expiry, String(TIME));
  assert.equal(readContract(store, "fixture-linear-dated").contract.fundingInterval, null);
  assert.equal(readContract(store, "fixture-linear-perpetual").contract.fundingInterval, "8");

  const inverseDate = convertContractPnl(store, move("fixture-inverse-dated", {
    quantity: "1",
    exitPrice: "125",
  }));
  assert.equal(inverseDate.pnl, "0.02");
  assert.equal(inverseDate.units.quantity, INVERSE_QUANTITY_UNIT);
  assert.equal(inverseDate.units.settlement, "BTC");

  const known = readContractScore(store, { contractId: "fixture-linear-perpetual" });
  assert.equal(known.ok, true);
  assert.equal(known.blocked, null);
  assert.equal(known.score, null);
  assert.equal(known.pnl, null);
  assert.equal(known.style, "linear");
  assert.equal(known.tenor, "perpetual");
  assert.throws(() => {
    readContract(store, "fixture-linear-perpetual").contract.multiplier = "2";
  });
});

test("unknown contract data blocks scoring and PnL", () => {
  const store = createContractStore();
  const saved = registerContract(store, contract({}));
  assert.equal(saved.ok, true);

  const missingMultiplier = registerContract(store, contract({ id: "fixture-missing", multiplier: "" }));
  assert.equal(missingMultiplier.ok, false);
  assert.equal(missingMultiplier.blocked, "BLOCKED");
  assert.equal(missingMultiplier.error, "multiplier is not configured");
  assert.equal(missingMultiplier.score, null);
  assert.equal(missingMultiplier.pnl, null);
  assert.equal(store.contracts.size, 1);

  assert.equal(registerContract(store, contract({ id: "fixture-missing", multiplier: "0" })).error, "multiplier is not configured");
  assert.equal(registerContract(store, contract({ id: "fixture-missing", settlementCurrency: "   " })).error, "settlement currency is not configured");
  assert.equal(registerContract(store, contract({ id: "fixture-missing", tickSize: "" })).error, "tick size is not configured");
  assert.equal(registerContract(store, contract({ id: "fixture-missing", lotSize: "" })).error, "lot size is not configured");
  assert.equal(registerContract(store, contract({ id: "fixture-missing", markSource: "" })).error, "mark source is not configured");
  assert.equal(registerContract(store, contract({ id: "fixture-missing", indexSource: "" })).error, "index source is not configured");
  assert.equal(registerContract(store, contract({ id: "fixture-missing", fundingInterval: null })).error, "funding schedule is not configured");
  assert.equal(registerContract(store, contract({ id: "fixture-missing", tenor: "dated", expiry: null, fundingInterval: null })).error, "expiry is not configured");
  assert.equal(registerContract(store, contract({ id: "fixture-missing", expiry: TIME })).error, "expiry is not allowed");
  assert.equal(registerContract(store, contract({ id: "fixture-missing", style: "quanto" })).error, "contract style is not supported");
  assert.equal(JSON.stringify(registerContract(store, contract({ id: "fixture-missing", style: "quanto" }))).includes("quanto"), false);
  assert.equal(registerContract(store, contract({ id: "fixture-missing", tenor: "spot" })).error, "contract tenor is not supported");
  assert.equal(registerContract(store, contract({ multiplier: "2" })).error, "contract is already registered");
  assert.equal(registerContract(store, { ...contract({}), guessed: "1" }).error, "unsupported field");
  assert.equal(JSON.stringify(registerContract(store, { ...contract({}), guessed: "1" })).includes("guessed"), false);
  const secret = registerContract(store, contract({ id: "fixture-secret", markSource: "BEGIN PRIVATE KEY" }));
  assert.equal(secret.error, "secret value is not allowed");
  assert.equal(JSON.stringify(secret).includes("BEGIN PRIVATE KEY"), false);
  assert.equal(JSON.stringify([...store.contracts.values()]).includes("BEGIN PRIVATE KEY"), false);
  assert.equal(store.contracts.size, 1);

  const unknownScore = readContractScore(store, { contractId: "fixture-missing" });
  assert.equal(unknownScore.blocked, "BLOCKED");
  assert.equal(unknownScore.error, "contract is not configured");
  assert.equal(unknownScore.score, null);
  assert.equal(unknownScore.pnl, null);
  const unknownPnl = convertContractPnl(store, move("fixture-missing"));
  assert.equal(unknownPnl.blocked, "BLOCKED");
  assert.equal(unknownPnl.error, "contract is not configured");
  assert.equal(unknownPnl.score, null);
  assert.equal(unknownPnl.pnl, null);

  const offTick = convertContractPnl(store, move("fixture-linear-perpetual", { entryPrice: "100.2" }));
  assert.equal(offTick.error, "price is not on the tick");
  assert.equal(offTick.pnl, null);
  assert.equal(offTick.score, null);
  const offLot = convertContractPnl(store, move("fixture-linear-perpetual", { quantity: "1.5" }));
  assert.equal(offLot.error, "quantity is not on the lot");
  assert.equal(offLot.pnl, null);
  const badSide = convertContractPnl(store, move("fixture-linear-perpetual", { side: "guessed" }));
  assert.equal(badSide.error, "side is not supported");
  assert.equal(JSON.stringify(badSide).includes("guessed"), false);
  assert.equal(readContractScore(store, { contractId: "fixture-linear-perpetual", features: { OBI: "1" } }).error, "unsupported field");
  assert.equal(registerContract({ kind: "baseline", contracts: new Map() }, contract({})).error, "contract is not configured");
});

test("the contract spec export is closed and live trading stays off", () => {
  assert.deepEqual(Object.keys(specs).sort(), [
    "CONTRACT_STYLES",
    "CONTRACT_TENORS",
    "INVERSE_PNL",
    "INVERSE_QUANTITY_UNIT",
    "LINEAR_PNL",
    "convertContractPnl",
    "createContractStore",
    "readContract",
    "readContractScore",
    "registerContract",
  ]);
  const source = readFileSync(new URL("../services/contract-specs.mjs", import.meta.url), "utf8");
  assert.equal(source.includes("placeOrder"), false);
  assert.equal(source.includes("https://"), false);
  assert.equal(source.includes("fetch("), false);
  assert.equal(source.includes("NO_TRADE"), false);
  assert.equal(source.includes("ABSTAIN"), false);
  assert.equal(source.includes("S_fut"), false);
  assert.equal(health.status, "ok");
  assert.equal(health.liveTrading, "OFF");
  assert.equal(health.liveOrdersLocked, true);
});
