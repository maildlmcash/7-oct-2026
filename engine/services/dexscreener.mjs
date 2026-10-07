import { dexScore } from "./dex-plan.mjs";

export const DEXSCREENER_LIMIT = Object.freeze({
  route: "GET https://api.dexscreener.com/latest/dex/search",
  requestsPerMinute: 300,
});

export const DEXSCREENER_USES = Object.freeze([
  "Now: Dashboard · DEX search",
  "Now: Admin · Connection plan · DexScreener",
  "Now: Predictions · score weight",
  "Now: Market · 24h price change as a flag, not an order",
]);

export const DEXSCREENER_PREDICTION = Object.freeze([
  "Liquidity points and activity points use liquidity.usd and volume.h24.",
  "A score under 40 is ignored. Otherwise the weight is score / 100.",
  "A pool younger than 24 hours, from pairCreatedAt, stays out of that weight.",
  "priceChange.h24 beyond 20 percent is a disagreement flag. It is not an order.",
  "txns.h24 buys and sells are a note only.",
]);

export const DEXSCREENER_PIPELINE = Object.freeze([
  "Live: one REST search. The published limit is 300 requests per minute.",
  "Not connected: the public reference has no WebSocket for this search.",
  "Not connected: no Rust client is called.",
  "Pipeline option: a socket or a Rust reader only if DexScreener documents one.",
]);

function flatten(value, prefix, rows) {
  if (Array.isArray(value)) {
    if (value.length === 0) rows.push({ field: prefix, value: "[]" });
    value.forEach((item, index) => flatten(item, `${prefix}[${index}]`, rows));
    return;
  }
  if (value && typeof value === "object") {
    for (const key of Object.keys(value).sort()) flatten(value[key], prefix ? `${prefix}.${key}` : key, rows);
    return;
  }
  rows.push({ field: prefix || "value", value: value == null ? "null" : String(value) });
}

export function readDexScreener(payload) {
  const pairs = Array.isArray(payload?.pairs) ? payload.pairs : [];
  const imported = pairs.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const pair = item;
    if (typeof pair.pairAddress !== "string" || typeof pair.chainId !== "string") return [];
    const base = pair.baseToken && typeof pair.baseToken === "object" ? pair.baseToken : {};
    const quote = pair.quoteToken && typeof pair.quoteToken === "object" ? pair.quoteToken : {};
    const liquidity = Number(pair.liquidity?.usd);
    const volume = Number(pair.volume?.h24);
    const volume1h = Number(pair.volume?.h1);
    const volume6h = Number(pair.volume?.h6);
    const score = dexScore(liquidity, volume);
    const created = Number(pair.pairCreatedAt);
    const ageHours = Number.isFinite(created) ? (Date.now() - created) / 3_600_000 : null;
    const young = ageHours != null && ageHours < 24;
    const marketCap = Number(pair.marketCap);
    const change = Number(pair.priceChange?.h24);
    const priceChangeH24 = Number.isFinite(change) ? change : null;
    const fields = [];
    flatten(pair, "", fields);
    fields.sort((a, b) => a.field.localeCompare(b.field));
    return [{
      chain: pair.chainId,
      dex: typeof pair.dexId === "string" ? pair.dexId : "unknown",
      pairAddress: pair.pairAddress,
      base: typeof base.symbol === "string" ? base.symbol : "?",
      quote: typeof quote.symbol === "string" ? quote.symbol : "?",
      priceUsd: typeof pair.priceUsd === "string" ? pair.priceUsd : null,
      liquidityUsd: Number.isFinite(liquidity) ? liquidity : null,
      volume1hUsd: Number.isFinite(volume1h) ? volume1h : null,
      volume6hUsd: Number.isFinite(volume6h) ? volume6h : null,
      volume24hUsd: Number.isFinite(volume) ? volume : null,
      marketCapUsd: Number.isFinite(marketCap) ? marketCap : null,
      priceChangeH24,
      priceFlag: priceChangeH24 == null ? "No 24h price change on this pair." : Math.abs(priceChangeH24) > 20 ? "Disagreement over 20%. Not an order." : "24h change is within 20%. Not an order.",
      score: young ? 0 : score.score,
      liquidityPoints: young ? 0 : score.liquidityPoints,
      activityPoints: young ? 0 : score.activityPoints,
      weight: young ? 0 : score.weight,
      use: young ? "Ignored in Predictions. This pool is under 24 hours old." : score.use,
      fields,
    }];
  });
  return {
    imported: imported.length,
    requestsUsed: 1,
    requestsPerMinute: DEXSCREENER_LIMIT.requestsPerMinute,
    pairs: imported,
  };
}
