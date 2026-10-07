import { DEX_SCORE_PLAN, DEX_VENUES, dexScore } from "../../services/dex-plan.mjs";

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
    const loaded = await getJson("https://api.dydx.exchange/v3/markets");
    const markets = loaded.body?.markets;
    if (!loaded.ok || !markets) {
      return Response.json({ ok: false, error: "dYdX v3 was wound down on 28 October 2024. https://api.dydx.exchange/v3/markets is not connected. dYdX Chain is not shown here.", venue: venue.id }, { status: 502 });
    }
    const pools = Object.values(markets).map((market) => {
      const price = Number(market.indexPrice ?? market.oraclePrice);
      const openInterest = Number(market.openInterest);
      const liquidity = Number.isFinite(price) && Number.isFinite(openInterest) ? price * openInterest : 0;
      return { id: String(market.market), name: String(market.market), liquidity, score: dexScore(liquidity, market.volume24H), raw: market };
    });
    if (pools.length === 0) return Response.json({ ok: false, error: "dYdX v3 returned no markets.", venue: venue.id }, { status: 502 });
    const selected = pools.find((pool) => pool.id === params.get("pool")) ?? pools[0];
    const book = await getJson(`https://api.dydx.exchange/v3/orderbook/${selected.id}`);
    const rows = [];
    flatten({ market: selected.raw, orderbook: book.ok ? book.body : { error: "Order book is not connected." } }, "", rows);
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
      cex: null,
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
