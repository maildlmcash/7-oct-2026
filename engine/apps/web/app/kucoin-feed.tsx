"use client";

import { useEffect, useState } from "react";
import {
  KUCOIN_FUTURE_CONDITIONS,
  KUCOIN_FUTURE_CONNECTIONS,
  KUCOIN_SPOT_CONDITIONS,
  KUCOIN_SPOT_CONNECTIONS,
  explainKucoin,
} from "../../../services/kucoin-public.mjs";
import { SocketDetails } from "./socket-details";

type Row = { field: string; value: string; meaning: string };
type Spec = (typeof KUCOIN_SPOT_CONNECTIONS)[number];

export function KucoinFeed({ book }: { book: "spot" | "futures" }) {
  const connections = book === "spot" ? KUCOIN_SPOT_CONNECTIONS : KUCOIN_FUTURE_CONNECTIONS;
  const conditions = book === "spot" ? KUCOIN_SPOT_CONDITIONS : KUCOIN_FUTURE_CONDITIONS;
  const [selected, setSelected] = useState(connections[0].id);
  const spec = connections.find((item) => item.id === selected) ?? connections[0];
  const [rows, setRows] = useState<Row[]>([]);
  const [status, setStatus] = useState<"connecting" | "live" | "error">("connecting");
  const [error, setError] = useState("");
  const [pingInterval, setPingInterval] = useState("—");

  useEffect(() => {
    let stopped = false;
    setRows([]);
    setStatus("connecting");
    setError("");
    setPingInterval("—");
    if (spec.kind === "rest") {
      const load = async () => {
        try {
          const response = await fetch(`/api/kucoin/public?book=${book}&view=${spec.id}`, { cache: "no-store" });
          const body = await response.json() as { ok?: boolean; error?: string; rows?: Row[] };
          if (stopped) return;
          if (!response.ok || !body.ok || !body.rows?.length) {
            setStatus("error");
            setError(body.error ?? "KuCoin REST is not connected.");
            return;
          }
          setRows(body.rows);
          setStatus("live");
          setError("");
        } catch {
          if (!stopped) {
            setStatus("error");
            setError("KuCoin REST is not connected.");
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
    let ping: ReturnType<typeof setInterval> | null = null;
    let retry: ReturnType<typeof setTimeout> | null = null;
    const connect = async () => {
      if (stopped) return;
      try {
        const response = await fetch(`/api/kucoin/bullet?book=${book}`, { cache: "no-store" });
        const body = await response.json() as { ok?: boolean; error?: string; endpoint?: string; token?: string; pingInterval?: number };
        if (stopped) return;
        if (!response.ok || !body.ok || !body.endpoint || !body.token) {
          setStatus("error");
          setError(body.error ?? "KuCoin public websocket token is not connected.");
          retry = setTimeout(() => void connect(), 5_000);
          return;
        }
        const interval = body.pingInterval ?? 18000;
        setPingInterval(`${interval} ms`);
        const endpoint = body.endpoint.endsWith("/") ? body.endpoint : `${body.endpoint}/`;
        socket = new WebSocket(`${endpoint}?token=${encodeURIComponent(body.token)}&connectId=desk`);
        socket.onmessage = (message) => {
          let parsed: { type?: string; id?: string };
          try { parsed = JSON.parse(String(message.data)); } catch { return; }
          if (parsed.type === "welcome") {
            socket?.send(spec.request);
            ping = setInterval(() => {
              if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ id: String(Date.now()), type: "ping" }));
            }, interval);
            return;
          }
          if (parsed.type === "pong") return;
          const next = explainKucoin(spec.id, book, parsed) as Row[] | null;
          if (!next || stopped) return;
          setRows(next);
          setStatus("live");
          setError("");
        };
        socket.onerror = () => socket?.close();
        socket.onclose = () => {
          if (ping) clearInterval(ping);
          ping = null;
          if (stopped) return;
          setStatus("error");
          setError("KuCoin websocket closed.");
          retry = setTimeout(() => void connect(), 5_000);
        };
      } catch {
        if (!stopped) {
          setStatus("error");
          setError("KuCoin public websocket token is not connected.");
          retry = setTimeout(() => void connect(), 5_000);
        }
      }
    };
    void connect();
    return () => {
      stopped = true;
      if (ping) clearInterval(ping);
      if (retry) clearTimeout(retry);
      socket?.close();
    };
  }, [book, spec.id, spec.kind, spec.request]);

  return (
    <div className="cex-detail">
      <ul className="cex-limits">{conditions.map((line) => <li key={line}>{line}</li>)}</ul>
      <div className="cex-books" role="group" aria-label={`KuCoin ${book} connections`}>
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
          <span className={status === "live" ? "pill pill-live" : "pill pill-warn"}>{status === "live" ? "LIVE" : "ERROR"}</span>
        </header>
        <div className="stat-line"><span>Address</span><b className="mono">{spec.address}</b></div>
        <div className="stat-line"><span>Request</span><b className="mono">{spec.request}</b></div>
        <div className="stat-line"><span>Used on</span><b>{spec.where}</b></div>
        {spec.kind === "ws" ? (
          <SocketDetails rows={[
            { label: "Address", value: spec.address },
            { label: "Token", value: "POST /api/v1/bullet-public. Public token, not an API key. The token is not shown." },
            { label: "Subscribe", value: spec.request },
            { label: "Heartbeat", value: `JSON ping every ${pingInterval}. Server asks for pong inside the returned timeout.` },
            { label: "Auth", value: "None. Private token is not requested." },
            { label: "Reconnect", value: "5 seconds after the socket closes" },
          ]} />
        ) : null}
        {error ? <p className="notice notice-error">{error}</p> : null}
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
