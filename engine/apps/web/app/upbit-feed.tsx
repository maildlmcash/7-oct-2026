"use client";

import { useEffect, useState } from "react";
import { UPBIT_PUBLIC_WS, UPBIT_SPOT_CONDITIONS, UPBIT_SPOT_CONNECTIONS, explainUpbit } from "../../../services/upbit-public.mjs";
import { SocketDetails } from "./socket-details";

type Row = { field: string; value: string; meaning: string };
type Spec = (typeof UPBIT_SPOT_CONNECTIONS)[number];

export function UpbitFeed() {
  const [selected, setSelected] = useState(UPBIT_SPOT_CONNECTIONS[0].id);
  const spec = UPBIT_SPOT_CONNECTIONS.find((item) => item.id === selected) ?? UPBIT_SPOT_CONNECTIONS[0];
  const [rows, setRows] = useState<Row[]>([]);
  const [status, setStatus] = useState<"connecting" | "live" | "error">("connecting");
  const [error, setError] = useState("");

  useEffect(() => {
    let stopped = false;
    setRows([]);
    setStatus("connecting");
    setError("");
    if (spec.kind === "rest") {
      const load = async () => {
        try {
          const response = await fetch(`/api/upbit/public?view=${spec.id}`, { cache: "no-store" });
          const body = await response.json() as { ok?: boolean; error?: string; rows?: Row[] };
          if (stopped) return;
          if (!response.ok || !body.ok || !body.rows?.length) {
            setStatus("error");
            setError(body.error ?? "Upbit REST is not connected.");
            return;
          }
          setRows(body.rows);
          setStatus("live");
          setError("");
        } catch {
          if (!stopped) {
            setStatus("error");
            setError("Upbit REST is not connected.");
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
      socket = new WebSocket(UPBIT_PUBLIC_WS);
      socket.binaryType = "arraybuffer";
      socket.onopen = () => socket?.send(spec.request);
      socket.onmessage = (message) => {
        void (async () => {
          const text = typeof message.data === "string" ? message.data : new TextDecoder().decode(message.data as ArrayBuffer);
          let body: unknown;
          try { body = JSON.parse(text); } catch { return; }
          const next = explainUpbit(spec.id, body) as Row[] | null;
          if (!next || stopped) return;
          setRows(next);
          setStatus("live");
          setError("");
        })();
      };
      socket.onerror = () => socket?.close();
      socket.onclose = () => {
        if (stopped) return;
        setStatus("error");
        setError("Upbit websocket closed.");
        retry = setTimeout(connect, 5_000);
      };
    };
    connect();
    return () => {
      stopped = true;
      if (retry) clearTimeout(retry);
      socket?.close();
    };
  }, [spec.id, spec.kind, spec.request]);

  return (
    <div className="cex-detail">
      <ul className="cex-limits">{UPBIT_SPOT_CONDITIONS.map((line) => <li key={line}>{line}</li>)}</ul>
      <div className="cex-books" role="group" aria-label="Upbit spot connections">
        {UPBIT_SPOT_CONNECTIONS.map((item) => (
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
            { label: "Subscribe", value: spec.request },
            { label: "Heartbeat", value: "No client ping. Frames may arrive as binary JSON." },
            { label: "Auth", value: "None. No API key and no order route." },
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
