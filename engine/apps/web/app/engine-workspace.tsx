"use client";

import { useEffect, useState } from "react";
import { CexDesk } from "./cex-desk";
import { parseFuture, parseSpot, useSocketFeed, type SpotValue } from "./market-feed";
import { SpotApiV3 } from "./spot-api-v3";

function StatusPill({ status, age }: { status: string; age: number | null }) {
  return <span className={`pill ${status === "live" ? "pill-live" : "pill-warn"}`}><i />{status === "live" ? `LIVE · ${age ?? 0}s` : status.toUpperCase()}</span>;
}

function PriceSparkline({ trades }: { trades: SpotValue["trades"] }) {
  if (trades.length < 2) return <div className="spark-empty">Price trace appears after live trade events arrive.</div>;
  const values = [...trades].reverse().map((trade) => Number(trade.price)).filter(Number.isFinite);
  if (values.length < 2) return <div className="spark-empty">Waiting for valid price events.</div>;
  const low = Math.min(...values);
  const high = Math.max(...values);
  const range = high - low || Math.max(high * 0.00001, 1);
  const points = values.map((value, index) => `${(index / (values.length - 1)) * 520},${108 - ((value - low) / range) * 92}`).join(" ");
  return (
    <div className="sparkline-wrap">
      <div className="sparkline-head"><span>Recent trade price · {values.length} events</span><small>{values.at(-1)}</small></div>
      <svg className="sparkline" viewBox="0 0 520 120" role="img" aria-label="Recent trade price trace from live exchange events" preserveAspectRatio="none">
        <defs><linearGradient id="price-fill" x1="0" x2="0" y1="0" y2="1"><stop offset="0%" stopColor="#08805d" stopOpacity=".22" /><stop offset="100%" stopColor="#08805d" stopOpacity="0" /></linearGradient></defs>
        <polygon points={`0,120 ${points} 520,120`} fill="url(#price-fill)" />
        <polyline points={points} fill="none" stroke="#08795c" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
      </svg>
      <div className="sparkline-labels"><span>{low}</span><span>Live event sequence · not a forecast</span><span>{high}</span></div>
    </div>
  );
}

function clock(value: number | null | undefined) {
  return typeof value === "number" ? new Date(value).toLocaleTimeString() : "—";
}

function MarketView() {
  const [symbolInput, setSymbolInput] = useState("BTCUSDT");
  const [symbol, setSymbol] = useState("BTCUSDT");
  const safeSymbol = /^[A-Z0-9]{5,20}$/.test(symbol) ? symbol.toLowerCase() : "btcusdt";
  const spotUrl = `wss://data-stream.binance.vision:443/stream?streams=${safeSymbol}@trade/${safeSymbol}@bookTicker`;
  const futuresUrl = `wss://fstream.binance.com/market/stream?streams=${safeSymbol}@markPrice@1s`;
  const spot = useSocketFeed<SpotValue>(spotUrl, parseSpot);
  const future = useSocketFeed(futuresUrl, parseFuture);
  const spread = spot.value && spot.value.bid !== "—" && spot.value.ask !== "—" ? (Number(spot.value.ask) - Number(spot.value.bid)).toPrecision(7) : null;
  const buyQty = spot.value?.trades.filter((trade) => !trade.buyerMaker).reduce((sum, trade) => sum + Number(trade.qty), 0) ?? 0;
  const sellQty = spot.value?.trades.filter((trade) => trade.buyerMaker).reduce((sum, trade) => sum + Number(trade.qty), 0) ?? 0;
  return (
    <>
      <div className="section-intro">
        <div>
          <span className="eyebrow">PUBLIC MARKET DATA · READ ONLY</span>
          <h2>Live market monitor</h2>
          <p>Browser connects directly to public Binance market streams. No keys and no order permissions.</p>
        </div>
        <form className="symbol-form" onSubmit={(event) => { event.preventDefault(); const next = symbolInput.trim().toUpperCase(); if (/^[A-Z0-9]{5,20}$/.test(next)) setSymbol(next); }}>
          <label htmlFor="symbol">Symbol</label>
          <input id="symbol" value={symbolInput} onChange={(event) => setSymbolInput(event.target.value)} maxLength={20} />
          <button className="button button-dark">Apply</button>
        </form>
      </div>
      <div className="grid grid-2">
        <article className="card market-card">
          <header className="card-head"><div><span className="eyebrow">BINANCE SPOT</span><h3>{symbol} · Top of book</h3></div><StatusPill status={spot.status} age={spot.ageSeconds} /></header>
          <div className="quote-grid">
            <div><small>BEST BID</small><b className="positive">{spot.value?.bid ?? "—"}</b><small>{spot.value?.bidQty ?? "—"} {symbol.slice(0, -4)}</small></div>
            <div><small>BEST ASK</small><b className="negative">{spot.value?.ask ?? "—"}</b><small>{spot.value?.askQty ?? "—"} {symbol.slice(0, -4)}</small></div>
          </div>
          <div className="stat-line"><span>Spread</span><b>{spread ?? "—"}</b></div>
          <div className="stat-line"><span>Book update id</span><b>{spot.value?.bookUpdateId ?? "—"}</b></div>
          <SpotApiV3 symbol={symbol} />
          <div className="stat-line"><span>Recent trade imbalance (12 prints)</span><b>{buyQty + sellQty > 0 ? `${(((buyQty - sellQty) / (buyQty + sellQty)) * 100).toFixed(1)}%` : "—"}</b></div>
          <PriceSparkline trades={spot.value?.trades ?? []} />
          <h4>Recent trades</h4>
          {spot.value?.trades.length ? (
            <div className="table-scroll">
              <table>
                <thead><tr><th>Trade id</th><th>Time (UTC)</th><th>Event time</th><th>Price</th><th>Quantity</th><th>Taker</th><th>Best match</th></tr></thead>
                <tbody>
                  {spot.value.trades.map((trade, index) => (
                    <tr key={`${trade.tradeId ?? trade.time}-${index}`}>
                      <td>{trade.tradeId ?? "—"}</td>
                      <td>{clock(trade.time)}</td>
                      <td>{clock(trade.eventTime)}</td>
                      <td>{trade.price}</td>
                      <td>{trade.qty}</td>
                      <td>{trade.buyerMaker ? "Sell" : "Buy"}</td>
                      <td>{trade.bestMatch === null ? "—" : trade.bestMatch ? "Yes" : "No"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : <p className="muted">Waiting for actual exchange events. Empty values stay unknown.</p>}
        </article>
        <article className="card">
          <header className="card-head"><div><span className="eyebrow">BINANCE USDⓈ-M FUTURES</span><h3>{symbol} · Mark & funding</h3></div><StatusPill status={future.status} age={future.ageSeconds} /></header>
          <div className="metric-grid">
            <div className="metric"><small>MARK PRICE</small><strong>{future.value?.mark ?? "—"}</strong></div>
            <div className="metric"><small>INDEX PRICE</small><strong>{future.value?.index ?? "—"}</strong></div>
            <div className="metric"><small>MARK AVERAGE</small><strong>{future.value?.markAverage ?? "—"}</strong></div>
            <div className="metric"><small>SETTLE ESTIMATE</small><strong>{future.value?.settle ?? "—"}</strong></div>
            <div className="metric"><small>FUNDING RATE</small><strong>{future.value?.funding ?? "—"}</strong></div>
            <div className="metric"><small>NEXT FUNDING</small><strong>{future.value ? clock(future.value.nextFunding) : "—"}</strong></div>
          </div>
          <div className="stat-line"><span>Event</span><b>{future.value?.event ?? "—"}</b></div>
          <div className="stat-line"><span>Event time</span><b>{clock(future.value?.eventTime)}</b></div>
          <div className="stat-line"><span>Symbol on the frame</span><b>{future.value?.symbol ?? "—"}</b></div>
          <div className="notice notice-warn"><b>Live futures trading: LOCKED</b><span>Settle estimate is only useful in the last hour before settlement. This panel reads public data only.</span></div>
        </article>
      </div>
      <article className="card">
        <header className="card-head"><div><span className="eyebrow">CONNECTOR COVERAGE</span><h3>Exchange adapter status</h3></div><span className="coverage-number">1 <small>/ 15 CEX connection slots</small></span></header>
        <div className="coverage-list">
          <span className="coverage-ok">● Binance Spot — public adapter live</span>
          <span className="coverage-ok">● Binance USDⓈ-M — public adapter live</span>
          <span className="coverage-off">○ 14 other CEX venues — listed in Admin, not connected</span>
        </div>
        <p className="muted tiny">The Admin role holds the 15-exchange list, socket limits, and field map. Live orders stay locked.</p>
      </article>
    </>
  );
}

type DexPair = { chain: string; dex: string; pairAddress: string; base: string; quote: string; priceUsd: string | null; liquidityUsd: number | null; volume24hUsd: number | null; url: string | null };
function DexView() {
  const [query, setQuery] = useState("WETH USDC");
  const [pairs, setPairs] = useState<DexPair[]>([]);
  const [status, setStatus] = useState("idle");
  const [error, setError] = useState("");
  async function search(event: React.FormEvent) {
    event.preventDefault();
    setStatus("loading");
    setError("");
    try {
      const response = await fetch(`/api/dex/search?q=${encodeURIComponent(query)}`, { cache: "no-store" });
      const data = await response.json();
      if (!response.ok || !data.ok) throw new Error(data.error ?? "Search failed.");
      setPairs(data.pairs);
      setStatus("ready");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "DEX search failed.");
      setStatus("error");
    }
  }
  return (
    <>
      <div className="section-intro"><div><span className="eyebrow">DEX DISCOVERY · PUBLIC SEARCH</span><h2>Pool and pair search</h2><p>Search index data supplied by DexScreener. This is not an on-chain event socket or a token safety verdict.</p></div></div>
      <article className="card">
        <form className="search-form" onSubmit={search}>
          <label className="sr-only" htmlFor="dex-query">Token or pair search</label>
          <input id="dex-query" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Token name, symbol or address" minLength={2} maxLength={100} />
          <button className="button button-accent" disabled={status === "loading"}>{status === "loading" ? "Searching…" : "Search pools"}</button>
        </form>
        {error && <div className="notice notice-error">{error}</div>}
        {status === "ready" && pairs.length === 0 && <p className="muted">No indexed pools found for this query.</p>}
        {pairs.length > 0 && (
          <div className="table-scroll">
            <table>
              <thead><tr><th>Chain / DEX</th><th>Pair</th><th>Price USD</th><th>Liquidity USD</th><th>24h volume USD</th><th>Source</th></tr></thead>
              <tbody>
                {pairs.map((pair) => (
                  <tr key={`${pair.chain}-${pair.pairAddress}`}>
                    <td><b>{pair.chain}</b><small className="block">{pair.dex}</small></td>
                    <td>{pair.base}/{pair.quote}<small className="block mono">{pair.pairAddress}</small></td>
                    <td>{pair.priceUsd ?? "—"}</td>
                    <td>{pair.liquidityUsd?.toLocaleString() ?? "—"}</td>
                    <td>{pair.volume24hUsd?.toLocaleString() ?? "—"}</td>
                    <td>{pair.url ? <a href={pair.url} target="_blank" rel="noreferrer">Open ↗</a> : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </article>
      <div className="notice notice-info"><b>Scope</b><span>DEX search returns a bounded list of indexed pairs. It does not decode swaps, establish wallet ownership, or submit trades.</span></div>
    </>
  );
}

type WalletResponse = { ok: boolean; transactions: Array<{ hash: string; from: string | null; to: string | null; timestamp: string | null; status: string; method: string | null }>; source?: string; error?: string };
function WalletView() {
  const [chain, setChain] = useState("ethereum");
  const [address, setAddress] = useState("");
  const [watchlist, setWatchlist] = useState<string[]>([]);
  const [data, setData] = useState<WalletResponse | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  useEffect(() => {
    try {
      const saved: unknown = JSON.parse(localStorage.getItem("cpe-wallet-watchlist") ?? "[]");
      setWatchlist(Array.isArray(saved) ? saved.filter((item): item is string => typeof item === "string" && /^0x[a-fA-F0-9]{40}$/.test(item)).slice(0, 15) : []);
    } catch {
      setWatchlist([]);
    }
  }, []);
  async function inspect(event: React.FormEvent) {
    event.preventDefault();
    const cleaned = address.trim();
    if (!/^0x[a-fA-F0-9]{40}$/.test(cleaned)) { setError("Enter a valid EVM address."); return; }
    if (!watchlist.some((item) => item.toLowerCase() === cleaned.toLowerCase()) && watchlist.length >= 15) { setError("The local watchlist is limited to 15 entries."); return; }
    setLoading(true);
    setError("");
    try {
      const list = [...watchlist.filter((item) => item.toLowerCase() !== cleaned.toLowerCase()), cleaned];
      setWatchlist(list);
      localStorage.setItem("cpe-wallet-watchlist", JSON.stringify(list));
      const response = await fetch(`/api/wallets/activity?chain=${chain}&address=${cleaned}`, { cache: "no-store" });
      const value = await response.json();
      if (!response.ok || !value.ok) throw new Error(value.error ?? "Explorer request failed.");
      setData(value);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Wallet lookup failed.");
      setData(null);
    } finally {
      setLoading(false);
    }
  }
  return (
    <>
      <div className="section-intro"><div><span className="eyebrow">WALLET ACTIVITY · MANUAL REVIEW</span><h2>Address watchlist</h2><p>Activity explorer only. An address is not automatically called a whale, and a transfer is not classified as a buy or sell.</p></div><div className="watch-count">{watchlist.length}<small> / 15 watch slots</small></div></div>
      <article className="card">
        <form className="wallet-form" onSubmit={inspect}>
          <label>Chain<select value={chain} onChange={(event) => setChain(event.target.value)}><option value="ethereum">Ethereum</option><option value="base">Base</option></select></label>
          <label className="wallet-address">Address<input value={address} onChange={(event) => setAddress(event.target.value)} placeholder="0x… (reviewed address)" spellCheck={false} /></label>
          <button className="button button-accent" disabled={loading}>{loading ? "Checking…" : "Inspect activity"}</button>
        </form>
        {error && <div className="notice notice-error">{error}</div>}
        <div className="notice notice-warn"><b>Whale verification: NOT ESTABLISHED</b><span>No preloaded wallets, labels, balances, or inactivity claims are fabricated. Add an address you have independently reviewed.</span></div>
        {data && (
          <>
            <div className="stat-line"><span>Source · observed at</span><b>{data.source} · {new Date().toLocaleString()}</b></div>
            <p className="muted tiny">{data.transactions.length} recent explorer transactions.</p>
            <div className="table-scroll">
              <table>
                <thead><tr><th>Time</th><th>Method</th><th>From</th><th>To</th><th>Transaction</th><th>Status</th></tr></thead>
                <tbody>{data.transactions.map((tx) => <tr key={tx.hash}><td>{tx.timestamp ? new Date(tx.timestamp).toLocaleString() : "—"}</td><td>{tx.method ?? "Transfer / contract call"}</td><td className="mono">{tx.from?.slice(0, 8) ?? "—"}…</td><td className="mono">{tx.to?.slice(0, 8) ?? "—"}…</td><td className="mono">{tx.hash.slice(0, 12)}…</td><td>{tx.status}</td></tr>)}</tbody>
              </table>
            </div>
          </>
        )}
      </article>
      <article className="card">
        <h3>Saved on this device</h3>
        {watchlist.length === 0 ? <p className="muted">No addresses added. Nothing is being tracked yet.</p> : <div className="watchlist">{watchlist.map((item) => <button key={item} className="watch-entry" onClick={() => setAddress(item)}>{item.slice(0, 10)}…{item.slice(-6)} <span>UNVERIFIED</span></button>)}</div>}
      </article>
    </>
  );
}

function PredictionsView() {
  return (
    <>
      <div className="section-intro"><div><span className="eyebrow">MODEL STATUS</span><h2>Prediction and score</h2><p>No market probability is displayed until its required inputs and calibration evidence are available.</p></div></div>
      <article className="card prediction-blocked"><div className="blocked-icon">!</div><div><span className="pill pill-warn">BLOCKED · NO SCORE</span><h3>Prediction engine is not eligible to publish a score</h3><p>Current connected venue count is 1 CEX. Cross-venue breadth, verified DEX flow, and verified active-wallet flow are missing. Missing inputs are not treated as zero.</p><ul><li>Connect and validate independent CEX feeds</li><li>Build DEX swap event adapters and transaction decoding</li><li>Verify wallet ownership, activity windows, and inclusion criteria</li><li>Run time-split backtests and calibration before publishing probability</li></ul></div></article>
      <article className="card"><h3>Score and execution gates</h3><div className="gate-row"><span>Prediction score</span><b className="status-blocked">Unavailable</b></div><div className="gate-row"><span>Spot automatic execution</span><b className="status-blocked">LOCKED · Paper only</b></div><div className="gate-row"><span>Futures automatic execution</span><b className="status-blocked">LOCKED · Paper only</b></div><div className="gate-row"><span>Model calibration</span><b className="status-blocked">No verified observation set</b></div></article>
    </>
  );
}

function PaperView() {
  const [side, setSide] = useState("BUY");
  const [qty, setQty] = useState("0.001");
  return (
    <>
      <div className="section-intro"><div><span className="eyebrow">SIMULATION ONLY</span><h2>Paper order preview</h2><p>Preview-only widget. It does not persist, route, simulate fills, or transmit orders.</p></div></div>
      <article className="card paper-card">
        <div className="wallet-form"><label>Symbol<input value="BTCUSDT" readOnly /></label><label>Side<select value={side} onChange={(event) => setSide(event.target.value)}><option>BUY</option><option>SELL</option></select></label><label>Quantity<input inputMode="decimal" value={qty} onChange={(event) => setQty(event.target.value)} /></label></div>
        <div className="notice notice-warn"><b>Paper mode is preview-only</b><span>A durable paper ledger, fee/slippage model, and fill reconciliation have not been connected to this panel.</span></div>
        <pre>{JSON.stringify({ mode: "PAPER_PREVIEW_ONLY", symbol: "BTCUSDT", side, quantity: qty, liveTrading: "OFF", liveOrdersLocked: true }, null, 2)}</pre>
      </article>
    </>
  );
}

function ReleaseChecklist() {
  const checks = ["UI build and responsive layout", "Market feed freshness + reconnect", "DEX source availability", "Wallet source provenance + freshness", "Model calibration evidence", "Live order lock", "Database migrations", "iOS release", "Android release"];
  return (
    <>
      <div className="section-intro"><div><span className="eyebrow">ADMIN · RELEASE CHECKLIST</span><h2>System readiness</h2><p>Live readings below describe this source build; infrastructure checks require the deployment environment and database.</p></div></div>
      <article className="card">
        <div className="notice notice-info"><b>Safety configuration</b><span>LIVE_TRADING=OFF · LIVE_ORDERS_LOCKED=true · public market connectors only.</span></div>
        <div className="checklist">{checks.map((item, index) => <div className="check-row" key={item}><span className="check-index">{String(index + 1).padStart(2, "0")}</span><span>{item}</span><b className={index === 0 || index === 1 ? "status-implemented" : "status-blocked"}>{index === 0 || index === 1 ? "SOURCE READY · VERIFY AT RUN" : "BLOCKED / NOT CONFIGURED"}</b></div>)}</div>
        <p className="muted tiny">Checklist labels are not deployment health attestations. Provider credentials belong server-side and are not stored in this browser panel.</p>
      </article>
    </>
  );
}

function AdminView() {
  return (
    <>
      <CexDesk />
      <ReleaseChecklist />
    </>
  );
}

export function EngineWorkspace({ section, onNavigate }: { section: string; onNavigate: (section: string) => void }) {
  if (section === "Market") return <MarketView />;
  if (section === "DEX" || section === "Search") return <DexView />;
  if (section === "Wallets") return <WalletView />;
  if (section === "Predictions") return <PredictionsView />;
  if (section === "Paper") return <PaperView />;
  if (section === "Admin") return <AdminView />;
  if (section === "Checklist" || section === "Bugs") return <ReleaseChecklist />;
  return (
    <>
      <div className="section-intro"><div><span className="eyebrow">CRYPTO RESEARCH WORKSPACE</span><h2>Read-only market intelligence</h2><p>Exchange streams, DEX discovery, reviewed address activity, guarded predictions, and paper-only execution.</p></div><span className="pill pill-warn">LIVE ORDERS LOCKED</span></div>
      <div className="grid grid-3">
        <button className="shortcut-card" onClick={() => onNavigate("Market")}><span className="shortcut-icon">↗</span><b>Live market feeds</b><small>Spot book, trades and futures funding</small></button>
        <button className="shortcut-card" onClick={() => onNavigate("DEX")}><span className="shortcut-icon">◇</span><b>DEX pair search</b><small>Public indexed pairs and liquidity</small></button>
        <button className="shortcut-card" onClick={() => onNavigate("Wallets")}><span className="shortcut-icon">◉</span><b>Wallet activity</b><small>Manual watchlist; unverified until reviewed</small></button>
      </div>
      <div className="grid grid-2">
        <article className="card"><span className="eyebrow">CURRENT CONNECTIONS</span><h3>One connected exchange</h3><p>Binance Spot and Binance USDⓈ-M are live. The other 14 centralized exchanges are listed for a later public adapter. They are not scored.</p></article>
        <article className="card"><span className="eyebrow">PREDICTION STATUS</span><h3>Score is safely blocked</h3><p>Inputs required for a defensible probability are missing. No synthetic prediction or automatic order can be generated.</p></article>
      </div>
    </>
  );
}
