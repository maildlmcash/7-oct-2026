export const DEX_VENUES = Object.freeze([
  Object.freeze({
    id: "uniswap-v2",
    rank: 1,
    name: "Uniswap V2",
    chain: "ethereum",
    network: "eth",
    source: "gecko",
    dexId: "uniswap_v2",
    conditions: Object.freeze([
      "Ethereum only. GeckoTerminal dex id uniswap_v2.",
      "One pool is open at a time. Another DEX is not shown here.",
      "Page 1 only. Later pages are not requested.",
      "No wallet, no router, and no swap is sent.",
    ]),
    uses: Object.freeze([
      "Now: Admin · Connection plan · Uniswap V2",
      "Planned: Predictions · DEX score weight",
      "Planned: Market · With CEX comparison",
    ]),
  }),
  Object.freeze({
    id: "uniswap-v3",
    rank: 2,
    name: "Uniswap V3",
    chain: "ethereum",
    network: "eth",
    source: "gecko",
    dexId: "uniswap_v3",
    conditions: Object.freeze([
      "Ethereum only. GeckoTerminal dex id uniswap_v3.",
      "One pool is open at a time. Uniswap V2 is not mixed in.",
      "Page 1 only. Later pages are not requested.",
      "No wallet, no router, and no swap is sent.",
    ]),
    uses: Object.freeze([
      "Now: Admin · Connection plan · Uniswap V3",
      "Planned: Predictions · DEX score weight",
      "Planned: Market · With CEX comparison",
    ]),
  }),
  Object.freeze({
    id: "sushiswap-v2",
    rank: 3,
    name: "SushiSwap V2",
    chain: "ethereum",
    network: "eth",
    source: "gecko",
    dexId: "sushiswap",
    conditions: Object.freeze([
      "Ethereum only. GeckoTerminal dex id sushiswap. SushiSwap V3 is not this call.",
      "One pool is open at a time.",
      "Page 1 only. Later pages are not requested.",
      "No wallet, no router, and no swap is sent.",
    ]),
    uses: Object.freeze([
      "Now: Admin · Connection plan · SushiSwap V2",
      "Planned: Predictions · DEX score weight",
      "Planned: Market · With CEX comparison",
    ]),
  }),
  Object.freeze({
    id: "curve",
    rank: 4,
    name: "Curve Finance",
    chain: "ethereum",
    source: "curve",
    dexId: "curve",
    conditions: Object.freeze([
      "Ethereum main registry only. GET /api/getPools/ethereum/main.",
      "The 20 largest pools by usdTotal are listed. The table is every field of the selected pool.",
      "This registry call has no 24 hour volume, so activity points stay 0.",
      "One pool is open at a time.",
      "No wallet, no exchange, and no swap is sent.",
    ]),
    uses: Object.freeze([
      "Now: Admin · Connection plan · Curve Finance",
      "Planned: Predictions · DEX score weight",
      "Planned: Market · With CEX comparison when the pool has WETH or WBTC",
    ]),
  }),
  Object.freeze({
    id: "balancer-v2",
    rank: 5,
    name: "Balancer V2",
    chain: "ethereum",
    network: "eth",
    source: "gecko",
    dexId: "balancer_ethereum",
    conditions: Object.freeze([
      "Ethereum only. GeckoTerminal dex id balancer_ethereum.",
      "One pool is open at a time.",
      "Page 1 only. Later pages are not requested.",
      "No wallet, no vault call, and no swap is sent.",
    ]),
    uses: Object.freeze([
      "Now: Admin · Connection plan · Balancer V2",
      "Planned: Predictions · DEX score weight",
      "Planned: Market · With CEX comparison",
    ]),
  }),
  Object.freeze({
    id: "uniswap-v3-arbitrum",
    rank: 1,
    name: "Uniswap V3",
    chain: "arbitrum",
    network: "arbitrum",
    source: "gecko",
    dexId: "uniswap_v3_arbitrum",
    conditions: Object.freeze([
      "Arbitrum only. GeckoTerminal dex id uniswap_v3_arbitrum.",
      "Ethereum Uniswap V3 is not shown here.",
      "One pool is open at a time. Page 1 only.",
      "No wallet, no router, and no swap is sent.",
    ]),
    uses: Object.freeze([
      "Now: Admin · Connection plan · Arbitrum Uniswap V3",
      "Planned: Predictions · DEX score weight",
      "Planned: Market · With CEX comparison",
    ]),
  }),
  Object.freeze({
    id: "sushiswap-v2-arbitrum",
    rank: 2,
    name: "SushiSwap V2",
    chain: "arbitrum",
    network: "arbitrum",
    source: "gecko",
    dexId: "sushiswap_arbitrum",
    conditions: Object.freeze([
      "Arbitrum only. GeckoTerminal dex id sushiswap_arbitrum. SushiSwap V3 is not this call.",
      "Ethereum SushiSwap V2 is not shown here.",
      "One pool is open at a time. Page 1 only.",
      "No wallet, no router, and no swap is sent.",
    ]),
    uses: Object.freeze([
      "Now: Admin · Connection plan · Arbitrum SushiSwap V2",
      "Planned: Predictions · DEX score weight",
      "Planned: Market · With CEX comparison",
    ]),
  }),
  Object.freeze({
    id: "dodo-v2-arbitrum",
    rank: 3,
    name: "DODO V2",
    chain: "arbitrum",
    network: "arbitrum",
    source: "gecko",
    dexId: "dodo_arbitrum",
    conditions: Object.freeze([
      "Arbitrum only. GeckoTerminal dex id dodo_arbitrum.",
      "DODO V3 is not this call.",
      "One pool is open at a time. Page 1 only.",
      "No wallet, no router, and no swap is sent.",
    ]),
    uses: Object.freeze([
      "Now: Admin · Connection plan · Arbitrum DODO V2",
      "Planned: Predictions · DEX score weight",
      "Planned: Market · With CEX comparison",
    ]),
  }),
  Object.freeze({
    id: "dydx-v3",
    rank: 1,
    name: "dYdX V3",
    chain: "order-book",
    source: "dydx-v3",
    dexId: "dydx-v3",
    conditions: Object.freeze([
      "Order book DEX only. GET https://api.dydx.exchange/v3/markets.",
      "dYdX v3 was wound down on 28 October 2024. A closed API is an error.",
      "dYdX Chain (v4) is not shown here.",
      "No account, no order, and no trade is sent.",
    ]),
    uses: Object.freeze([
      "Now: Admin · Connection plan · dYdX V3",
      "Planned: Predictions · order-book score, only if this API is live",
      "Planned: Market · With CEX comparison on BTC-USD or ETH-USD",
    ]),
  }),
  Object.freeze({
    id: "hyperliquid",
    rank: 1,
    name: "Hyperliquid",
    chain: "hybrid",
    source: "hyperliquid",
    dexId: "hyperliquid",
    conditions: Object.freeze([
      "Hybrid DeFi only. POST https://api.hyperliquid.xyz/info with type metaAndAssetCtxs.",
      "The selected market also requests type l2Book. Other markets are not mixed in.",
      "Liquidity for the score is open interest times mark price. Volume is dayNtlVlm.",
      "No exchange action, no order, and no agent wallet is sent.",
    ]),
    uses: Object.freeze([
      "Now: Admin · Connection plan · Hyperliquid",
      "Planned: Predictions · DEX score weight",
      "Planned: Market · With CEX comparison on BTC or ETH",
    ]),
  }),
]);

export const DEX_SCORE_PLAN = Object.freeze([
  "Liquidity points are 0 to 70. $10,000 is 0. $100,000,000 is 70.",
  "Activity points are 0 to 30. 24 hour volume divided by liquidity, capped at 1.",
  "Score is liquidity points plus activity points.",
  "Predictions will ignore a pool when the score is under 40.",
  "Otherwise the prediction weight is score / 100, next to the CEX mid.",
  "With CEX: an ETH or BTC pool can show the gap versus the Binance mid. A gap over 2% is a disagreement flag. It is not an order.",
]);

export function dexScore(liquidityUsd, volume24hUsd) {
  const liquidity = Number(liquidityUsd);
  const volume = Number(volume24hUsd);
  if (!Number.isFinite(liquidity) || liquidity < 10_000) {
    return { liquidityPoints: 0, activityPoints: 0, score: 0, weight: 0, use: "Ignored in Predictions. Liquidity is under $10,000." };
  }
  const liquidityPoints = Math.max(0, Math.min(70, Math.round(((Math.log10(liquidity) - 4) / 4) * 70)));
  const turnover = Number.isFinite(volume) && liquidity > 0 ? Math.min(1, volume / liquidity) : 0;
  const activityPoints = Math.round(turnover * 30);
  const score = liquidityPoints + activityPoints;
  const weight = score / 100;
  const use = score < 40
    ? "Ignored in Predictions. Score is under 40."
    : `Predictions weight ${weight.toFixed(2)}. This pool can sit next to the CEX mid. No order is sent.`;
  return { liquidityPoints, activityPoints, score, weight, use };
}
