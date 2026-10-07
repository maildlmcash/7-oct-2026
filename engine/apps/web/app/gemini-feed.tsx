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

type Row = { field: string; value: string; meaning: string };
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
      <article className="card">
        <header className="card-head">
          <div>
            <span className="eyebrow">HOW THIS DATA ARRIVES</span>
            <h3>{spec.kind === "rest" ? "REST API" : "WebSocket"} · {spec.channel}</h3>
          </div>
          <EvidencePill status={status} source={spec.address} seenAt={seenAt} />
        </header>
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
