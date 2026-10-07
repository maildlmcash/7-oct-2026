import assert from "node:assert/strict";
import test from "node:test";
import { health } from "../apps/web/health.mjs";
import * as dex from "../services/dex-pool-events.mjs";
import {
  createDexEventLog,
  ingestDexPoolEvent,
  noteCanonicalChain,
  readDexPoolEvents,
  DEX_SOURCES,
  RAYDIUM_CPMM_PROGRAM_ID,
  WRAPPED_SOL_DECIMALS,
  WRAPPED_SOL_MINT,
  WRAPPED_SOL_RAW_EXAMPLE,
} from "../services/dex-pool-events.mjs";

// Caller fixture. Not a published Uniswap pool.
const EVM_POOL = "0x0000000000000000000000000000000000000001";
const BLOCK_HASH = `0x${"ab".repeat(32)}`;
const OTHER_HASH = `0x${"cd".repeat(32)}`;
// Caller-supplied. NOT IN SOURCE. The fixture pool names no token decimals.
const EVM_DECIMALS_0 = 18;
const EVM_DECIMALS_1 = 8;

// Caller fixture. Not a published Raydium pool and not the System Program.
const SOL_POOL = "11111111111111111111111111111112";
// Caller fixture. The logsSubscribe example signature is a System Program notification and is not used.
const SOL_SIGNATURE = `${"1".repeat(87)}2`;
const OTHER_SIGNATURE = `${"1".repeat(87)}3`;
const DEPOSIT_SIGNATURE = `${"1".repeat(87)}4`;
// Caller-supplied mint and decimals. NOT IN SOURCE. Not a named USDC mint.
const OTHER_MINT = "2".repeat(32);
const OTHER_DECIMALS = 4;

function evmAllow() {
  return [{
    chain: "Ethereum",
    pool: EVM_POOL,
    token0Decimals: EVM_DECIMALS_0,
    token1Decimals: EVM_DECIMALS_1,
  }];
}

function solAllow() {
  return [{
    chain: "Solana",
    pool: SOL_POOL,
    token0Mint: WRAPPED_SOL_MINT,
    token1Mint: OTHER_MINT,
    token0Decimals: WRAPPED_SOL_DECIMALS,
    token1Decimals: OTHER_DECIMALS,
  }];
}

function evmSwap(overrides = {}) {
  return {
    source: "Uniswap v3",
    chain: "Ethereum",
    kind: "Swap",
    pool: EVM_POOL,
    blockNumber: 100,
    blockHash: BLOCK_HASH,
    transactionIndex: 1,
    logIndex: 2,
    token0Decimals: EVM_DECIMALS_0,
    token1Decimals: EVM_DECIMALS_1,
    amount0: "-1000",
    amount1: "2000",
    ...overrides,
  };
}

function solSwap(overrides = {}) {
  return {
    source: "Raydium",
    chain: "Solana",
    kind: "SwapBaseInput",
    programId: RAYDIUM_CPMM_PROGRAM_ID,
    pool: SOL_POOL,
    signature: SOL_SIGNATURE,
    slot: 42,
    commitment: "confirmed",
    token0Mint: WRAPPED_SOL_MINT,
    token1Mint: OTHER_MINT,
    token0Decimals: WRAPPED_SOL_DECIMALS,
    token1Decimals: OTHER_DECIMALS,
    amountIn: WRAPPED_SOL_RAW_EXAMPLE,
    // Caller-supplied. The CLI sample quote 1640000 is not an ingested amount.
    minimumAmountOut: "1",
    ...overrides,
  };
}

function take(log, allowlist, event) {
  const result = ingestDexPoolEvent(log, { allowlist, event });
  assert.equal(result.ok, true);
  assert.equal(result.blocked, null);
  assert.equal(Object.hasOwn(result.event, "admitted"), false);
  return result.event;
}

test("uniswap v3 finality follows the canonical block hash and a dropped hash is a reorg", () => {
  const log = createDexEventLog();
  const swap = take(log, evmAllow(), evmSwap());
  assert.equal(swap.status, "unavailable");
  assert.equal(swap.reason, "unverified");
  assert.equal(swap.finality, null);
  assert.equal(swap.source, "Uniswap v3");
  assert.equal(swap.chain, "Ethereum");
  assert.equal(swap.pool, EVM_POOL);
  assert.equal(swap.blockNumber, 100);
  assert.equal(swap.blockHash, BLOCK_HASH);
  assert.equal(swap.transactionIndex, 1);
  assert.equal(swap.logIndex, 2);
  assert.equal(swap.amount0, "-1000");
  assert.equal(swap.amount1, "2000");
  assert.equal(swap.token0Decimals, EVM_DECIMALS_0);
  assert.equal(swap.token1Decimals, EVM_DECIMALS_1);

  assert.equal(noteCanonicalChain(log, { chain: "Ethereum", blockHashes: [BLOCK_HASH] }).ok, true);
  const canonical = readDexPoolEvents(log);
  assert.equal(canonical.events.length, 1);
  assert.equal(canonical.events[0].status, "available");
  assert.equal(canonical.events[0].reason, null);
  assert.equal(canonical.events[0].finality, "canonical");
  assert.equal(canonical.events[0].amount0, "-1000");
  assert.equal(Object.isFrozen(canonical.events[0]), true);

  assert.equal(noteCanonicalChain(log, { chain: "Ethereum", blockHashes: [OTHER_HASH] }).ok, true);
  const reorg = readDexPoolEvents(log);
  assert.equal(reorg.events.length, 1);
  assert.equal(reorg.events[0].id, swap.id);
  assert.equal(reorg.events[0].status, "unavailable");
  assert.equal(reorg.events[0].reason, "reorg");
  assert.equal(reorg.events[0].finality, null);
  assert.equal(reorg.events[0].blockHash, BLOCK_HASH);

  const mintLog = createDexEventLog();
  const mint = take(mintLog, evmAllow(), evmSwap({
    kind: "Mint",
    logIndex: 3,
    amount0: "10",
    amount1: "11",
  }));
  assert.equal(mint.status, "unavailable");
  assert.equal(mint.reason, "unverified");
  noteCanonicalChain(mintLog, { chain: "Ethereum", blockHashes: [BLOCK_HASH] });
  const minted = readDexPoolEvents(mintLog).events[0];
  assert.equal(minted.kind, "Mint");
  assert.equal(minted.status, "available");
  assert.equal(minted.finality, "canonical");
  assert.equal(minted.amount0, "10");
  assert.equal(minted.amount1, "11");

  const burned = take(createDexEventLog(), evmAllow(), evmSwap({
    kind: "Burn",
    logIndex: 4,
    amount0: "7",
    amount1: "8",
  }));
  assert.equal(burned.kind, "Burn");
  assert.equal(burned.reason, "unverified");

  const negative = take(createDexEventLog(), evmAllow(), evmSwap({
    kind: "Mint",
    logIndex: 5,
    amount0: "-1",
    amount1: "11",
  }));
  assert.equal(negative.status, "unavailable");
  assert.equal(negative.reason, "unverified");
  assert.equal(Object.hasOwn(negative, "amount0"), false);
  assert.equal(JSON.stringify(negative).includes('"-1"'), false);
});

test("token decimals must match the allowlist and raw amounts stay integers", () => {
  const mismatchLog = createDexEventLog();
  const mismatch = take(mismatchLog, evmAllow(), evmSwap({ token0Decimals: 6 }));
  assert.equal(mismatch.status, "unavailable");
  assert.equal(mismatch.reason, "token decimals");
  noteCanonicalChain(mismatchLog, { chain: "Ethereum", blockHashes: [BLOCK_HASH] });
  const still = readDexPoolEvents(mismatchLog).events[0];
  assert.equal(still.reason, "token decimals");
  assert.equal(still.finality, null);
  assert.equal(still.status, "unavailable");

  const fractional = take(createDexEventLog(), evmAllow(), evmSwap({ amount0: "0.01", logIndex: 9 }));
  assert.equal(fractional.status, "unavailable");
  assert.equal(fractional.reason, "unverified");
  assert.equal(Object.hasOwn(fractional, "amount0"), false);
  assert.equal(JSON.stringify(fractional).includes("0.01"), false);

  const sol = take(createDexEventLog(), solAllow(), solSwap());
  assert.equal(sol.status, "available");
  assert.equal(sol.finality, "confirmed");
  assert.equal(sol.amountIn, "10000000");
  assert.equal(sol.token0Decimals, 9);
  assert.equal(sol.token0Mint, WRAPPED_SOL_MINT);
  assert.equal(JSON.stringify(sol).includes("0.01"), false);
  assert.equal(JSON.stringify(sol).includes("1640000"), false);

  const wrongSol = take(createDexEventLog(), solAllow(), solSwap({
    signature: OTHER_SIGNATURE,
    token0Decimals: 6,
  }));
  assert.equal(wrongSol.reason, "token decimals");
  assert.equal(wrongSol.amountIn, "10000000");
});

test("raydium confirmed and finalized stay available and a missing slot is a reorg", () => {
  const processedLog = createDexEventLog();
  const processed = take(processedLog, solAllow(), solSwap({ commitment: "processed" }));
  assert.equal(processed.status, "unavailable");
  assert.equal(processed.reason, "unverified");
  assert.equal(processed.commitment, "processed");
  noteCanonicalChain(processedLog, { chain: "Solana", slots: [42] });
  const processedAfter = readDexPoolEvents(processedLog).events[0];
  assert.equal(processedAfter.reason, "unverified");
  assert.equal(processedAfter.status, "unavailable");

  const confirmedLog = createDexEventLog();
  const confirmed = take(confirmedLog, solAllow(), solSwap({ commitment: "confirmed" }));
  assert.equal(confirmed.status, "available");
  assert.equal(confirmed.finality, "confirmed");
  assert.equal(confirmed.reason, null);
  noteCanonicalChain(confirmedLog, { chain: "Solana", slots: [99] });
  const confirmedReorg = readDexPoolEvents(confirmedLog).events[0];
  assert.equal(confirmedReorg.status, "unavailable");
  assert.equal(confirmedReorg.reason, "reorg");
  assert.equal(confirmedReorg.id, confirmed.id);
  assert.equal(confirmedReorg.signature, SOL_SIGNATURE);

  const finalized = take(createDexEventLog(), solAllow(), solSwap({
    commitment: "finalized",
    signature: OTHER_SIGNATURE,
  }));
  assert.equal(finalized.status, "available");
  assert.equal(finalized.finality, "finalized");

  const depositEvent = solSwap({
    kind: "Deposit",
    commitment: "finalized",
    signature: DEPOSIT_SIGNATURE,
    lpTokenAmount: "100",
    maximumToken0: WRAPPED_SOL_RAW_EXAMPLE,
    maximumToken1: "5",
  });
  delete depositEvent.amountIn;
  delete depositEvent.minimumAmountOut;
  const deposit = take(createDexEventLog(), solAllow(), depositEvent);
  assert.equal(deposit.kind, "Deposit");
  assert.equal(deposit.status, "available");
  assert.equal(deposit.finality, "finalized");
  assert.equal(deposit.lpTokenAmount, "100");
  assert.equal(deposit.maximumToken0, "10000000");
  assert.equal(Object.hasOwn(deposit, "amountIn"), false);

  const wrongProgram = take(createDexEventLog(), solAllow(), solSwap({
    programId: "1".repeat(32),
    signature: `${"3".repeat(87)}2`,
  }));
  assert.equal(wrongProgram.status, "unavailable");
  assert.equal(wrongProgram.reason, "unverified");

  const initializeEvent = solSwap({
    kind: "Initialize",
    signature: `${"4".repeat(87)}2`,
  });
  delete initializeEvent.amountIn;
  delete initializeEvent.minimumAmountOut;
  const created = take(createDexEventLog(), solAllow(), initializeEvent);
  assert.equal(created.kind, "Initialize");
  assert.equal(created.status, "unavailable");
  assert.equal(created.reason, "unverified");

  const listed = createDexEventLog();
  noteCanonicalChain(listed, { chain: "Solana", slots: [1] });
  const absent = take(listed, solAllow(), solSwap({ slot: 42, signature: `${"5".repeat(87)}2` }));
  assert.equal(absent.reason, "reorg");
  assert.equal(absent.status, "unavailable");
});

test("unsupported pools, unverified events, and duplicates stay unavailable", () => {
  const unsupportedLog = createDexEventLog();
  const unsupported = take(unsupportedLog, [], evmSwap());
  assert.equal(unsupported.status, "unavailable");
  assert.equal(unsupported.reason, "unsupported pool");
  noteCanonicalChain(unsupportedLog, { chain: "Ethereum", blockHashes: [BLOCK_HASH] });
  assert.equal(readDexPoolEvents(unsupportedLog).events[0].reason, "unsupported pool");

  const otherPool = take(createDexEventLog(), evmAllow(), evmSwap({
    pool: "0x0000000000000000000000000000000000000002",
    logIndex: 8,
  }));
  assert.equal(otherPool.reason, "unsupported pool");

  const priced = take(createDexEventLog(), evmAllow(), evmSwap({ price: "0.001", logIndex: 6 }));
  assert.equal(priced.status, "unavailable");
  assert.equal(priced.reason, "unverified");
  assert.equal(Object.hasOwn(priced, "price"), false);
  assert.equal(JSON.stringify(priced).includes("0.001"), false);

  const v2 = take(createDexEventLog(), evmAllow(), evmSwap({ source: "Uniswap v2" }));
  assert.equal(v2.source, "Uniswap v2");
  assert.equal(v2.status, "unavailable");
  assert.equal(v2.reason, "unverified");

  const v4 = take(createDexEventLog(), evmAllow(), evmSwap({ source: "Uniswap v4" }));
  assert.equal(v4.reason, "unverified");

  const flash = take(createDexEventLog(), evmAllow(), evmSwap({ kind: "Flash", logIndex: 7 }));
  assert.equal(flash.kind, "Flash");
  assert.equal(flash.reason, "unverified");

  const dupLog = createDexEventLog();
  const first = take(dupLog, evmAllow(), evmSwap());
  const second = take(dupLog, evmAllow(), evmSwap({ amount0: "-5", amount1: "6" }));
  assert.equal(second.reason, "duplicate");
  assert.equal(second.status, "unavailable");
  noteCanonicalChain(dupLog, { chain: "Ethereum", blockHashes: [BLOCK_HASH] });
  const rows = readDexPoolEvents(dupLog).events;
  assert.equal(rows.length, 2);
  assert.equal(rows[0].id, first.id);
  assert.equal(rows[0].finality, "canonical");
  assert.equal(rows[0].amount0, "-1000");
  assert.equal(rows[1].reason, "duplicate");
  assert.equal(rows[1].amount0, "-5");

  const solDup = createDexEventLog();
  take(solDup, solAllow(), solSwap());
  const again = take(solDup, solAllow(), solSwap({ amountIn: "2" }));
  assert.equal(again.reason, "duplicate");
  assert.equal(readDexPoolEvents(solDup).events[0].amountIn, "10000000");
});

test("the dex catalog is the two selected sources and paper mode stays locked", () => {
  assert.equal(DEX_SOURCES.length, 2);
  assert.equal(DEX_SOURCES[0].source, "Uniswap v3");
  assert.equal(DEX_SOURCES[0].chain, "Ethereum");
  assert.deepEqual([...DEX_SOURCES[0].poolEvents], ["Swap", "Mint", "Burn"]);
  assert.equal(DEX_SOURCES[1].source, "Raydium");
  assert.equal(DEX_SOURCES[1].chain, "Solana");
  assert.equal(DEX_SOURCES[1].programId, RAYDIUM_CPMM_PROGRAM_ID);
  assert.equal(DEX_SOURCES[0].checkedAt, "2026-10-06");
  assert.equal(DEX_SOURCES[1].checkedAt, "2026-10-06");
  assert.equal(WRAPPED_SOL_DECIMALS, 9);
  assert.equal(WRAPPED_SOL_RAW_EXAMPLE, "10000000");
  for (const name of ["placeOrder", "fill", "submit"]) {
    assert.equal(Object.hasOwn(dex, name), false);
  }
  assert.equal(health.liveTrading, "OFF");
  assert.equal(health.liveOrdersLocked, true);
});
