"use client";

import { useEffect, useRef, useState } from "react";
import { menuItems } from "../../../services/cex-menu.mjs";

type Level = [string, string];
type Book = { bids: Level[]; asks: Level[] };
type Alert = { id: string; side: "bid" | "ask"; direction: "above" | "below"; kind: "alert" | "stop" | "profit"; price: number; status: "armed" | "fired"; live?: number };
type Sale = { id: string; size: number; price: number; quote: number };

const COINS = ["BTC", "ETH", "SOL"] as const;

function coinsFor(venue: string, book: "spot" | "futures") {
  if (venue === "coinbase" && book === "futures") return ["BTC"] as const;
  if (venue === "kraken" && book === "futures") return ["BTC", "ETH"] as const;
  if (venue === "bitfinex" && book === "futures") return ["BTC", "ETH"] as const;
  return COINS;
}

function levels(rows: unknown, count = 10): Level[] {
  if (!Array.isArray(rows)) return [];
  return rows.slice(0, count).flatMap((row) => {
    const price = Array.isArray(row) ? row[0] : row?.price ?? row?.p;
    const size = Array.isArray(row) ? row[1] : row?.amount ?? row?.size ?? row?.qty ?? row?.s;
    if (price == null || size == null || Number(size) === 0) return [];
    return [[String(price), String(size)] as Level];
  });
}

function book(bids: unknown, asks: unknown): Book | null {
  const next = { bids: levels(bids), asks: levels(asks) };
  return next.bids.length && next.asks.length ? next : null;
}

async function ungzip(data: ArrayBuffer) {
  const stream = new Blob([data]).stream().pipeThrough(new DecompressionStream("gzip"));
  return new Response(stream).text();
}

function DepthBook({ book: depth }: { book: Book }) {
  const max = Math.max(...depth.bids.map((level) => Number(level[1])), ...depth.asks.map((level) => Number(level[1])), 0);
  const spread = Number(depth.asks[0][0]) - Number(depth.bids[0][0]);
  const line = (side: "bid" | "ask", level: Level, index: number) => (
    <div key={`${side}-${index}`} className={`book-row book-${side}`}>
      <span className="book-bar" style={{ width: `${max > 0 ? Math.max(4, (Number(level[1]) / max) * 100) : 0}%` }} />
      <span className="book-price">{level[0]}</span>
      <span className="book-size">{level[1]}</span>
    </div>
  );
  return (
    <div className="book-viz" aria-label="Order book depth">
      {[...depth.asks].reverse().map((level, index) => line("ask", level, index))}
      <div className="book-spread">Spread {Number.isFinite(spread) ? spread.toFixed(2) : "—"} · asks above, bids below</div>
      {depth.bids.map((level, index) => line("bid", level, index))}
    </div>
  );
}

function LiveTicker({ venue, market, coin }: { venue: string; market: "spot" | "futures"; coin: string }) {
  const [quote, setQuote] = useState<Book | null>(null);
  const [status, setStatus] = useState("connecting");
  const [note, setNote] = useState("");
  const previous = useRef<number | null>(null);
  const [direction, setDirection] = useState<"up" | "down" | "flat">("flat");
  useEffect(() => {
    let stopped = false;
    let socket: WebSocket | null = null;
    let timer: ReturnType<typeof setInterval> | null = null;
    let retry: ReturnType<typeof setTimeout> | null = null;
    const local: Book = { bids: [], asks: [] };
    setQuote(null);
    setStatus("connecting");
    setNote("");
    const connect = async () => {
      if (stopped) return;
      let recipe: { ok?: boolean; error?: string; address?: string; request?: string; ping?: string | null };
      try {
        recipe = await (await fetch(`/api/cex/menu?venue=${venue}&book=${market}&coin=${coin}&call=ws-ticker`, { cache: "no-store" })).json();
      } catch {
        if (!stopped) { setStatus("error"); setNote("Ticker call failed."); }
        return;
      }
      if (stopped) return;
      if (!recipe.ok || !recipe.address) {
        setStatus("error");
        setNote(recipe.error ?? "No public ticker on this book.");
        return;
      }
      const send = recipe.request && (recipe.request.startsWith("{") || recipe.request.startsWith("[")) ? recipe.request : "";
      const ping = recipe.ping === "bybit" ? () => JSON.stringify({ op: "ping" })
        : recipe.ping === "text" ? () => "ping"
        : recipe.ping === "gate" ? () => JSON.stringify({ time: Math.floor(Date.now() / 1000), channel: market === "spot" ? "spot.ping" : "futures.ping" })
        : recipe.ping === "mexc" ? () => JSON.stringify({ method: "ping" })
        : recipe.ping === "kucoin" ? () => JSON.stringify({ id: "1", type: "ping" })
        : recipe.ping === "bitfinex" ? () => JSON.stringify({ event: "ping" })
        : null;
      socket = new WebSocket(recipe.address);
      if (venue === "htx" || venue === "upbit") socket.binaryType = "arraybuffer";
      socket.onopen = () => {
        if (send) socket?.send(send);
        if (ping) timer = setInterval(() => { if (socket?.readyState === WebSocket.OPEN) socket.send(ping()); }, 20_000);
      };
      socket.onmessage = (message) => {
        void (async () => {
          let text = typeof message.data === "string" ? message.data : "";
          if (!text && message.data instanceof ArrayBuffer) {
            try { text = venue === "htx" ? await ungzip(message.data) : new TextDecoder().decode(message.data); } catch { return; }
          }
          if (text === "pong" || text === "ping") return;
          let body: Record<string, unknown>;
          try { body = JSON.parse(text) as Record<string, unknown>; } catch { return; }
          if (body.ping) { socket?.send(JSON.stringify({ pong: body.ping })); return; }
          if (body.method === "public/heartbeat") { socket?.send(JSON.stringify({ id: body.id, method: "public/respond-heartbeat" })); return; }
          const next = readBook(venue, market, coin, body, local);
          if (!next || stopped) return;
          const price = Number(next.bids[0][0]);
          if (previous.current != null && price !== previous.current) setDirection(price > previous.current ? "up" : "down");
          previous.current = price;
          setQuote(next);
          setStatus("live");
          setNote("");
        })();
      };
      socket.onclose = () => {
        if (timer) clearInterval(timer);
        if (stopped) return;
        setStatus("error");
        setNote("Ticker websocket closed.");
        retry = setTimeout(() => void connect(), 5_000);
      };
    };
    void connect();
    return () => {
      stopped = true;
      if (timer) clearInterval(timer);
      if (retry) clearTimeout(retry);
      socket?.close();
    };
  }, [venue, market, coin]);
  const bid = quote?.bids[0][0];
  const ask = quote?.asks[0][0];
  return (
    <div className="live-ticker" aria-live="polite">
      <span className={status === "live" ? "pill pill-live" : "pill pill-warn"}>{status === "live" ? "LIVE TICKER" : "TICKER"}</span>
      <b className={direction === "up" ? "tick-up" : direction === "down" ? "tick-down" : ""}>{bid ?? "—"}</b>
      <span>Bid {bid ?? "—"}</span>
      <span>Ask {ask ?? "—"}</span>
      <span>{coin} · {venue} · {market}</span>
      {note ? <span>{note}</span> : null}
    </div>
  );
}

export function ExchangeTools({ venue, book: market }: { venue: string; book: "spot" | "futures" }) {
  const choices = coinsFor(venue, market);
  const [coin, setCoin] = useState<(typeof choices)[number]>(choices[0]);
  const [call, setCall] = useState("ws-depth");
  const [refresh, setRefresh] = useState(0);
  const [left, setLeft] = useState(15);
  const [callText, setCallText] = useState({ address: "", request: "" });
  const [rows, setRows] = useState<{ field: string; value: string; meaning: string }[]>([]);
  const [depth, setDepth] = useState<Book | null>(null);
  const [error, setError] = useState("");
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [sales, setSales] = useState<Sale[]>([]);
  const [draft, setDraft] = useState("");
  const [stopDraft, setStopDraft] = useState("");
  const [profitDraft, setProfitDraft] = useState("");
  const [sellSize, setSellSize] = useState("");
  const [side, setSide] = useState<"bid" | "ask">("bid");
  const [direction, setDirection] = useState<"above" | "below">("above");
  const [open, setOpen] = useState<"alert" | "stop" | "profit" | "sell" | null>(null);
  const bid = depth ? Number(depth.bids[0][0]) : null;
  const ask = depth ? Number(depth.asks[0][0]) : null;
  const sellAmount = Number(sellSize);
  const sellReady = bid != null && Number.isFinite(sellAmount) && sellAmount > 0;

  useEffect(() => {
    let stopped = false;
    let socket: WebSocket | null = null;
    let timer: ReturnType<typeof setInterval> | null = null;
    let retry: ReturnType<typeof setTimeout> | null = null;
    const local: Book = { bids: [], asks: [] };
    setDepth(null);
    setError("");
    const symbol = coin;
    const show = (next: Book | null) => {
      if (!stopped && next) {
        setDepth(next);
        setRows([
          { field: "symbol", value: symbol, meaning: "Selected coin" },
          { field: "bid", value: next.bids[0][0], meaning: "Best bid" },
          { field: "ask", value: next.asks[0][0], meaning: "Best ask" },
        ]);
        setError("");
      }
    };
    const fail = (message: string) => {
      if (!stopped) setError(message);
    };
    const connect = async () => {
      if (stopped) return;
      const endpoint = `/api/cex/menu?venue=${venue}&book=${market}&coin=${symbol}&call=${call}`;
      let recipe: { ok?: boolean; error?: string; kind?: string; address?: string; request?: string; ping?: string | null; rows?: { field: string; value: string; meaning: string }[]; bids?: unknown; asks?: unknown };
      try {
        recipe = await (await fetch(endpoint, { cache: "no-store" })).json();
      } catch {
        return fail("Menu call failed.");
      }
      if (stopped) return;
      setCallText({ address: recipe.address ?? "", request: recipe.request ?? "" });
      if (!recipe.ok) return fail(recipe.error ?? "Menu call failed.");
      if (recipe.kind === "rest") {
        const next = recipe.bids && recipe.asks ? book(recipe.bids, recipe.asks) : null;
        if (next) show(next);
        else setDepth(null);
        setRows(recipe.rows ?? []);
        return;
      }
      const url = recipe.address ?? "";
      const send = recipe.request && (recipe.request.startsWith("{") || recipe.request.startsWith("[")) ? recipe.request : "";
      const pingName = recipe.ping;
      let ping: (() => string) | null = null;
      if (pingName === "bybit") ping = () => JSON.stringify({ op: "ping" });
      if (pingName === "text") ping = () => "ping";
      if (pingName === "gate") ping = () => JSON.stringify({ time: Math.floor(Date.now() / 1000), channel: market === "spot" ? "spot.ping" : "futures.ping" });
      if (pingName === "mexc") ping = () => JSON.stringify({ method: "ping" });
      if (pingName === "kucoin") ping = () => JSON.stringify({ id: "1", type: "ping" });
      if (pingName === "bitfinex") ping = () => JSON.stringify({ event: "ping" });
      if (pingName === "bitstamp") ping = () => JSON.stringify({ event: "bts:heartbeat" });
      if (!url) return fail("This book has no public depth for the selected coin.");
      socket = new WebSocket(url);
      if (venue === "htx" || venue === "upbit") socket.binaryType = "arraybuffer";
      socket.onopen = () => {
        if (send) socket?.send(send);
        if (ping) timer = setInterval(() => { if (socket?.readyState === WebSocket.OPEN && ping) socket.send(ping()); }, 20_000);
      };
      socket.onmessage = (message) => {
        void (async () => {
          let text = typeof message.data === "string" ? message.data : "";
          if (!text && message.data instanceof ArrayBuffer) {
            try { text = venue === "htx" ? await ungzip(message.data) : new TextDecoder().decode(message.data); } catch { return; }
          }
          if (text === "pong" || text === "ping") return;
          let body: Record<string, unknown>;
          try { body = JSON.parse(text) as Record<string, unknown>; } catch { return; }
          if (body.ping) { socket?.send(JSON.stringify({ pong: body.ping })); return; }
          if (body.method === "public/heartbeat") { socket?.send(JSON.stringify({ id: body.id, method: "public/respond-heartbeat" })); return; }
          if (typeof body.msg === "string" && body.msg.toLowerCase().includes("block")) return fail(body.msg);
          const next = readBook(venue, market, symbol, body, local);
          if (next) show(next);
        })();
      };
      socket.onerror = () => socket?.close();
      socket.onclose = () => {
        if (timer) clearInterval(timer);
        if (stopped) return;
        fail("Websocket closed. Reconnecting.");
        retry = setTimeout(() => void connect(), 5_000);
      };
    };
    void connect();
    return () => {
      stopped = true;
      if (timer) clearInterval(timer);
      if (retry) clearTimeout(retry);
      socket?.close();
    };
  }, [venue, market, coin, call, refresh]);

  useEffect(() => {
    setLeft(15);
    const timer = setInterval(() => {
      setLeft((value) => {
        if (value <= 1) {
          setRefresh((count) => count + 1);
          return 15;
        }
        return value - 1;
      });
    }, 1000);
    return () => clearInterval(timer);
  }, [venue, market, coin, call]);

  useEffect(() => {
    setAlerts((current) => {
      let changed = false;
      const next = current.map((alert) => {
        if (alert.status !== "armed") return alert;
        const live = alert.side === "bid" ? bid : ask;
        if (live == null) return alert;
        const hit = alert.direction === "above" ? live >= alert.price : live <= alert.price;
        if (!hit) return alert;
        changed = true;
        return { ...alert, status: "fired" as const, live };
      });
      return changed ? next : current;
    });
  }, [bid, ask]);

  const quoteName = venue === "upbit" ? "KRW" : "USD";
  return (
    <div className="cex-detail">
      <div className="alert-form">
        <label>Coin <select aria-label="Coin" value={coin} onChange={(event) => setCoin(event.target.value as typeof coin)}>{choices.map((item) => <option key={item}>{item}</option>)}</select></label>
        <span>This book is only {coin} on this exchange. No order is sent.</span>
      </div>
      <LiveTicker venue={venue} market={market} coin={coin} />
      <div className="cex-books" role="group" aria-label="API menu">
        {menuItems(market).map((item) => (
          <button key={item.id} type="button" className="button button-dark" aria-pressed={call === item.id} onClick={() => setCall(item.id)}>{item.label}</button>
        ))}
      </div>
      <div className="stat-line"><span>App call</span><b className="mono">GET /api/cex/menu?venue={venue}&book={market}&coin={coin}&call={call}</b></div>
      <div className="stat-line"><span>Auto-refresh</span><b>Every 15s · next in {left}s</b></div>
      <div className="stat-line"><span>Address</span><b className="mono">{callText.address || "—"}</b></div>
      <div className="stat-line"><span>Request</span><b className="mono">{callText.request || "—"}</b></div>
      {error ? <p className="notice notice-error">{error}</p> : null}
      {sales.map((sale) => (
        <p key={sale.id} className="notice notice-warn" role="status">Paper sell {sale.size} {coin} at bid {sale.price}. Quote {sale.quote.toFixed(2)} {quoteName}. No order was sent. <button type="button" onClick={() => setSales((current) => current.filter((item) => item.id !== sale.id))}>Dismiss</button></p>
      ))}
      {alerts.filter((alert) => alert.status === "fired").map((alert) => (
        <p key={alert.id} className="notice notice-warn" role="status">{coin} {alert.kind === "stop" ? `stop loss hit at ${alert.price}.` : alert.kind === "profit" ? `take profit hit at ${alert.price}.` : `${alert.side} is ${alert.direction} ${alert.price}.`} Live price {alert.live}. No order was sent. <button type="button" onClick={() => setAlerts((current) => current.filter((item) => item.id !== alert.id))}>Dismiss</button></p>
      ))}
      {alerts.some((alert) => alert.status === "armed") ? (
        <ul className="cex-limits">{alerts.filter((alert) => alert.status === "armed").map((alert) => (
          <li key={alert.id}>{alert.kind === "stop" ? `Stop loss if best bid falls to ${alert.price}.` : alert.kind === "profit" ? `Take profit if best bid rises to ${alert.price}.` : `Watching ${alert.side} ${alert.direction} ${alert.price}.`} <button type="button" onClick={() => setAlerts((current) => current.filter((item) => item.id !== alert.id))}>Remove</button></li>
        ))}</ul>
      ) : null}
      <div className="card-actions">
        <button className="button button-accent" type="button" onClick={() => setOpen(open === "alert" ? null : "alert")}>Set price alert</button>
        <button className="button button-stop" type="button" onClick={() => setOpen(open === "stop" ? null : "stop")}>Set stop loss</button>
        <button className="button button-accent" type="button" onClick={() => setOpen(open === "profit" ? null : "profit")}>Set take profit</button>
        <button className="button button-stop" type="button" onClick={() => setOpen(open === "sell" ? null : "sell")}>{bid == null ? "Sell" : `Sell ${bid}`}</button>
      </div>
      {open === "alert" ? (
        <form className="alert-form" onSubmit={(event) => {
          event.preventDefault();
          const price = Number(draft);
          if (!Number.isFinite(price) || price <= 0) return;
          setAlerts((current) => [...current, { id: crypto.randomUUID(), side, direction, kind: "alert", price, status: "armed" }]);
          setDraft("");
          setOpen(null);
        }}>
          <input aria-label="Alert price" value={draft} onChange={(event) => setDraft(event.target.value)} placeholder="Price" />
          <select aria-label="Alert side" value={side} onChange={(event) => setSide(event.target.value as "bid" | "ask")}><option value="bid">Best bid</option><option value="ask">Best ask</option></select>
          <select aria-label="Alert direction" value={direction} onChange={(event) => setDirection(event.target.value as "above" | "below")}><option value="above">Above</option><option value="below">Below</option></select>
          <button className="button button-dark" type="submit">Save alert</button>
        </form>
      ) : null}
      {open === "stop" ? (
        <form className="alert-form" onSubmit={(event) => {
          event.preventDefault();
          const price = Number(stopDraft);
          if (!Number.isFinite(price) || price <= 0) return;
          setAlerts((current) => [...current, { id: crypto.randomUUID(), side: "bid", direction: "below", kind: "stop", price, status: "armed" }]);
          setStopDraft("");
          setOpen(null);
        }}>
          <span>Stop if {coin} best bid falls to</span>
          <input aria-label="Stop loss price" value={stopDraft} onChange={(event) => setStopDraft(event.target.value)} placeholder="Stop price" />
          <button className="button button-stop" type="submit">Save stop loss</button>
        </form>
      ) : null}
      {open === "profit" ? (
        <form className="alert-form" onSubmit={(event) => {
          event.preventDefault();
          const price = Number(profitDraft);
          if (!Number.isFinite(price) || price <= 0) return;
          setAlerts((current) => [...current, { id: crypto.randomUUID(), side: "bid", direction: "above", kind: "profit", price, status: "armed" }]);
          setProfitDraft("");
          setOpen(null);
        }}>
          <span>Take profit if {coin} best bid rises to</span>
          <input aria-label="Take profit price" value={profitDraft} onChange={(event) => setProfitDraft(event.target.value)} placeholder="Target price" />
          <button className="button button-accent" type="submit">Save take profit</button>
        </form>
      ) : null}
      {open === "sell" ? (
        <form className="alert-form" onSubmit={(event) => {
          event.preventDefault();
          if (!sellReady || bid == null) return;
          setSales((current) => [{ id: crypto.randomUUID(), size: sellAmount, price: bid, quote: sellAmount * bid }, ...current]);
          setSellSize("");
          setOpen(null);
        }}>
          <span>{bid == null ? "Best bid is not on this book yet." : `${coin} best bid is ${bid}. ${sellReady ? `Quote ${(sellAmount * bid).toFixed(2)} ${quoteName}.` : ""} No order is sent.`}</span>
          <input aria-label="Sell size" value={sellSize} onChange={(event) => setSellSize(event.target.value)} placeholder="Size" />
          <button className="button button-stop" type="submit" disabled={!sellReady}>{sellReady ? `Sell ${sellAmount} ${coin}` : "Sell"}</button>
        </form>
      ) : null}
      {depth ? <DepthBook book={depth} /> : null}
      {rows.length ? (
        <div className="table-scroll">
          <table>
            <thead><tr><th>Field</th><th>Value now</th><th>What it is</th></tr></thead>
            <tbody>{rows.map((item) => <tr key={item.field}><td className="mono">{item.field}</td><td className="mono">{item.value}</td><td>{item.meaning}</td></tr>)}</tbody>
          </table>
        </div>
      ) : null}
    </div>
  );
}

function readBook(venue: string, market: "spot" | "futures", coin: string, body: Record<string, unknown>, local: Book) {
  const usdt = `${coin}USDT`;
  if (venue === "binance" && market === "spot" && Array.isArray(body.bids)) return book(body.bids, body.asks);
  if (venue === "binance" && typeof body.b === "string" && body.s === usdt) return book([[body.b, body.B]], [[body.a, body.A]]);
  if (venue === "binance" && market === "futures" && body.s === usdt) return book(body.b, body.a);
  if (venue === "bybit") {
    const data = body.data as { s?: string; symbol?: string; b?: unknown; a?: unknown; bid1Price?: string; ask1Price?: string; bid1Size?: string; ask1Size?: string } | undefined;
    if (data?.bid1Price && (data.symbol === usdt || data.s === usdt)) return book([[data.bid1Price, data.bid1Size ?? "1"]], [[data.ask1Price, data.ask1Size ?? "1"]]);
    if (data?.s !== usdt) return null;
    if (body.type === "snapshot") {
      const next = book(data.b, data.a);
      if (!next) return null;
      local.bids = next.bids;
      local.asks = next.asks;
      return next;
    }
    return null;
  }
  if (venue === "okx") {
    const arg = body.arg as { instId?: string } | undefined;
    const row = (body.data as { bids?: unknown; asks?: unknown; bidPx?: string; bidSz?: string; askPx?: string; askSz?: string }[] | undefined)?.[0];
    const expected = market === "spot" ? `${coin}-USDT` : `${coin}-USDT-SWAP`;
    if (arg?.instId !== expected) return null;
    if (row?.bidPx) return book([[row.bidPx, row.bidSz]], [[row.askPx, row.askSz]]);
    return book(row?.bids, row?.asks);
  }
  if (venue === "coinbase") {
    const ticker = ((body.events as { tickers?: Record<string, string>[] }[] | undefined)?.[0]?.tickers)?.[0];
    if (!ticker?.best_bid || !ticker.best_ask) return null;
    return book([[ticker.best_bid, ticker.best_bid_quantity ?? "0"]], [[ticker.best_ask, ticker.best_ask_quantity ?? "0"]]);
  }
  if (venue === "kraken" && market === "spot") {
    const row = (body.data as { bids?: unknown; asks?: unknown; symbol?: string; bid?: unknown; ask?: unknown }[] | undefined)?.[0];
    if (row?.symbol !== `${coin}/USD`) return null;
    if (row.bid != null && row.ask != null && !row.bids) return book([[row.bid, "1"]], [[row.ask, "1"]]);
    return book(row.bids, row.asks);
  }
  if (venue === "kraken" && market === "futures" && body.feed === "ticker") {
    const expected = coin === "BTC" ? "PI_XBTUSD" : "PI_ETHUSD";
    if (body.product_id !== expected) return null;
    return book([[body.bid, body.bid_size ?? "1"]], [[body.ask, body.ask_size ?? "1"]]);
  }
  if (venue === "kucoin") {
    const data = body.data as Record<string, unknown> | undefined;
    if (market === "spot" && body.topic === `/market/ticker:${coin}-USDT`) return book([[data?.bestBid, data?.bestBidSize]], [[data?.bestAsk, data?.bestAskSize]]);
    if (market === "futures" && String(body.topic ?? "").includes(coin === "BTC" ? "XBTUSDTM" : `${coin}USDTM`)) return book([[data?.bestBidPrice, data?.bestBidSize]], [[data?.bestAskPrice, data?.bestAskSize]]);
  }
  if (venue === "gate") {
    const result = body.result as { s?: string; contract?: string; bids?: unknown; asks?: unknown; b?: string; a?: string; B?: string; A?: string } | undefined;
    if ((body.event !== "update" && body.event !== "all") || (result?.s ?? result?.contract) !== `${coin}_USDT`) return null;
    if (typeof result?.b === "string") return book([[result.b, result.B]], [[result.a, result.A]]);
    return book(result.bids, result.asks);
  }
  if (venue === "bitget") {
    const arg = body.arg as { instId?: string; instType?: string } | undefined;
    const row = (body.data as { bids?: unknown; asks?: unknown; bidPr?: string; askPr?: string; bidSz?: string; askSz?: string }[] | undefined)?.[0];
    if (arg?.instId !== usdt || arg.instType !== (market === "spot" ? "SPOT" : "USDT-FUTURES")) return null;
    if (row?.bidPr) return book([[row.bidPr, row.bidSz ?? "1"]], [[row.askPr, row.askSz ?? "1"]]);
    return book(row?.bids, row?.asks);
  }
  if (venue === "mexc" && market === "futures" && body.symbol === `${coin}_USDT`) {
    const data = body.data as { bids?: unknown; asks?: unknown; bid1?: unknown; ask1?: unknown } | undefined;
    if (data?.bid1 != null && data.ask1 != null) return book([[data.bid1, "1"]], [[data.ask1, "1"]]);
    return book(data?.bids, data?.asks);
  }
  if (venue === "htx") {
    const tick = body.tick as { bids?: unknown; asks?: unknown; bid?: unknown; ask?: unknown } | undefined;
    const channel = String(body.ch ?? "");
    const coinName = market === "spot" ? usdt.toLowerCase() : `${coin}-USDT`;
    if (!channel.includes(coinName)) return null;
    if (Array.isArray(tick?.bid) && Array.isArray(tick?.ask)) return book([tick.bid], [tick.ask]);
    if (tick?.bid != null && tick.ask != null && !tick.bids) return book([[tick.bid, "1"]], [[tick.ask, "1"]]);
    return book(tick?.bids, tick?.asks);
  }
  if (venue === "crypto-com") {
    const result = body.result as { instrument_name?: string; data?: { bids?: unknown; asks?: unknown }[] } | undefined;
    const expected = market === "spot" ? `${coin}_USDT` : `${coin}USD-PERP`;
    const item = result.data?.[0] as { bids?: unknown; asks?: unknown; b?: unknown; a?: unknown } | undefined;
    if (result?.instrument_name !== expected) return null;
    if (item?.b != null && item.a != null && !item.bids) return book([[item.b, "1"]], [[item.a, "1"]]);
    return book(result.data?.[0]?.bids, result.data?.[0]?.asks);
  }
  if (venue === "upbit" && body.code === `KRW-${coin}`) {
    const unit = (body.orderbook_units as { bid_price?: number; ask_price?: number; bid_size?: number; ask_size?: number }[] | undefined)?.[0];
    if (!unit && body.trade_price != null) return book([[body.trade_price, "1"]], [[body.trade_price, "1"]]);
    if (!unit) return null;
    return book([[unit.bid_price, unit.bid_size]], [[unit.ask_price, unit.ask_size]]);
  }
  if (venue === "bitfinex" && Array.isArray(body) && Array.isArray((body as unknown[])[1])) {
    const entry = (body as unknown[])[1] as unknown[];
    if (typeof entry[0] === "number" && entry.length >= 4) return book([[entry[0], entry[1]]], [[entry[2], entry[3]]]);
    if (Array.isArray(entry[0])) {
      const rows = entry as number[][];
      const bids = rows.filter((row) => row[2] > 0).slice(0, 10).map((row) => [String(row[0]), String(row[2])] as Level);
      const asks = rows.filter((row) => row[2] < 0).slice(0, 10).map((row) => [String(row[0]), String(Math.abs(row[2]))] as Level);
      return bids.length && asks.length ? { bids, asks } : null;
    }
  }
  if (venue === "bitstamp" && body.event === "data") {
    const channel = String(body.channel ?? "");
    const expected = market === "spot" ? `order_book_${coin.toLowerCase()}usd` : `order_book_${coin.toLowerCase()}usd-perp`;
    if (channel !== expected) return null;
    const data = body.data as { bids?: unknown; asks?: unknown } | undefined;
    return book(data?.bids, data?.asks);
  }
  if (venue === "gemini") {
    const name = `${coin.toLowerCase()}${market === "spot" ? "usd" : "gusdperp"}`;
    if (body.s === name && body.b != null && body.a != null) return book([[body.b, body.B ?? "1"]], [[body.a, body.A ?? "1"]]);
    if (body.symbol === name) return book(body.bids, body.asks);
  }
  return null;
}
