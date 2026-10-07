"use client";

import { useEffect, useState } from "react";
import {
  MEXC_FUTURE_CONDITIONS,
  MEXC_FUTURE_CONNECTIONS,
  MEXC_SPOT_CONDITIONS,
  MEXC_SPOT_CONNECTIONS,
  explainMexc,
} from "../../../services/mexc-public.mjs";
import { SocketDetails } from "./socket-details";

type Row = { field: string; value: string; meaning: string };
type Spec = (typeof MEXC_SPOT_CONNECTIONS)[number];

export function MexcFeed({ book }: { book: "spot" | "futures" }) {
  const connections = book === "spot" ? MEXC_SPOT_CONNECTIONS : MEXC_FUTURE_CONNECTIONS;
  const conditions = book === "spot" ? MEXC_SPOT_CONDITIONS : MEXC_FUTURE_CONDITIONS;
  const [selected, setSelected] = useState(connections[0].id);
  const spec = connections.find((item) => item.id === selected) ?? connections[0];
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
          const response = await fetch(`/api/mexc/public?book=${book}&view=${spec.id}`, { cache: "no-store" });
          const body = await response.json() as { ok?: boolean; error?: string; rows?: Row[] };
          if (stopped) return;
          if (!response.ok || !body.ok || !body.rows?.length) {
            setStatus("error");
            setError(body.error ?? "MEXC REST is not connected.");
            return;
          }
          setRows(body.rows);
          setStatus("live");
          setError("");
        } catch {
          if (!stopped) {
            setStatus("error");
            setError("MEXC REST is not connected.");
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
    const connect = () => {
      if (stopped) return;
      socket = new WebSocket(spec.address);
      socket.onopen = () => {
        socket?.send(spec.request);
        if (book === "futures") {
          ping = setInterval(() => {
            if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ method: "ping" }));
          }, 15_000);
        }
      };
      socket.onmessage = (message) => {
        let body: { msg?: string; channel?: string };
        try { body = JSON.parse(String(message.data)); } catch { return; }
        if (body.channel === "pong") return;
        if (typeof body.msg === "string" && body.msg.length > 0) {
          setStatus("error");
          setError(body.msg);
          setRows([]);
          return;
        }
        const next = explainMexc(spec.id, book, body) as Row[] | null;
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
        setStatus((current) => (current === "error" ? current : "error"));
        setError((current) => current || "MEXC websocket closed.");
        retry = setTimeout(connect, 5_000);
      };
    };
    connect();
    return () => {
      stopped = true;
      if (ping) clearInterval(ping);
      if (retry) clearTimeout(retry);
      socket?.close();
    };
  }, [book, spec.address, spec.id, spec.kind, spec.request]);

  return (
    <div className="cex-detail">
      <ul className="cex-limits">{conditions.map((line) => <li key={line}>{line}</li>)}</ul>
      <div className="cex-books" role="group" aria-label={`MEXC ${book} connections`}>
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
            { label: "Subscribe", value: spec.request },
            { label: "Heartbeat", value: book === "futures" ? "JSON {\"method\":\"ping\"} every 15 seconds" : "No client ping. The server may refuse the public JSON channel." },
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
