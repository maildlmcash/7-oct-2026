"use client";

import { useEffect, useState } from "react";
import { EvidencePill, useObservedStatus } from "./feed-evidence";
import { SocketDetails } from "./socket-details";
import {
  OKX_CONDITIONS,
  OKX_PUBLIC_WS,
  OKX_SPOT_CONNECTIONS,
  OKX_SWAP_CONNECTIONS,
  explainOkx,
} from "../../../services/okx-public.mjs";

type Row = { field: string; value: string; meaning: string };
type Spec = (typeof OKX_SPOT_CONNECTIONS)[number];

export function OkxFeed({ book }: { book: "spot" | "swap" }) {
  const connections = book === "spot" ? OKX_SPOT_CONNECTIONS : OKX_SWAP_CONNECTIONS;
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
      let timer: ReturnType<typeof setInterval> | null = null;
      const load = async () => {
        try {
          const response = await fetch(`/api/okx/ticker?instId=${spec.instId}`, { cache: "no-store" });
          const body = await response.json() as { ok?: boolean; error?: string; rows?: Row[] };
          if (stopped) return;
          if (!response.ok || !body.ok || !body.rows?.length) {
            setStatus("error");
            setError(body.error ?? "OKX REST ticker is not connected.");
            return;
          }
          setRows(body.rows);
          setStatus("live");
          setError("");
        } catch {
          if (!stopped) {
            setStatus("error");
            setError("OKX REST ticker is not connected.");
          }
        }
      };
      void load();
      timer = setInterval(() => void load(), 5_000);
      return () => {
        stopped = true;
        if (timer) clearInterval(timer);
      };
    }
    let socket: WebSocket | null = null;
    let ping: ReturnType<typeof setInterval> | null = null;
    let retry: ReturnType<typeof setTimeout> | null = null;
    const connect = () => {
      if (stopped) return;
      socket = new WebSocket(OKX_PUBLIC_WS);
      socket.onopen = () => {
        socket?.send(spec.request);
        ping = setInterval(() => {
          if (socket?.readyState === WebSocket.OPEN) socket.send("ping");
        }, 20_000);
      };
      socket.onmessage = (message) => {
        const text = String(message.data);
        if (text === "pong") return;
        let body: unknown;
        try {
          body = JSON.parse(text);
        } catch {
          return;
        }
        const next = explainOkx(spec.id, book, body) as Row[] | null;
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
        setError("OKX websocket closed.");
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
  }, [book, spec.id, spec.instId, spec.kind, spec.request]);

  return (
    <div className="cex-detail">
      <ul className="cex-limits">{OKX_CONDITIONS.map((line) => <li key={line}>{line}</li>)}</ul>
      <div className="cex-books" role="group" aria-label={`OKX ${book} connections`}>
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
            { label: "Heartbeat", value: "Text frame ping every 20 seconds. Text frame pong is ignored." },
            { label: "Auth", value: "None. The private socket is not opened." },
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
