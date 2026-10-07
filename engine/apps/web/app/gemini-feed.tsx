"use client";

import { useEffect, useState } from "react";
import { EvidencePill, useObservedStatus } from "./feed-evidence";
import {
  GEMINI_FUTURE_CONDITIONS,
  GEMINI_FUTURE_CONNECTIONS,
  GEMINI_SPOT_CONDITIONS,
  GEMINI_SPOT_CONNECTIONS,
  explainGemini,
} from "../../../services/gemini-public.mjs";
import { SocketDetails } from "./socket-details";

type Alert = {
  id: string;
  book: "spot" | "futures";
  side: "bid" | "ask";
  direction: "above" | "below";
  kind: "alert" | "stop" | "profit";
  price: number;
  status: "armed" | "fired";
  live?: number;
};

type Sale = { id: string; book: "spot" | "futures"; size: number; price: number; quote: number };
type Row = { field: string; value: string; meaning: string };

function livePrice(rows: Row[], side: "bid" | "ask") {
  const row = rows.find((item) => item.field === `${side} 1` || item.field === (side === "bid" ? "b" : "a") || item.field === side);
  const value = Number(row?.value.split(" × ")[0]);
  return Number.isFinite(value) ? value : null;
}
type Spec = (typeof GEMINI_SPOT_CONNECTIONS)[number];

function DepthBook({ rows }: { rows: Row[] }) {
  const levels = rows.flatMap((item) => {
    const match = /^(bid|ask) (\d+)$/.exec(item.field);
    const parts = item.value.split(" × ");
    if (!match || parts.length !== 2) return [];
    return [{ side: match[1], rank: Number(match[2]), price: parts[0], size: parts[1], sizeValue: Number(parts[1]) }];
  });
  const bids = levels.filter((level) => level.side === "bid").sort((left, right) => left.rank - right.rank);
  const asks = levels.filter((level) => level.side === "ask").sort((left, right) => right.rank - left.rank);
  if (!bids.length || !asks.length) return null;
  const max = Math.max(...levels.map((level) => level.sizeValue), 0);
  const spread = Number(asks[asks.length - 1].price) - Number(bids[0].price);
  const sequence = rows.find((item) => item.field === "lastUpdateId")?.value;
  const line = (level: (typeof levels)[number]) => (
    <div key={`${level.side}-${level.rank}`} className={`book-row book-${level.side}`}>
      <span className="book-bar" style={{ width: `${max > 0 ? Math.max(4, (level.sizeValue / max) * 100) : 0}%` }} />
      <span className="book-price">{level.price}</span>
      <span className="book-size">{level.size}</span>
    </div>
  );
  return (
    <div className="book-viz" aria-label="Order book depth">
      {asks.map(line)}
      <div className="book-spread">Spread {Number.isFinite(spread) ? spread.toFixed(2) : "—"} · update {sequence ?? "—"} · asks above, bids below</div>
      {bids.map(line)}
    </div>
  );
}

export function GeminiFeed({ book }: { book: "spot" | "futures" }) {
  const connections = book === "spot" ? GEMINI_SPOT_CONNECTIONS : GEMINI_FUTURE_CONNECTIONS;
  const conditions = book === "spot" ? GEMINI_SPOT_CONDITIONS : GEMINI_FUTURE_CONDITIONS;
  const [selected, setSelected] = useState(connections[0].id);
  const spec = connections.find((item) => item.id === selected) ?? connections[0];
  const [rows, setRows] = useState<Row[]>([]);
  const { status, setStatus, seenAt } = useObservedStatus();
  const [error, setError] = useState("");
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [draft, setDraft] = useState("");
  const [side, setSide] = useState<"bid" | "ask">("bid");
  const [direction, setDirection] = useState<"above" | "below">("above");
  const [alertOpen, setAlertOpen] = useState(false);
  const [stopOpen, setStopOpen] = useState(false);
  const [stopDraft, setStopDraft] = useState("");
  const [profitOpen, setProfitOpen] = useState(false);
  const [profitDraft, setProfitDraft] = useState("");
  const [sellOpen, setSellOpen] = useState(false);
  const [sellSize, setSellSize] = useState("");
  const [sales, setSales] = useState<Sale[]>([]);
  const visible = alerts.filter((alert) => alert.book === book);
  const sellBid = livePrice(rows, "bid");
  const sellAmount = Number(sellSize);
  const sellReady = sellBid != null && Number.isFinite(sellAmount) && sellAmount > 0;
  const marketName = book === "spot" ? "BTCUSD" : "BTCGUSDPERP";

  useEffect(() => {
    let stopped = false;
    setRows([]);
    setStatus("connecting");
    setError("");
    if (spec.kind === "rest") {
      const load = async () => {
        try {
          const response = await fetch(`/api/gemini/public?book=${book}&view=${spec.id}`, { cache: "no-store" });
          const body = await response.json() as { ok?: boolean; error?: string; rows?: Row[] };
          if (stopped) return;
          if (!response.ok || !body.ok || !body.rows?.length) {
            setStatus("error");
            setError(body.error ?? "Gemini REST is not connected.");
            return;
          }
          setRows(body.rows);
          setStatus("live");
          setError("");
        } catch {
          if (!stopped) {
            setStatus("error");
            setError("Gemini REST is not connected.");
          }
        }
      };
      void load();
      const timer = setInterval(() => void load(), 5_000);
      return () => {
        stopped = true;
        clearInterval(timer);
      };
    }
    let socket: WebSocket | null = null;
    let retry: ReturnType<typeof setTimeout> | null = null;
    const connect = () => {
      if (stopped) return;
      socket = new WebSocket(spec.address);
      socket.onopen = () => {
        if (spec.request.startsWith("{")) socket?.send(spec.request);
      };
      socket.onmessage = (message) => {
        let body: { type?: string };
        try { body = JSON.parse(String(message.data)); } catch { return; }
        if (body.type === "heartbeat") return;
        const next = explainGemini(spec.id, book, body) as Row[] | null;
        if (!next || stopped) return;
        setRows(next);
        setStatus("live");
        setError("");
      };
      socket.onerror = () => socket?.close();
      socket.onclose = () => {
        if (stopped) return;
        setStatus("error");
        setError("Gemini websocket closed.");
        retry = setTimeout(connect, 5_000);
      };
    };
    connect();
    return () => {
      stopped = true;
      if (retry) clearTimeout(retry);
      socket?.close();
    };
  }, [book, spec.address, spec.id, spec.kind]);

  useEffect(() => {
    setAlerts((current) => {
      let changed = false;
      const next = current.map((alert) => {
        if (alert.book !== book || alert.status !== "armed") return alert;
        const live = livePrice(rows, alert.side);
        if (live == null) return alert;
        const hit = alert.direction === "above" ? live >= alert.price : live <= alert.price;
        if (!hit) return alert;
        changed = true;
        return { ...alert, status: "fired" as const, live };
      });
      return changed ? next : current;
    });
  }, [book, rows]);

  return (
    <div className="cex-detail">
      <ul className="cex-limits">{conditions.map((line) => <li key={line}>{line}</li>)}</ul>
      <div className="cex-books" role="group" aria-label={`Gemini ${book} connections`}>
        {connections.map((item) => (
          <button key={item.id} type="button" className="button button-dark" aria-pressed={item.id === spec.id} onClick={() => setSelected(item.id)}>
            {item.kind === "rest" ? "REST" : "WebSocket"} · {item.channel}
          </button>
        ))}
      </div>
      {sales.filter((sale) => sale.book === book).map((sale) => (
        <p key={sale.id} className="notice notice-warn" role="status">
          Paper sell {sale.size} {marketName} at bid {sale.price}. Quote {sale.quote.toFixed(2)}. No order was sent.
          <button type="button" onClick={() => setSales((current) => current.filter((item) => item.id !== sale.id))}>Dismiss</button>
        </p>
      ))}
      {visible.filter((alert) => alert.status === "fired").map((alert) => (
        <p key={alert.id} className="notice notice-warn" role="status">
          {book === "spot" ? "BTCUSD" : "BTCGUSDPERP"} {alert.kind === "stop" ? `stop loss hit at ${alert.price}.` : alert.kind === "profit" ? `take profit hit at ${alert.price}.` : `${alert.side} is ${alert.direction} ${alert.price}.`} Live price {alert.live}. No order was sent.
          <button type="button" onClick={() => setAlerts((current) => current.filter((item) => item.id !== alert.id))}>Dismiss</button>
        </p>
      ))}
      {visible.some((alert) => alert.status === "armed") ? (
        <ul className="cex-limits">
          {visible.filter((alert) => alert.status === "armed").map((alert) => (
            <li key={alert.id}>{alert.kind === "stop" ? `Stop loss if best bid falls to ${alert.price}.` : alert.kind === "profit" ? `Take profit if best bid rises to ${alert.price}.` : `Watching ${alert.side} ${alert.direction} ${alert.price}.`} <button type="button" onClick={() => setAlerts((current) => current.filter((item) => item.id !== alert.id))}>Remove</button></li>
          ))}
        </ul>
      ) : null}
      <article className="card">
        <header className="card-head">
          <div>
            <span className="eyebrow">HOW THIS DATA ARRIVES</span>
            <h3>{spec.kind === "rest" ? "REST API" : "WebSocket"} · {spec.channel}</h3>
          </div>
          <EvidencePill status={status} source={spec.address} seenAt={seenAt} />
          <div className="card-actions">
            <button className="button button-accent" type="button" aria-expanded={alertOpen} onClick={() => { setAlertOpen((open) => !open); setStopOpen(false); setProfitOpen(false); setSellOpen(false); }}>Set price alert</button>
            <button className="button button-stop" type="button" aria-expanded={stopOpen} onClick={() => { setStopOpen((open) => !open); setAlertOpen(false); setProfitOpen(false); setSellOpen(false); }}>Set stop loss</button>
            <button className="button button-accent" type="button" aria-expanded={profitOpen} onClick={() => { setProfitOpen((open) => !open); setAlertOpen(false); setStopOpen(false); setSellOpen(false); }}>Set take profit</button>
            <button className="button button-stop" type="button" aria-expanded={sellOpen} onClick={() => { setSellOpen((open) => !open); setAlertOpen(false); setStopOpen(false); setProfitOpen(false); }}>{sellBid == null ? "Sell" : `Sell ${sellBid}`}</button>
          </div>
        </header>
        {alertOpen ? (
          <form className="alert-form" onSubmit={(event) => {
            event.preventDefault();
            const price = Number(draft);
            if (!Number.isFinite(price) || price <= 0) return;
            setAlerts((current) => [...current, { id: crypto.randomUUID(), book, side, direction, kind: "alert", price, status: "armed" }]);
            setDraft("");
            setAlertOpen(false);
          }}>
            <span>Alert when this {book} {side} is {direction}</span>
            <input aria-label="Alert price" inputMode="decimal" value={draft} onChange={(event) => setDraft(event.target.value)} placeholder="Price" />
            <select aria-label="Alert side" value={side} onChange={(event) => setSide(event.target.value as "bid" | "ask")}>
              <option value="bid">Best bid</option>
              <option value="ask">Best ask</option>
            </select>
            <select aria-label="Alert direction" value={direction} onChange={(event) => setDirection(event.target.value as "above" | "below")}>
              <option value="above">Above</option>
              <option value="below">Below</option>
            </select>
            <button className="button button-dark" type="submit">Save alert</button>
          </form>
        ) : null}
        {stopOpen ? (
          <form className="alert-form" onSubmit={(event) => {
            event.preventDefault();
            const price = Number(stopDraft);
            if (!Number.isFinite(price) || price <= 0) return;
            setAlerts((current) => [...current, { id: crypto.randomUUID(), book, side: "bid", direction: "below", kind: "stop", price, status: "armed" }]);
            setStopDraft("");
            setStopOpen(false);
          }}>
            <span>Stop if this {book} best bid falls to</span>
            <input aria-label="Stop loss price" inputMode="decimal" value={stopDraft} onChange={(event) => setStopDraft(event.target.value)} placeholder="Stop price" />
            <button className="button button-stop" type="submit">Save stop loss</button>
          </form>
        ) : null}
        {profitOpen ? (
          <form className="alert-form" onSubmit={(event) => {
            event.preventDefault();
            const price = Number(profitDraft);
            if (!Number.isFinite(price) || price <= 0) return;
            setAlerts((current) => [...current, { id: crypto.randomUUID(), book, side: "bid", direction: "above", kind: "profit", price, status: "armed" }]);
            setProfitDraft("");
            setProfitOpen(false);
          }}>
            <span>Take profit if this {book} best bid rises to</span>
            <input aria-label="Take profit price" inputMode="decimal" value={profitDraft} onChange={(event) => setProfitDraft(event.target.value)} placeholder="Target price" />
            <button className="button button-accent" type="submit">Save take profit</button>
          </form>
        ) : null}
        {sellOpen ? (
          <form className="alert-form" onSubmit={(event) => {
            event.preventDefault();
            if (!sellReady || sellBid == null) return;
            setSales((current) => [{ id: crypto.randomUUID(), book, size: sellAmount, price: sellBid, quote: sellAmount * sellBid }, ...current]);
            setSellSize("");
            setSellOpen(false);
          }}>
            <span>{sellBid == null ? "Best bid is not on this book yet." : `${marketName} best bid is ${sellBid}. ${sellReady ? `Quote ${ (sellAmount * sellBid).toFixed(2) }.` : ""} No order is sent.`}</span>
            <input aria-label="Sell size" inputMode="decimal" value={sellSize} onChange={(event) => setSellSize(event.target.value)} placeholder="BTC size" />
            <button className="button button-stop" type="submit" disabled={!sellReady}>{sellReady ? `Sell ${sellAmount} BTC` : "Sell"}</button>
          </form>
        ) : null}
        <div className="stat-line"><span>Address</span><b className="mono">{spec.address}</b></div>
        <div className="stat-line"><span>Request</span><b className="mono">{spec.request}</b></div>
        <div className="stat-line"><span>Used on</span><b>{spec.where}</b></div>
        {spec.kind === "ws" ? (
          <SocketDetails rows={[
            { label: "Address", value: spec.address },
            { label: "Subscribe", value: spec.request },
            { label: "Heartbeat", value: spec.channel === "marketdata" ? "The server sends type heartbeat. That frame is ignored." : "No client ping. A frame for the other symbol is ignored." },
            { label: "Auth", value: "None. wss://api.gemini.com/v1/order/events is not opened." },
            { label: "Reconnect", value: "5 seconds after the socket closes" },
          ]} />
        ) : null}
        {error ? <p className="notice notice-error">{error}</p> : null}
        {spec.channel === "depth10@100ms" ? <DepthBook rows={rows} /> : null}
        <div className="table-scroll">
          <table>
            <thead><tr><th>Field</th><th>Value now</th><th>What it is</th></tr></thead>
            <tbody>
              {rows.length ? rows.map((item) => (
                <tr key={item.field}><td className="mono">{item.field}</td><td className="mono">{item.value}</td><td>{item.meaning}</td></tr>
              )) : <tr><td colSpan={3}>No accepted frame yet.</td></tr>}
            </tbody>
          </table>
        </div>
      </article>
    </div>
  );
}
