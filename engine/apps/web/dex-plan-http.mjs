import { DEX_SCORE_PLAN, DEX_VENUES, dexScore } from "../../services/dex-plan.mjs";
import { DEXSCREENER_PIPELINE, DEXSCREENER_PREDICTION, readDexScreener } from "../../services/dexscreener.mjs";

const CURVE_URL = "https://api.curve.fi/api/getPools/ethereum/main";
const WETH = "0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2";
const WBTC = "0x2260fac5e5542a773aa44fbcfedf7c193bc2c599";

function line(field, value, meaning) {
  return { field, value: value == null ? "null" : String(value), meaning };
}

function flatten(value, prefix, rows) {
  if (Array.isArray(value)) {
    if (value.length === 0) rows.push(line(prefix, "[]", "Empty list"));
    value.forEach((item, index) => flatten(item, `${prefix}[${index}]`, rows));
    return;
  }
  if (value && typeof value === "object") {
    const keys = Object.keys(value);
    if (keys.length === 0) rows.push(line(prefix, "{}", "Empty object"));
    keys.forEach((key) => flatten(value[key], prefix ? `${prefix}.${key}` : key, rows));
    return;
  }
  rows.push(line(prefix || "value", value, prefix || "value"));
}

function volumeOf(attributes) {
  const volume = attributes?.volume_usd;
  if (volume && typeof volume === "object") return volume.h24 ?? volume.m5 ?? 0;
  return attributes?.volume_usd ?? 0;
}

function geckoPools(body) {
  return (body?.data ?? []).map((pool) => {
    const attributes = pool.attributes ?? {};
    const liquidity = Number(attributes.reserve_in_usd);
    const score = dexScore(liquidity, volumeOf(attributes));
    return {
      id: String(pool.id ?? attributes.address),
      name: String(attributes.name ?? pool.id),
      liquidity,
      score,
      raw: pool,
    };
  });
}

function curvePools(body) {
  const pools = body?.data?.poolData ?? [];
  return pools.map((pool) => {
    const score = dexScore(pool.usdTotal, 0);
    return { id: String(pool.address), name: String(pool.name ?? pool.symbol ?? pool.address), liquidity: Number(pool.usdTotal), score, raw: pool };
  }).sort((a, b) => b.liquidity - a.liquidity).slice(0, 20);
}

const cache = new Map();

async function getJson(url) {
  const hit = cache.get(url);
  if (hit && Date.now() - hit.at < 180_000) return hit.value;
  const load = async () => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 12_000);
    try {
      const upstream = await fetch(url, { headers: { accept: "application/json", "user-agent": "desk" }, cache: "no-store", signal: controller.signal, redirect: "follow" });
      if (upstream.status === 429) return { ok: false, error: "HTTP 429", retry: true };
      if (!upstream.ok) return { ok: false, error: `HTTP ${upstream.status}` };
      return { ok: true, body: await upstream.json() };
    } catch {
      return { ok: false, error: "This DEX API is not connected." };
    } finally {
      clearTimeout(timeout);
    }
  };
  let result = await load();
  if (result.retry) {
    await new Promise((resolve) => setTimeout(resolve, 2_000));
    result = await load();
  }
  if (result.ok) cache.set(url, { at: Date.now(), value: result });
  return result;
}

async function postJson(url, payload) {
  const key = `${url} ${JSON.stringify(payload)}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < 180_000) return hit.value;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12_000);
  try {
    const upstream = await fetch(url, {
      method: "POST",
      headers: { accept: "application/json", "content-type": "application/json", "user-agent": "desk" },
      body: JSON.stringify(payload),
      cache: "no-store",
      signal: controller.signal,
    });
    if (!upstream.ok) return { ok: false, error: `HTTP ${upstream.status}` };
    const result = { ok: true, body: await upstream.json() };
    cache.set(key, { at: Date.now(), value: result });
    return result;
  } catch {
    return { ok: false, error: "This DEX API is not connected." };
  } finally {
    clearTimeout(timeout);
  }
}

const ARB_RPC = "https://arb1.arbitrum.io/rpc";
const DODO_FACTORIES = [
  ["DVM", "0xDa4c4411c55B0785e501332354A036c04833B72b", "0xaf5c5f12a80fc937520df6fcaed66262a4cc775e0f3fceaf7a7cfe476d9a751d"],
  ["DSP", "0xC8fE2440744dcd733246a4dB14093664DEFD5A53", "0xbc1083a2c1c5ef31e13fb436953d22b47880cf7db279c2c5666b16083afd6b9d"],
  ["DPP", "0xa6Cf3d163358aF376ec5e8B7Cc5e102a05FdE63D", "0x8494fe594cd5087021d4b11758a2bbc7be28a430e94f2b268d668e5991ed3b8a"],
];
const DODO_STABLES = {
  "0xfd086bc7cd5c481dcc9c85ebe478a1c0b69fcbb9": 6,
  "0xff970a61a04b1ca14834a43f5de4533ebddb5cc8": 6,
  "0xaf88d065e77c8cc2239327c5edb3a432268e5831": 6,
  "0xda10009cbd5d07dd0cecc66161fc93d7c9000da1": 18,
};
const DODO_QUOTED = {
  "0x82af49447d8a07e3bd95bd0d56f35241523fbab1": ["ETHUSDT", 18],
  "0x2f2a2543b76a4166549f7aab2e75bef0aefc5b0f": ["BTCUSDT", 8],
};
let dodoPoolCache = { at: 0, pools: null };

function decodeText(raw) {
  if (!raw || raw === "0x") return "";
  const hex = raw.slice(2);
  if (hex.length <= 64) return Buffer.from(hex, "hex").toString("utf8").replaceAll("\u0000", "").trim();
  const length = Number(BigInt(`0x${hex.slice(64, 128)}`));
  return Buffer.from(hex.slice(128, 128 + length * 2), "hex").toString("utf8").trim();
}

function human(raw, decimals) {
  const base = 10n ** BigInt(decimals);
  const whole = raw / base;
  if (whole > 1_000_000_000n) return 0;
  return Number(whole) + Number(raw % base) / Number(base);
}

async function arbCall(payload) {
  const load = async () => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 20_000);
    try {
      const upstream = await fetch(ARB_RPC, { method: "POST", headers: { "content-type": "application/json", "user-agent": "desk" }, body: JSON.stringify(payload), signal: controller.signal });
      if (upstream.status === 429) return { ok: false, error: "HTTP 429" };
      if (!upstream.ok) return { ok: false, error: `HTTP ${upstream.status}` };
      return { ok: true, body: await upstream.json() };
    } catch {
      return { ok: false, error: "This DEX API is not connected." };
    } finally {
      clearTimeout(timeout);
    }
  };
  let result = await load();
  if (result.error === "HTTP 429") {
    await new Promise((resolve) => setTimeout(resolve, 1_200));
    result = await load();
  }
  return result;
}

async function dodoPools() {
  if (dodoPoolCache.pools && Date.now() - dodoPoolCache.at < 180_000) return dodoPoolCache.pools;
  const head = await arbCall({ jsonrpc: "2.0", id: 1, method: "eth_blockNumber", params: [] });
  if (!head.ok || !head.body?.result) return { ok: false, error: head.error ?? "This DEX API is not connected." };
  const latest = BigInt(head.body.result);
  const windows = [[0n, 9_999_999n], [latest > 9_999_999n ? latest - 9_999_999n : 0n, latest]];
  const found = [];
  for (const [kind, address, topic] of DODO_FACTORIES) {
    for (const [fromBlock, toBlock] of windows) {
      const logs = await arbCall({ jsonrpc: "2.0", id: 1, method: "eth_getLogs", params: [{ fromBlock: `0x${fromBlock.toString(16)}`, toBlock: `0x${toBlock.toString(16)}`, address, topics: [topic] }] });
      if (!logs.ok || !Array.isArray(logs.body?.result)) return { ok: false, error: logs.error ?? "This DEX API is not connected." };
      for (const log of logs.body.result) {
        const hex = String(log.data ?? "").slice(2);
        const parts = [];
        for (let index = 0; index < hex.length; index += 64) parts.push(`0x${hex.slice(index + 24, index + 64)}`);
        if (parts.length < 4 || parts[3].length !== 42) continue;
        found.push({ kind, pool: parts[3], base: parts[0], quote: parts[1] });
      }
    }
  }
  const unique = [...new Map(found.map((pool) => [pool.pool, pool])).values()];
  for (let start = 0; start < unique.length; start += 20) {
    const chunk = unique.slice(start, start + 20);
    const batch = await arbCall(chunk.map((pool, index) => ({ jsonrpc: "2.0", id: index, method: "eth_call", params: [{ to: pool.pool, data: "0x36223ce9" }, "latest"] })));
    if (!batch.ok || !Array.isArray(batch.body)) return { ok: false, error: batch.error ?? "This DEX API is not connected." };
    const byId = new Map(batch.body.map((item) => [item.id, item.result]));
    chunk.forEach((pool, index) => {
      const raw = String(byId.get(index) ?? "0x");
      pool.baseReserve = raw.length >= 130 ? BigInt(`0x${raw.slice(2, 66)}`) : 0n;
      pool.quoteReserve = raw.length >= 130 ? BigInt(`0x${raw.slice(66, 130)}`) : 0n;
    });
  }
  const quotes = {};
  for (const [symbol] of Object.values(DODO_QUOTED)) {
    const ticker = await getJson(`https://data-api.binance.vision/api/v3/ticker/price?symbol=${symbol}`);
    quotes[symbol] = ticker.ok && ticker.body?.symbol === symbol ? Number(ticker.body.price) : null;
  }
  const tokens = [...new Set(unique.flatMap((pool) => [pool.base, pool.quote]))];
  const symbols = {};
  for (let start = 0; start < tokens.length; start += 20) {
    const chunk = tokens.slice(start, start + 20);
    const batch = await arbCall(chunk.map((token, index) => ({ jsonrpc: "2.0", id: index, method: "eth_call", params: [{ to: token, data: "0x95d89b41" }, "latest"] })));
    if (!batch.ok || !Array.isArray(batch.body)) continue;
    for (const item of batch.body) symbols[chunk[item.id]] = decodeText(item.result);
  }
  const side = (address, raw) => {
    if (DODO_STABLES[address] != null) return human(raw, DODO_STABLES[address]);
    const quoted = DODO_QUOTED[address];
    if (!quoted || !Number.isFinite(quotes[quoted[0]])) return 0;
    return human(raw, quoted[1]) * quotes[quoted[0]];
  };
  const pools = unique.map((pool) => {
    const liquidity = side(pool.base, pool.baseReserve) + side(pool.quote, pool.quoteReserve);
    const name = `${pool.kind} ${symbols[pool.base] || pool.base.slice(0, 6)}/${symbols[pool.quote] || pool.quote.slice(0, 6)}`;
    return {
      id: pool.pool,
      name,
      liquidity,
      score: dexScore(liquidity, 0),
      raw: { kind: pool.kind, pool: pool.pool, base: pool.base, baseSymbol: symbols[pool.base] ?? "", baseReserve: pool.baseReserve.toString(), quote: pool.quote, quoteSymbol: symbols[pool.quote] ?? "", quoteReserve: pool.quoteReserve.toString(), liquidityUsd: liquidity },
    };
  }).filter((pool) => pool.liquidity > 0).sort((a, b) => b.liquidity - a.liquidity).slice(0, 20);
  if (pools.length === 0) return { ok: false, error: "DODO V2 returned no priced pools." };
  dodoPoolCache = { at: Date.now(), pools };
  return pools;
}

async function dodoPlan(venue, params) {
  const pools = await dodoPools();
  if (!Array.isArray(pools)) return Response.json({ ok: false, error: pools.error, venue: venue.id }, { status: 502 });
  const selected = pools.find((pool) => pool.id === params.get("pool")) ?? pools[0];
  const rows = [];
  flatten(selected.raw, "", rows);
  let cex = null;
  if (params.get("cex") === "1") {
    const raw = selected.raw;
    const baseQuoted = DODO_QUOTED[raw.base];
    const quoteQuoted = DODO_QUOTED[raw.quote];
    const priced = baseQuoted ? raw.base : quoteQuoted ? raw.quote : null;
    const other = priced === raw.base ? raw.quote : raw.base;
    const quotedAmount = priced ? human(BigInt(priced === raw.base ? raw.baseReserve : raw.quoteReserve), DODO_QUOTED[priced][1]) : 0;
    const stableAmount = priced && DODO_STABLES[other] != null ? human(BigInt(priced === raw.base ? raw.quoteReserve : raw.baseReserve), DODO_STABLES[other]) : 0;
    if (!priced || quotedAmount <= 0 || stableAmount <= 0) cex = { ok: false, error: "No ETH or BTC price is on this pool, so it is not compared with a CEX." };
    else {
      const symbol = DODO_QUOTED[priced][0];
      const book = await getJson(`https://data-api.binance.vision/api/v3/ticker/bookTicker?symbol=${symbol}`);
      const bid = Number(book.body?.bidPrice);
      const ask = Number(book.body?.askPrice);
      if (!book.ok || book.body?.symbol !== symbol || !Number.isFinite(bid) || !Number.isFinite(ask)) cex = { ok: false, error: "Binance mid is not connected." };
      else {
        const mid = (bid + ask) / 2;
        const price = stableAmount / quotedAmount;
        const gapPct = ((price - mid) / mid) * 100;
        cex = { ok: true, asset: symbol === "ETHUSDT" ? "ETH" : "BTC", symbol, dexPrice: price, cexMid: mid, gapPct, flag: Math.abs(gapPct) > 2 ? "Disagreement over 2%. Not an order." : "Gap is within 2%. Not an order." };
      }
    }
  }
  return Response.json({
    ok: true,
    venue: venue.id,
    name: venue.name,
    conditions: venue.conditions,
    uses: venue.uses,
    scorePlan: DEX_SCORE_PLAN,
    pools: pools.map((pool) => ({ id: pool.id, name: pool.name, liquidity: pool.liquidity, score: pool.score.score, liquidityPoints: pool.score.liquidityPoints, activityPoints: pool.score.activityPoints, weight: pool.score.weight, use: pool.score.use })),
    selected: { id: selected.id, name: selected.name, ...selected.score },
    rows,
    cex,
  });
}

function assetOf(name, raw) {
  const text = `${name} ${JSON.stringify(raw?.coinsAddresses ?? "")}`.toLowerCase();
  if (text.includes(WBTC) || /\bwbtc\b|\btbtc\b/.test(text)) return { asset: "BTC", symbol: "BTCUSDT" };
  if (text.includes(WETH) || /\bweth\b|\beth\b/.test(text)) return { asset: "ETH", symbol: "ETHUSDT" };
  return null;
}

function dexPrice(raw, name) {
  const attributes = raw?.attributes;
  if (attributes) {
    const [base, quote] = String(name).split("/").map((part) => part.trim().toUpperCase());
    if (quote === "WETH" || quote === "ETH" || quote === "WBTC" || quote === "BTC") return Number(attributes.quote_token_price_usd);
    if (base === "WETH" || base === "ETH" || base === "WBTC" || base === "BTC") return Number(attributes.base_token_price_usd);
    return null;
  }
  const coins = raw?.coins;
  if (Array.isArray(coins)) {
    const coin = coins.find((item) => String(item.address ?? "").toLowerCase() === WETH || String(item.address ?? "").toLowerCase() === WBTC);
    if (coin?.usdPrice != null) return Number(coin.usdPrice);
  }
  return null;
}

export async function getDexPlan(request) {
  const params = new URL(request.url).searchParams;
  const venue = DEX_VENUES.find((item) => item.id === params.get("venue"));
  if (!venue) return Response.json({ ok: false, error: "This DEX is not on the list." }, { status: 400 });
  if (venue.source === "dydx-v3") {
    const loaded = await getJson("https://indexer.dydx.trade/v4/perpetualMarkets");
    const markets = loaded.body?.markets;
    if (!loaded.ok || !markets || markets["BTC-USD"]?.ticker !== "BTC-USD") {
      return Response.json({ ok: false, error: "The dYdX v3 host is closed, and the dYdX Chain indexer is not connected.", venue: venue.id }, { status: 502 });
    }
    const pools = Object.values(markets).map((market) => {
      const price = Number(market.oraclePrice);
      const openInterest = Number(market.openInterest);
      const liquidity = Number.isFinite(price) && Number.isFinite(openInterest) ? price * openInterest : 0;
      return { id: String(market.ticker), name: String(market.ticker), liquidity, score: dexScore(liquidity, market.volume24H), raw: market };
    });
    const selected = pools.find((pool) => pool.id === (params.get("pool") || "BTC-USD")) ?? pools[0];
    const book = await getJson(`https://indexer.dydx.trade/v4/orderbooks/perpetualMarket/${selected.id}`);
    const rows = [];
    flatten({ market: selected.raw, orderbook: book.ok ? book.body : { error: "Order book is not connected." } }, "", rows);
    let cex = null;
    if (params.get("cex") === "1") {
      const symbol = selected.id === "BTC-USD" ? "BTCUSDT" : selected.id === "ETH-USD" ? "ETHUSDT" : null;
      const price = Number(selected.raw.oraclePrice);
      if (!symbol || !Number.isFinite(price)) cex = { ok: false, error: "No ETH or BTC price is on this market, so it is not compared with a CEX." };
      else {
        const ticker = await getJson(`https://data-api.binance.vision/api/v3/ticker/bookTicker?symbol=${symbol}`);
        const bid = Number(ticker.body?.bidPrice);
        const ask = Number(ticker.body?.askPrice);
        if (!ticker.ok || ticker.body?.symbol !== symbol || !Number.isFinite(bid) || !Number.isFinite(ask)) cex = { ok: false, error: "Binance mid is not connected." };
        else {
          const mid = (bid + ask) / 2;
          const gapPct = ((price - mid) / mid) * 100;
          cex = { ok: true, asset: selected.id.slice(0, 3), symbol, dexPrice: price, cexMid: mid, gapPct, flag: Math.abs(gapPct) > 2 ? "Disagreement over 2%. Not an order." : "Gap is within 2%. Not an order." };
        }
      }
    }
    return Response.json({
      ok: true,
      venue: venue.id,
      name: venue.name,
      conditions: venue.conditions,
      uses: venue.uses,
      scorePlan: DEX_SCORE_PLAN,
      pools: pools.map((pool) => ({ id: pool.id, name: pool.name, liquidity: pool.liquidity, score: pool.score.score, liquidityPoints: pool.score.liquidityPoints, activityPoints: pool.score.activityPoints, weight: pool.score.weight, use: pool.score.use })),
      selected: { id: selected.id, name: selected.name, ...selected.score },
      rows,
      cex,
    });
  }
  if (venue.source === "hyperliquid") {
    const loaded = await postJson("https://api.hyperliquid.xyz/info", { type: "metaAndAssetCtxs" });
    const universe = loaded.body?.[0]?.universe;
    const contexts = loaded.body?.[1];
    if (!loaded.ok || !Array.isArray(universe) || !Array.isArray(contexts)) {
      return Response.json({ ok: false, error: "Hyperliquid info API is not connected.", venue: venue.id }, { status: 502 });
    }
    const pools = universe.map((market, index) => {
      const ctx = contexts[index] ?? {};
      const price = Number(ctx.markPx);
      const openInterest = Number(ctx.openInterest);
      const liquidity = Number.isFinite(price) && Number.isFinite(openInterest) ? price * openInterest : 0;
      return { id: String(market.name), name: String(market.name), liquidity, score: dexScore(liquidity, ctx.dayNtlVlm), raw: { ...market, ...ctx } };
    });
    const selected = pools.find((pool) => pool.id === params.get("pool")) ?? pools[0];
    const book = await postJson("https://api.hyperliquid.xyz/info", { type: "l2Book", coin: selected.id });
    const rows = [];
    flatten({ market: selected.raw, l2Book: book.ok ? book.body : { error: "Order book is not connected." } }, "", rows);
    let cex = null;
    if (params.get("cex") === "1") {
      const symbol = selected.id === "BTC" ? "BTCUSDT" : selected.id === "ETH" ? "ETHUSDT" : null;
      const price = Number(selected.raw.midPx);
      if (!symbol || !Number.isFinite(price)) cex = { ok: false, error: "No ETH or BTC price is on this market, so it is not compared with a CEX." };
      else {
        const ticker = await getJson(`https://data-api.binance.vision/api/v3/ticker/bookTicker?symbol=${symbol}`);
        const bid = Number(ticker.body?.bidPrice);
        const ask = Number(ticker.body?.askPrice);
        if (!ticker.ok || ticker.body?.symbol !== symbol || !Number.isFinite(bid) || !Number.isFinite(ask)) cex = { ok: false, error: "Binance mid is not connected." };
        else {
          const mid = (bid + ask) / 2;
          const gapPct = ((price - mid) / mid) * 100;
          cex = { ok: true, asset: selected.id, symbol, dexPrice: price, cexMid: mid, gapPct, flag: Math.abs(gapPct) > 2 ? "Disagreement over 2%. Not an order." : "Gap is within 2%. Not an order." };
        }
      }
    }
    return Response.json({
      ok: true,
      venue: venue.id,
      name: venue.name,
      conditions: venue.conditions,
      uses: venue.uses,
      scorePlan: DEX_SCORE_PLAN,
      pools: pools.map((pool) => ({ id: pool.id, name: pool.name, liquidity: pool.liquidity, score: pool.score.score, liquidityPoints: pool.score.liquidityPoints, activityPoints: pool.score.activityPoints, weight: pool.score.weight, use: pool.score.use })),
      selected: { id: selected.id, name: selected.name, ...selected.score },
      rows,
      cex,
    });
  }
  if (venue.source === "dodo-v2") return dodoPlan(venue, params);
  if (venue.source === "dexscreener") {
    const loaded = await getJson("https://api.dexscreener.com/latest/dex/search?q=WETH%20USDC");
    const read = loaded.ok ? readDexScreener(loaded.body) : null;
    if (!read || read.pairs.length === 0) return Response.json({ ok: false, error: loaded.error ?? "DexScreener is not connected.", venue: venue.id }, { status: 502 });
    const pools = read.pairs.map((pair) => ({
      id: `${pair.chain}:${pair.pairAddress}`,
      name: `${pair.base.length > 18 ? `${pair.base.slice(0, 18)}…` : pair.base}/${pair.quote} · ${pair.chain}`,
      liquidity: pair.liquidityUsd ?? 0,
      score: { score: pair.score, liquidityPoints: pair.liquidityPoints, activityPoints: pair.activityPoints, weight: pair.weight, use: pair.use },
      priceChangeH24: pair.priceChangeH24,
      priceFlag: pair.priceFlag,
      fields: pair.fields,
    }));
    const selected = pools.find((pool) => pool.id === params.get("pool")) ?? pools[0];
    return Response.json({
      ok: true,
      venue: venue.id,
      name: venue.name,
      conditions: venue.conditions,
      uses: venue.uses,
      scorePlan: [...DEXSCREENER_PREDICTION, ...DEXSCREENER_PIPELINE],
      note: `LIVE. Imported ${read.imported} pairs from ${read.requestsUsed} request. Limit is ${read.requestsPerMinute} requests per minute.`,
      pools: pools.map((pool) => ({ id: pool.id, name: pool.name, liquidity: pool.liquidity, score: pool.score.score, liquidityPoints: pool.score.liquidityPoints, activityPoints: pool.score.activityPoints, weight: pool.score.weight, use: pool.score.use, priceChangeH24: pool.priceChangeH24, priceFlag: pool.priceFlag })),
      selected: { id: selected.id, name: selected.name, ...selected.score },
      rows: selected.fields.map((row) => ({ ...row, meaning: row.field })),
      cex: null,
    });
  }
  const loaded = venue.source === "curve"
    ? await getJson(CURVE_URL)
    : await getJson(`https://api.geckoterminal.com/api/v2/networks/${venue.network}/dexes/${venue.dexId}/pools?page=1`);
  if (!loaded.ok) return Response.json({ ok: false, error: loaded.error === "HTTP 404" ? "This DEX is not in the public pool index." : loaded.error, venue: venue.id }, { status: 502 });
  const pools = venue.source === "curve" ? curvePools(loaded.body) : geckoPools(loaded.body);
  if (pools.length === 0) return Response.json({ ok: false, error: "This DEX returned no pools.", venue: venue.id }, { status: 502 });
  const selected = pools.find((pool) => pool.id === params.get("pool")) ?? pools[0];
  const rows = [];
  flatten(selected.raw, "", rows);
  let cex = null;
  if (params.get("cex") === "1") {
    const asset = assetOf(selected.name, selected.raw);
    const price = dexPrice(selected.raw, selected.name);
    if (!asset || !Number.isFinite(price)) cex = { ok: false, error: "No ETH or BTC price is on this pool, so it is not compared with a CEX." };
    else {
      const book = await getJson(`https://data-api.binance.vision/api/v3/ticker/bookTicker?symbol=${asset.symbol}`);
      const bid = Number(book.body?.bidPrice);
      const ask = Number(book.body?.askPrice);
      if (!book.ok || book.body?.symbol !== asset.symbol || !Number.isFinite(bid) || !Number.isFinite(ask)) cex = { ok: false, error: "Binance mid is not connected." };
      else {
        const mid = (bid + ask) / 2;
        const gapPct = ((price - mid) / mid) * 100;
        cex = { ok: true, asset: asset.asset, symbol: asset.symbol, dexPrice: price, cexMid: mid, gapPct, flag: Math.abs(gapPct) > 2 ? "Disagreement over 2%. Not an order." : "Gap is within 2%. Not an order." };
      }
    }
  }
  return Response.json({
    ok: true,
    venue: venue.id,
    name: venue.name,
    conditions: venue.conditions,
    uses: venue.uses,
    scorePlan: DEX_SCORE_PLAN,
    pools: pools.map((pool) => ({
      id: pool.id,
      name: pool.name,
      liquidity: pool.liquidity,
      score: pool.score.score,
      liquidityPoints: pool.score.liquidityPoints,
      activityPoints: pool.score.activityPoints,
      weight: pool.score.weight,
      use: pool.score.use,
    })),
    selected: { id: selected.id, name: selected.name, ...selected.score },
    rows,
    cex,
  });
}
