"use client";

import { useEffect, useState } from "react";

type FeedState<T> = { status: "connecting" | "live" | "reconnecting"; value: T | null; seenAt: number | null };
type SpotValue = { bid: string; bidQty: string; ask: string; askQty: string; trades: Array<{ price: string; qty: string; buyerMaker: boolean; time: number }> };
type FutureValue = { mark: string; index: string; funding: string; nextFunding: number };

function useSocketFeed<T>(url: string, parse: (input: unknown, prior: T | null) => T | null) {
  const [state, setState] = useState<FeedState<T>>({ status: "connecting", value: null, seenAt: null });
  const [now, setNow] = useState(Date.now());
  useEffect(() => { const timer = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(timer); }, []);
  useEffect(() => {
    let stopped = false;
    let socket: WebSocket | null = null;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let attempts = 0;
    const connect = () => {
      if (stopped) return;
      setState((s) => ({ ...s, status: attempts ? "reconnecting" : "connecting" }));
      socket = new WebSocket(url);
      socket.onopen = () => { attempts = 0; };
      socket.onmessage = (message) => {
        try {
          const decoded: unknown = JSON.parse(String(message.data));
          setState((prior) => {
            const next = parse(decoded, prior.value);
            return next === null ? prior : { status: "live", value: next, seenAt: Date.now() };
          });
        } catch { /* An invalid frame is ignored and never treated as a zero value. */ }
      };
      socket.onerror = () => socket?.close();
      socket.onclose = () => {
        if (stopped) return;
        attempts += 1;
        timer = setTimeout(connect, Math.min(1000 * 2 ** Math.min(attempts, 4), 15_000));
      };
    };
    setState({ status: "connecting", value: null, seenAt: null });
    connect();
    return () => { stopped = true; if (timer) clearTimeout(timer); socket?.close(); };
  }, [url, parse]);
  const fresh = state.seenAt !== null && now - state.seenAt < 10_000;
  return { ...state, status: state.status === "live" && !fresh ? "reconnecting" as const : state.status, ageSeconds: state.seenAt ? Math.max(0, Math.floor((now - state.seenAt) / 1000)) : null };
}

function parseSpot(input: unknown, prior: SpotValue | null): SpotValue | null {
  if (!input || typeof input !== "object") return null;
  const wrapped = input as { data?: unknown };
  const event = (wrapped.data ?? input) as Record<string, unknown>;
  if (typeof event.s !== "string") return null;
  if (event.e === "trade" && typeof event.p === "string" && typeof event.q === "string" && typeof event.T === "number") {
    const base = prior ?? { bid: "—", bidQty: "—", ask: "—", askQty: "—", trades: [] };
    return { ...base, trades: [{ price: event.p, qty: event.q, buyerMaker: event.m === true, time: event.T }, ...base.trades].slice(0, 12) };
  }
  if (typeof event.b === "string" && typeof event.B === "string" && typeof event.a === "string" && typeof event.A === "string") {
    const base = prior ?? { bid: "—", bidQty: "—", ask: "—", askQty: "—", trades: [] };
    return { ...base, bid: event.b, bidQty: event.B, ask: event.a, askQty: event.A };
  }
  return null;
}

function parseFuture(input: unknown): FutureValue | null {
  if (!input || typeof input !== "object") return null;
  const wrapped = input as { data?: unknown };
  const event = (wrapped.data ?? input) as Record<string, unknown>;
  if (typeof event.p !== "string" || typeof event.i !== "string" || typeof event.r !== "string" || typeof event.T !== "number") return null;
  return { mark: event.p, index: event.i, funding: event.r, nextFunding: event.T };
}

function StatusPill({ status, age }: { status: string; age: number | null }) {
  return <span className={`pill ${status === "live" ? "pill-live" : "pill-warn"}`}><i />{status === "live" ? `LIVE · ${age ?? 0}s` : status.toUpperCase()}</span>;
}

function PriceSparkline({ trades }: { trades: SpotValue["trades"] }) {
  if (trades.length < 2) return <div className="spark-empty">Price trace appears after live trade events arrive.</div>;
  const values = [...trades].reverse().map((t) => Number(t.price)).filter(Number.isFinite);
  if (values.length < 2) return <div className="spark-empty">Waiting for valid price events.</div>;
  const low = Math.min(...values); const high = Math.max(...values); const range = high - low || Math.max(high * 0.00001, 1);
  const points = values.map((value, i) => `${(i / (values.length - 1)) * 520},${108 - ((value - low) / range) * 92}`).join(" ");
  return <div className="sparkline-wrap"><div className="sparkline-head"><span>Recent trade price · {values.length} events</span><small>{values.at(-1)}</small></div><svg className="sparkline" viewBox="0 0 520 120" role="img" aria-label="Recent trade price trace from live exchange events" preserveAspectRatio="none"><defs><linearGradient id="price-fill" x1="0" x2="0" y1="0" y2="1"><stop offset="0%" stopColor="#08805d" stopOpacity=".22"/><stop offset="100%" stopColor="#08805d" stopOpacity="0"/></linearGradient></defs><polygon points={`0,120 ${points} 520,120`} fill="url(#price-fill)"/><polyline points={points} fill="none" stroke="#08795c" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke"/></svg><div className="sparkline-labels"><span>{low}</span><span>Live event sequence · not a forecast</span><span>{high}</span></div></div>;
}

function MarketView() {
  const [symbolInput, setSymbolInput] = useState("BTCUSDT");
  const [symbol, setSymbol] = useState("BTCUSDT");
  const safeSymbol = /^[A-Z0-9]{5,20}$/.test(symbol) ? symbol.toLowerCase() : "btcusdt";
  const spotUrl = `wss://data-stream.binance.vision:443/stream?streams=${safeSymbol}@trade/${safeSymbol}@bookTicker`;
  const futuresUrl = `wss://fstream.binance.com/market/stream?streams=${safeSymbol}@markPrice@1s`;
  const spot = useSocketFeed<SpotValue>(spotUrl, parseSpot);
  const future = useSocketFeed<FutureValue>(futuresUrl, parseFuture);
  const spread = spot.value && spot.value.bid !== "—" && spot.value.ask !== "—" ? (Number(spot.value.ask) - Number(spot.value.bid)).toPrecision(7) : null;
  const buyQty = spot.value?.trades.filter((x) => !x.buyerMaker).reduce((s, x) => s + Number(x.qty), 0) ?? 0;
  const sellQty = spot.value?.trades.filter((x) => x.buyerMaker).reduce((s, x) => s + Number(x.qty), 0) ?? 0;
  return <>
    <div className="section-intro"><div><span className="eyebrow">PUBLIC MARKET DATA · READ ONLY</span><h2>Live market monitor</h2><p>Browser connects directly to public Binance market streams. No keys and no order permissions.</p></div><form className="symbol-form" onSubmit={(e) => { e.preventDefault(); const next = symbolInput.trim().toUpperCase(); if (/^[A-Z0-9]{5,20}$/.test(next)) setSymbol(next); }}><label htmlFor="symbol">Symbol</label><input id="symbol" value={symbolInput} onChange={(e) => setSymbolInput(e.target.value)} maxLength={20} /><button className="button button-dark">Apply</button></form></div>
    <div className="grid grid-2">
      <article className="card market-card"><header className="card-head"><div><span className="eyebrow">BINANCE SPOT</span><h3>{symbol} · Top of book</h3></div><StatusPill status={spot.status} age={spot.ageSeconds} /></header>
        <div className="quote-grid"><div><small>BEST BID</small><b className="positive">{spot.value?.bid ?? "—"}</b><small>{spot.value?.bidQty ?? "—"} {symbol.slice(0, -4)}</small></div><div><small>BEST ASK</small><b className="negative">{spot.value?.ask ?? "—"}</b><small>{spot.value?.askQty ?? "—"} {symbol.slice(0, -4)}</small></div></div>
        <div className="stat-line"><span>Spread</span><b>{spread ?? "—"}</b></div><div className="stat-line"><span>Recent trade imbalance (12 prints)</span><b>{buyQty + sellQty > 0 ? `${(((buyQty - sellQty) / (buyQty + sellQty)) * 100).toFixed(1)}%` : "—"}</b></div><PriceSparkline trades={spot.value?.trades ?? []} />
        <h4>Recent trades</h4>{spot.value?.trades.length ? <div className="table-scroll"><table><thead><tr><th>Time (UTC)</th><th>Price</th><th>Quantity</th><th>Taker</th></tr></thead><tbody>{spot.value.trades.map((t, i) => <tr key={`${t.time}-${i}`}><td>{new Date(t.time).toLocaleTimeString()}</td><td>{t.price}</td><td>{t.qty}</td><td>{t.buyerMaker ? "Sell" : "Buy"}</td></tr>)}</tbody></table></div> : <p className="muted">Waiting for actual exchange events. Empty values stay unknown.</p>}
      </article>
      <article className="card"><header className="card-head"><div><span className="eyebrow">BINANCE USDⓈ-M FUTURES</span><h3>{symbol} · Mark & funding</h3></div><StatusPill status={future.status} age={future.ageSeconds} /></header>
        <div className="metric-grid"><div className="metric"><small>MARK PRICE</small><strong>{future.value?.mark ?? "—"}</strong></div><div className="metric"><small>INDEX PRICE</small><strong>{future.value?.index ?? "—"}</strong></div><div className="metric"><small>FUNDING RATE</small><strong>{future.value?.funding ?? "—"}</strong></div><div className="metric"><small>NEXT FUNDING</small><strong>{future.value ? new Date(future.value.nextFunding).toLocaleTimeString() : "—"}</strong></div></div>
        <div className="notice notice-warn"><b>Live futures trading: LOCKED</b><span>This panel reads public data only. No order placement or account stream is enabled.</span></div>
      </article>
    </div>
    <article className="card"><header className="card-head"><div><span className="eyebrow">CONNECTOR COVERAGE</span><h3>Exchange adapter status</h3></div><span className="coverage-number">1 <small>/ 30 planned venue adapters</small></span></header><div className="coverage-list"><span className="coverage-ok">● Binance Spot — public adapter implemented</span><span className="coverage-ok">● Binance USDⓈ-M — public adapter implemented</span><span className="coverage-off">○ 14 other CEX venues — unconfigured</span><span className="coverage-off">○ 15 DEX venue adapters — not implemented</span></div><p className="muted tiny">The 15 CEX / 15 DEX targets are capacity goals, not current integrations. Two Binance market streams come from the same exchange venue. Use each feed status above to see actual live connection health.</p></article>
  </>;
}

type DexPair = { chain: string; dex: string; pairAddress: string; base: string; quote: string; priceUsd: string | null; liquidityUsd: number | null; volume24hUsd: number | null; url: string | null };
function DexView() {
  const [query, setQuery] = useState("WETH USDC");
  const [pairs, setPairs] = useState<DexPair[]>([]);
  const [status, setStatus] = useState("idle");
  const [error, setError] = useState("");
  async function search(event: React.FormEvent) {
    event.preventDefault(); setStatus("loading"); setError("");
    try { const res = await fetch(`/api/dex/search?q=${encodeURIComponent(query)}`, { cache: "no-store" }); const data = await res.json(); if (!res.ok || !data.ok) throw new Error(data.error ?? "Search failed."); setPairs(data.pairs); setStatus("ready"); }
    catch (e) { setError(e instanceof Error ? e.message : "DEX search failed."); setStatus("error"); }
  }
  return <><div className="section-intro"><div><span className="eyebrow">DEX DISCOVERY · PUBLIC SEARCH</span><h2>Pool and pair search</h2><p>Search index data supplied by DexScreener. This is not an on-chain event socket or a token safety verdict.</p></div></div><article className="card"><form className="search-form" onSubmit={search}><label className="sr-only" htmlFor="dex-query">Token or pair search</label><input id="dex-query" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Token name, symbol or address" minLength={2} maxLength={100} /><button className="button button-accent" disabled={status === "loading"}>{status === "loading" ? "Searching…" : "Search pools"}</button></form>{error && <div className="notice notice-error">{error}</div>}{status === "ready" && pairs.length === 0 && <p className="muted">No indexed pools found for this query.</p>}{pairs.length > 0 && <div className="table-scroll"><table><thead><tr><th>Chain / DEX</th><th>Pair</th><th>Price USD</th><th>Liquidity USD</th><th>24h volume USD</th><th>Source</th></tr></thead><tbody>{pairs.map((p) => <tr key={`${p.chain}-${p.pairAddress}`}><td><b>{p.chain}</b><small className="block">{p.dex}</small></td><td>{p.base}/{p.quote}<small className="block mono">{p.pairAddress}</small></td><td>{p.priceUsd ?? "—"}</td><td>{p.liquidityUsd?.toLocaleString() ?? "—"}</td><td>{p.volume24hUsd?.toLocaleString() ?? "—"}</td><td>{p.url ? <a href={p.url} target="_blank" rel="noreferrer">Open ↗</a> : "—"}</td></tr>)}</tbody></table></div>}</article><div className="notice notice-info"><b>Scope</b><span>DEX search returns a bounded list of indexed pairs. It does not decode swaps, establish wallet ownership, or submit trades. DEX WebSocket adapters remain a separate integration task.</span></div></>;
}

type WalletResponse = { ok: boolean; transactions: Array<{ hash: string; from: string | null; to: string | null; timestamp: string | null; status: string; method: string | null }>; source?: string; error?: string };
function WalletView() {
  const [chain, setChain] = useState("ethereum");
  const [address, setAddress] = useState("");
  const [watchlist, setWatchlist] = useState<string[]>([]);
  const [data, setData] = useState<WalletResponse | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  useEffect(() => { try { const saved: unknown = JSON.parse(localStorage.getItem("cpe-wallet-watchlist") ?? "[]"); setWatchlist(Array.isArray(saved) ? saved.filter((item): item is string => typeof item === "string" && /^0x[a-fA-F0-9]{40}$/.test(item)).slice(0, 15) : []); } catch { setWatchlist([]); } }, []);
  async function inspect(event: React.FormEvent) {
    event.preventDefault(); const cleaned = address.trim(); if (!/^0x[a-fA-F0-9]{40}$/.test(cleaned)) { setError("Enter a valid EVM address."); return; }
    if (!watchlist.some((x) => x.toLowerCase() === cleaned.toLowerCase()) && watchlist.length >= 15) { setError("The local watchlist is limited to 15 entries."); return; }
    setLoading(true); setError("");
    try { const list = [...watchlist.filter((x) => x.toLowerCase() !== cleaned.toLowerCase()), cleaned]; setWatchlist(list); localStorage.setItem("cpe-wallet-watchlist", JSON.stringify(list)); const res = await fetch(`/api/wallets/activity?chain=${chain}&address=${cleaned}`, { cache: "no-store" }); const value = await res.json(); if (!res.ok || !value.ok) throw new Error(value.error ?? "Explorer request failed."); setData(value); }
    catch (e) { setError(e instanceof Error ? e.message : "Wallet lookup failed."); setData(null); } finally { setLoading(false); }
  }
  return <><div className="section-intro"><div><span className="eyebrow">WALLET ACTIVITY · MANUAL REVIEW</span><h2>Address watchlist</h2><p>Activity explorer only. An address is not automatically called a whale, and a transfer is not classified as a buy or sell.</p></div><div className="watch-count">{watchlist.length}<small> / 15 watch slots</small></div></div><article className="card"><form className="wallet-form" onSubmit={inspect}><label>Chain<select value={chain} onChange={(e) => setChain(e.target.value)}><option value="ethereum">Ethereum</option><option value="base">Base</option></select></label><label className="wallet-address">Address<input value={address} onChange={(e) => setAddress(e.target.value)} placeholder="0x… (reviewed address)" spellCheck={false} /></label><button className="button button-accent" disabled={loading}>{loading ? "Checking…" : "Inspect activity"}</button></form>{error && <div className="notice notice-error">{error}</div>}<div className="notice notice-warn"><b>Whale verification: NOT ESTABLISHED</b><span>No preloaded wallets, labels, balances, or inactivity claims are fabricated. Add an address you have independently reviewed. Current adapter displays recent normal transactions only.</span></div>{data && <><div className="stat-line"><span>Source · observed at</span><b>{data.source} · {new Date().toLocaleString()}</b></div><p className="muted tiny">{data.transactions.length} recent explorer transactions. Inactivity threshold and whale eligibility still require a separate verified policy.</p><div className="table-scroll"><table><thead><tr><th>Time</th><th>Method</th><th>From</th><th>To</th><th>Transaction</th><th>Status</th></tr></thead><tbody>{data.transactions.map((t) => <tr key={t.hash}><td>{t.timestamp ? new Date(t.timestamp).toLocaleString() : "—"}</td><td>{t.method ?? "Transfer / contract call"}</td><td className="mono">{t.from?.slice(0, 8) ?? "—"}…</td><td className="mono">{t.to?.slice(0, 8) ?? "—"}…</td><td className="mono">{t.hash.slice(0, 12)}…</td><td>{t.status}</td></tr>)}</tbody></table></div></>}</article><article className="card"><h3>Saved on this device</h3>{watchlist.length === 0 ? <p className="muted">No addresses added. Nothing is being tracked yet.</p> : <div className="watchlist">{watchlist.map((item) => <button key={item} className="watch-entry" onClick={() => setAddress(item)}>{item.slice(0, 10)}…{item.slice(-6)} <span>UNVERIFIED</span></button>)}</div>}</article></>;
}

function PredictionsView() {
  return <><div className="section-intro"><div><span className="eyebrow">MODEL STATUS</span><h2>Prediction and score</h2><p>No market probability is displayed until its required inputs and calibration evidence are available.</p></div></div><article className="card prediction-blocked"><div className="blocked-icon">!</div><div><span className="pill pill-warn">BLOCKED · NO SCORE</span><h3>Prediction engine is not eligible to publish a score</h3><p>Current connected venue count is 1 CEX. Cross-venue breadth, verified DEX flow, and verified active-wallet flow are missing. Missing inputs are not treated as zero.</p><ul><li>Connect and validate independent CEX feeds</li><li>Build DEX swap event adapters and transaction decoding</li><li>Verify wallet ownership, activity windows, and inclusion criteria</li><li>Run time-split backtests and calibration before publishing probability</li></ul></div></article><article className="card"><h3>Score and execution gates</h3><div className="gate-row"><span>Prediction score</span><b className="status-blocked">Unavailable</b></div><div className="gate-row"><span>Spot automatic execution</span><b className="status-blocked">LOCKED · Paper only</b></div><div className="gate-row"><span>Futures automatic execution</span><b className="status-blocked">LOCKED · Paper only</b></div><div className="gate-row"><span>Model calibration</span><b className="status-blocked">No verified observation set</b></div></article></>;
}

function PaperView() {
  const [side, setSide] = useState("BUY");
  const [qty, setQty] = useState("0.001");
  return <><div className="section-intro"><div><span className="eyebrow">SIMULATION ONLY</span><h2>Paper order preview</h2><p>Preview-only widget. It does not persist, route, simulate fills, or transmit orders.</p></div></div><article className="card paper-card"><div className="wallet-form"><label>Symbol<input value="BTCUSDT" readOnly /></label><label>Side<select value={side} onChange={(e) => setSide(e.target.value)}><option>BUY</option><option>SELL</option></select></label><label>Quantity<input inputMode="decimal" value={qty} onChange={(e) => setQty(e.target.value)} /></label></div><div className="notice notice-warn"><b>Paper mode is preview-only</b><span>A durable paper ledger, fee/slippage model, and fill reconciliation have not been connected to this panel.</span></div><pre>{JSON.stringify({ mode: "PAPER_PREVIEW_ONLY", symbol: "BTCUSDT", side, quantity: qty, liveTrading: "OFF", liveOrdersLocked: true }, null, 2)}</pre></article></>;
}

function AdminView() {
  const checks = ["UI build and responsive layout", "Market feed freshness + reconnect", "DEX source availability", "Wallet source provenance + freshness", "Model calibration evidence", "Live order lock", "Database migrations", "iOS release", "Android release"];
  return <><div className="section-intro"><div><span className="eyebrow">ADMIN · RELEASE CHECKLIST</span><h2>System readiness</h2><p>Live readings below describe this source build; infrastructure checks require the deployment environment and database.</p></div></div><article className="card"><div className="notice notice-info"><b>Safety configuration</b><span>LIVE_TRADING=OFF · LIVE_ORDERS_LOCKED=true · public market connectors only.</span></div><div className="checklist">{checks.map((item, i) => <div className="check-row" key={item}><span className="check-index">{String(i + 1).padStart(2, "0")}</span><span>{item}</span><b className={i === 0 || i === 1 ? "status-implemented" : "status-blocked"}>{i === 0 || i === 1 ? "SOURCE READY · VERIFY AT RUN" : "BLOCKED / NOT CONFIGURED"}</b></div>)}</div><p className="muted tiny">Checklist labels are not deployment health attestations. Provider credentials belong server-side and are not editable or stored in this browser panel.</p></article></>;
}

export function EngineWorkspace({ section, onNavigate }: { section: string; onNavigate: (section: string) => void }) {
  if (section === "Market") return <MarketView />;
  if (section === "DEX" || section === "Search") return <DexView />;
  if (section === "Wallets") return <WalletView />;
  if (section === "Predictions") return <PredictionsView />;
  if (section === "Paper") return <PaperView />;
  if (section === "Admin" || section === "Checklist" || section === "Bugs") return <AdminView />;
  return <><div className="section-intro"><div><span className="eyebrow">CRYPTO RESEARCH WORKSPACE</span><h2>Read-only market intelligence</h2><p>Exchange streams, DEX discovery, reviewed address activity, guarded predictions, and paper-only execution.</p></div><span className="pill pill-warn">LIVE ORDERS LOCKED</span></div><div className="grid grid-3"><button className="shortcut-card" onClick={() => onNavigate("Market")}><span className="shortcut-icon">↗</span><b>Live market feeds</b><small>Spot book, trades and futures funding</small></button><button className="shortcut-card" onClick={() => onNavigate("DEX")}><span className="shortcut-icon">◇</span><b>DEX pair search</b><small>Public indexed pairs and liquidity</small></button><button className="shortcut-card" onClick={() => onNavigate("Wallets")}><span className="shortcut-icon">◉</span><b>Wallet activity</b><small>Manual watchlist; unverified until reviewed</small></button></div><div className="grid grid-2"><article className="card"><span className="eyebrow">CURRENT CONNECTIONS</span><h3>Two public market streams</h3><p>Binance Spot and Binance USDⓈ-M Futures. Remaining exchange slots are unconfigured and not included in scoring.</p></article><article className="card"><span className="eyebrow">PREDICTION STATUS</span><h3>Score is safely blocked</h3><p>Inputs required for a defensible probability are missing. No synthetic prediction or automatic order can be generated.</p></article></div></>;
}
