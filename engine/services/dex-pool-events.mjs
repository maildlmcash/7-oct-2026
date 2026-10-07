// Pool swap and liquidity events for one EVM source and one Solana source.
// Uniswap v3 pool events are Swap, Mint, and Burn from IUniswapV3PoolEvents.
// Raydium CPMM instructions are SwapBaseInput, SwapBaseOutput, Deposit, and Withdraw.
// The Graph subgraph overview is not a live execution feed and is not queried.
// No Ethereum confirmation count is named in source. Finality is canonical block-hash inclusion.
// Solana log subscriptions name processed, confirmed, and finalized. Only confirmed and finalized are available.
// Amounts stay integer strings. Decimals are not applied. No socket is opened and no order is placed.

const ADDRESS = /^0x[0-9a-fA-F]{40}$/;
const BLOCK_HASH = /^0x[0-9a-fA-F]{64}$/;
const BASE58 = /^[1-9A-HJ-NP-Za-km-z]+$/;
const SIGNED = /^(?:0|-?[1-9]\d*)$/;
const UNSIGNED = /^(?:0|[1-9]\d*)$/;

const EVM_KEYS = Object.freeze([
  "source",
  "chain",
  "kind",
  "pool",
  "blockNumber",
  "blockHash",
  "transactionIndex",
  "logIndex",
  "token0Decimals",
  "token1Decimals",
  "amount0",
  "amount1",
]);

const SOL_COMMON_KEYS = Object.freeze([
  "source",
  "chain",
  "kind",
  "programId",
  "pool",
  "signature",
  "slot",
  "commitment",
  "token0Mint",
  "token1Mint",
  "token0Decimals",
  "token1Decimals",
]);

const SOL_AMOUNT_KEYS = Object.freeze({
  SwapBaseInput: Object.freeze(["amountIn", "minimumAmountOut"]),
  SwapBaseOutput: Object.freeze(["maximumAmountIn", "amountOut"]),
  Deposit: Object.freeze(["lpTokenAmount", "maximumToken0", "maximumToken1"]),
  Withdraw: Object.freeze(["lpTokenAmount", "minimumToken0", "minimumToken1"]),
});

const EVM_ALLOW_KEYS = Object.freeze(["chain", "pool", "token0Decimals", "token1Decimals"]);
const SOL_ALLOW_KEYS = Object.freeze([
  "chain",
  "pool",
  "token0Mint",
  "token1Mint",
  "token0Decimals",
  "token1Decimals",
]);

export const UNISWAP_V3_POOL_EVENTS = Object.freeze(["Swap", "Mint", "Burn"]);
export const RAYDIUM_CPMM_PROGRAM_ID = "CPMMoo8L3F4NbTegBCKVNunggL7H1ZpdTHKxQB5qKP1C";
export const RAYDIUM_CPMM_POOL_EVENTS = Object.freeze([
  "SwapBaseInput",
  "SwapBaseOutput",
  "Deposit",
  "Withdraw",
]);
export const WRAPPED_SOL_MINT = "So11111111111111111111111111111111111111112";
export const WRAPPED_SOL_DECIMALS = 9;
// Raydium CLI comment: AMOUNT_RAW 10000000 is 0.01 SOL. The human amount is not stored.
export const WRAPPED_SOL_RAW_EXAMPLE = "10000000";

export const DEX_SOURCES = Object.freeze([
  Object.freeze({
    source: "Uniswap v3",
    chain: "Ethereum",
    kind: "evm",
    docsUrl: "https://developers.uniswap.org/docs/ecosystem/subgraphs/overview",
    eventsInterface: "https://github.com/Uniswap/v3-core/blob/main/contracts/interfaces/pool/IUniswapV3PoolEvents.sol",
    checkedAt: "2026-10-06",
    poolEvents: UNISWAP_V3_POOL_EVENTS,
  }),
  Object.freeze({
    source: "Raydium",
    chain: "Solana",
    kind: "solana",
    program: "CPMM",
    programId: RAYDIUM_CPMM_PROGRAM_ID,
    docsUrl: "https://docs.raydium.io/reference/program-addresses",
    instructionsUrl: "https://docs.raydium.io/products/cpmm/instructions",
    checkedAt: "2026-10-06",
    poolEvents: RAYDIUM_CPMM_POOL_EVENTS,
  }),
]);

function fail(error) {
  return { ok: false, blocked: "BLOCKED", error };
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

function safeIndex(value) {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function pubkey(value, min, max) {
  return typeof value === "string" && value.length >= min && value.length <= max && BASE58.test(value);
}

function publish(row) {
  const copy = {};
  for (const key of Object.keys(row)) {
    if (key === "admitted") continue;
    copy[key] = row[key];
  }
  return Object.freeze(copy);
}

function stored(log, row) {
  log.rows.push(row);
  return { ok: true, blocked: null, event: publish(row) };
}

function mark(row, reason) {
  row.admitted = false;
  row.status = "unavailable";
  row.reason = reason;
  row.finality = null;
}

function store(log) {
  if (!log || !Array.isArray(log.rows) || typeof log.nextId !== "number") return null;
  if (!plainObject(log.canonical)) return null;
  if (!Object.hasOwn(log.canonical, "Ethereum") || !Object.hasOwn(log.canonical, "Solana")) return null;
  return log;
}

function blank(id) {
  return {
    id,
    admitted: false,
    status: "unavailable",
    reason: "unverified",
    finality: null,
  };
}

function copyLabel(row, event) {
  if (typeof event.source === "string" && event.source.length > 0 && event.source.length <= 80) {
    row.source = event.source;
  }
  if (event.chain === "Ethereum" || event.chain === "Solana") row.chain = event.chain;
  if (typeof event.kind === "string" && event.kind.length > 0 && event.kind.length <= 80) {
    row.kind = event.kind;
  }
}

function signedAmount(value) {
  return typeof value === "string" && SIGNED.test(value);
}

function unsignedAmount(value) {
  return typeof value === "string" && UNSIGNED.test(value);
}

function fillEvm(row, event) {
  copyLabel(row, event);
  if (typeof event.pool === "string" && ADDRESS.test(event.pool)) row.pool = event.pool;
  if (safeIndex(event.blockNumber)) row.blockNumber = event.blockNumber;
  if (typeof event.blockHash === "string" && BLOCK_HASH.test(event.blockHash)) row.blockHash = event.blockHash;
  if (safeIndex(event.transactionIndex)) row.transactionIndex = event.transactionIndex;
  if (safeIndex(event.logIndex)) row.logIndex = event.logIndex;
  if (safeIndex(event.token0Decimals)) row.token0Decimals = event.token0Decimals;
  if (safeIndex(event.token1Decimals)) row.token1Decimals = event.token1Decimals;
  const unsignedKind = event.kind === "Mint" || event.kind === "Burn";
  const amountOk = unsignedKind ? unsignedAmount : signedAmount;
  if (amountOk(event.amount0)) row.amount0 = event.amount0;
  if (amountOk(event.amount1)) row.amount1 = event.amount1;
}

function solAmountKeys(kind) {
  return SOL_AMOUNT_KEYS[kind] || [];
}

function fillSol(row, event) {
  copyLabel(row, event);
  if (pubkey(event.programId, 32, 44)) row.programId = event.programId;
  if (pubkey(event.pool, 32, 44)) row.pool = event.pool;
  if (pubkey(event.signature, 64, 88)) row.signature = event.signature;
  if (safeIndex(event.slot)) row.slot = event.slot;
  if (event.commitment === "processed" || event.commitment === "confirmed" || event.commitment === "finalized") {
    row.commitment = event.commitment;
  }
  if (pubkey(event.token0Mint, 32, 44)) row.token0Mint = event.token0Mint;
  if (pubkey(event.token1Mint, 32, 44)) row.token1Mint = event.token1Mint;
  if (safeIndex(event.token0Decimals)) row.token0Decimals = event.token0Decimals;
  if (safeIndex(event.token1Decimals)) row.token1Decimals = event.token1Decimals;
  for (const key of solAmountKeys(event.kind)) {
    if (unsignedAmount(event[key])) row[key] = event[key];
  }
}

function evmProvenance(row) {
  return row.source === "Uniswap v3"
    && row.chain === "Ethereum"
    && typeof row.pool === "string"
    && safeIndex(row.blockNumber)
    && typeof row.blockHash === "string"
    && safeIndex(row.transactionIndex)
    && safeIndex(row.logIndex);
}

function solProvenance(row) {
  return row.source === "Raydium"
    && row.chain === "Solana"
    && row.programId === RAYDIUM_CPMM_PROGRAM_ID
    && typeof row.pool === "string"
    && typeof row.signature === "string"
    && safeIndex(row.slot)
    && typeof row.commitment === "string"
    && typeof row.token0Mint === "string"
    && typeof row.token1Mint === "string";
}

function amountsReady(row, event) {
  if (row.chain === "Ethereum") {
    if (event.kind === "Swap") return signedAmount(event.amount0) && signedAmount(event.amount1);
    if (event.kind === "Mint" || event.kind === "Burn") {
      return unsignedAmount(event.amount0) && unsignedAmount(event.amount1);
    }
    return false;
  }
  const keys = solAmountKeys(event.kind);
  if (keys.length === 0) return false;
  return keys.every((key) => unsignedAmount(event[key]));
}

function evmIdentity(row) {
  return `${row.blockHash.toLowerCase()}:${row.transactionIndex}:${row.logIndex}`;
}

function duplicate(log, row) {
  if (row.chain === "Ethereum" && typeof row.blockHash === "string") {
    const id = evmIdentity(row);
    return log.rows.some((prev) => prev.chain === "Ethereum" && typeof prev.blockHash === "string" && evmIdentity(prev) === id);
  }
  if (row.chain === "Solana" && typeof row.signature === "string") {
    return log.rows.some((prev) => prev.chain === "Solana" && prev.signature === row.signature);
  }
  return false;
}

function allowEntry(entry, row) {
  if (!plainObject(entry) || entry.chain !== row.chain) return false;
  if (row.chain === "Ethereum") {
    if (unknownKey(entry, EVM_ALLOW_KEYS)) return false;
    if (typeof entry.pool !== "string" || !ADDRESS.test(entry.pool)) return false;
    if (!safeIndex(entry.token0Decimals) || !safeIndex(entry.token1Decimals)) return false;
    return entry.pool.toLowerCase() === row.pool.toLowerCase();
  }
  if (unknownKey(entry, SOL_ALLOW_KEYS)) return false;
  if (!pubkey(entry.pool, 32, 44) || entry.pool !== row.pool) return false;
  if (!pubkey(entry.token0Mint, 32, 44) || !pubkey(entry.token1Mint, 32, 44)) return false;
  if (!safeIndex(entry.token0Decimals) || !safeIndex(entry.token1Decimals)) return false;
  return true;
}

function findAllow(allowlist, row) {
  if (!Array.isArray(allowlist)) return null;
  for (const entry of allowlist) {
    if (allowEntry(entry, row)) return entry;
  }
  return null;
}

function documentedMintDecimals(mint, decimals) {
  if (mint === WRAPPED_SOL_MINT) return decimals === WRAPPED_SOL_DECIMALS;
  return true;
}

function decimalsMatch(row, entry) {
  if (row.token0Decimals !== entry.token0Decimals || row.token1Decimals !== entry.token1Decimals) return false;
  if (row.chain !== "Solana") return true;
  if (row.token0Mint !== entry.token0Mint || row.token1Mint !== entry.token1Mint) return false;
  return documentedMintDecimals(row.token0Mint, row.token0Decimals)
    && documentedMintDecimals(row.token1Mint, row.token1Decimals);
}

function applyEvm(row, hashes) {
  // Admitted rows stay revisable. A missing head is unverified, not a reorg.
  row.admitted = true;
  if (!Array.isArray(hashes)) {
    row.status = "unavailable";
    row.reason = "unverified";
    row.finality = null;
    return;
  }
  const present = hashes.some((hash) => hash.toLowerCase() === row.blockHash.toLowerCase());
  if (present) {
    row.status = "available";
    row.reason = null;
    row.finality = "canonical";
    return;
  }
  row.status = "unavailable";
  row.reason = "reorg";
  row.finality = null;
}

function applySol(row, slots) {
  if (!Array.isArray(slots)) {
    row.admitted = true;
    row.status = "available";
    row.reason = null;
    row.finality = row.commitment;
    return;
  }
  if (slots.includes(row.slot)) {
    row.admitted = true;
    row.status = "available";
    row.reason = null;
    row.finality = row.commitment;
    return;
  }
  mark(row, "reorg");
  row.admitted = true;
}

function revise(log, chain) {
  for (const row of log.rows) {
    if (!row.admitted || row.chain !== chain) continue;
    if (chain === "Ethereum") applyEvm(row, log.canonical.Ethereum);
    if (chain === "Solana") applySol(row, log.canonical.Solana);
  }
}

export function createDexEventLog() {
  return {
    nextId: 1,
    rows: [],
    canonical: { Ethereum: null, Solana: null },
  };
}

export function ingestDexPoolEvent(log, input) {
  const target = store(log);
  if (!target) return fail("dex event log is required");
  const row = blank(`dex-${target.nextId}`);
  target.nextId += 1;
  if (!plainObject(input) || unknownKey(input, ["allowlist", "event"]) || !plainObject(input.event)) {
    return stored(target, row);
  }
  const event = input.event;
  const evm = event.source === "Uniswap v3" && event.chain === "Ethereum";
  const solana = event.source === "Raydium" && event.chain === "Solana";
  if (!evm && !solana) {
    copyLabel(row, event);
    return stored(target, row);
  }
  if (evm) fillEvm(row, event);
  else fillSol(row, event);
  const allowed = evm ? EVM_KEYS : SOL_COMMON_KEYS.concat(solAmountKeys(event.kind));
  if (unknownKey(event, allowed) || !((evm && evmProvenance(row)) || (solana && solProvenance(row)))) {
    mark(row, "unverified");
    return stored(target, row);
  }
  const poolKind = evm ? UNISWAP_V3_POOL_EVENTS.includes(event.kind) : RAYDIUM_CPMM_POOL_EVENTS.includes(event.kind);
  if (!poolKind || !amountsReady(row, event)) {
    mark(row, "unverified");
    return stored(target, row);
  }
  if (duplicate(target, row)) {
    mark(row, "duplicate");
    return stored(target, row);
  }
  const entry = findAllow(input.allowlist, row);
  if (!entry) {
    mark(row, "unsupported pool");
    return stored(target, row);
  }
  if (!decimalsMatch(row, entry)) {
    mark(row, "token decimals");
    return stored(target, row);
  }
  if (solana && event.commitment !== "confirmed" && event.commitment !== "finalized") {
    mark(row, "unverified");
    return stored(target, row);
  }
  if (evm) applyEvm(row, target.canonical.Ethereum);
  else applySol(row, target.canonical.Solana);
  return stored(target, row);
}

export function noteCanonicalChain(log, note) {
  const target = store(log);
  if (!target || !plainObject(note)) return fail("canonical chain is not configured");
  if (note.chain === "Ethereum") {
    if (unknownKey(note, ["chain", "blockHashes"]) || !Array.isArray(note.blockHashes)) {
      return fail("canonical chain is not configured");
    }
    if (note.blockHashes.some((hash) => typeof hash !== "string" || !BLOCK_HASH.test(hash))) {
      return fail("canonical chain is not configured");
    }
    target.canonical.Ethereum = note.blockHashes.slice();
    revise(target, "Ethereum");
    return { ok: true, blocked: null };
  }
  if (note.chain === "Solana") {
    if (unknownKey(note, ["chain", "slots"]) || !Array.isArray(note.slots)) {
      return fail("canonical chain is not configured");
    }
    if (note.slots.some((slot) => !safeIndex(slot))) return fail("canonical chain is not configured");
    target.canonical.Solana = note.slots.slice();
    revise(target, "Solana");
    return { ok: true, blocked: null };
  }
  return fail("canonical chain is not configured");
}

export function readDexPoolEvents(log) {
  const target = store(log);
  if (!target) return fail("dex event log is required");
  return { ok: true, blocked: null, events: Object.freeze(target.rows.map(publish)) };
}
