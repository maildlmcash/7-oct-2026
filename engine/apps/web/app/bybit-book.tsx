"use client";

import { useEffect, useState } from "react";
import { BYBIT_LINEAR, BYBIT_SPOT, parseBybitBook } from "../../../services/bybit-public.mjs";
import { SocketDetails } from "./socket-details";

type Book = { bid: string; bidQty: string; ask: string; askQty: string; updateId: number };

export function BybitBook({ book }: { book: "spot" | "linear" }) {
  const spec = book === "spot" ? BYBIT_SPOT : BYBIT_LINEAR;
  const [status, setStatus] = useState<"connecting" | "live" | "error">("connecting");
  const [value, setValue] = useState<Book | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let stopped = false;
    let socket: WebSocket | null = null;
    let ping: ReturnType<typeof setInterval> | null = null;
    let retry: ReturnType<typeof setTimeout> | null = null;
    let stale: ReturnType<typeof setTimeout> | null = null;

    const armStale = () => {
      if (stale) clearTimeout(stale);
      stale = setTimeout(() => {
        if (stopped) return;
        setStatus("error");
        setError("Bybit sent no book for 10 seconds.");
      }, 10_000);
    };

    const connect = () => {
      if (stopped) return;
      socket = new WebSocket(spec.origin);
      socket.onopen = () => {
        if (stopped) return;
        socket?.send(JSON.stringify({ op: "subscribe", args: [spec.topic] }));
        ping = setInterval(() => {
          if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ op: "ping" }));
        }, 20_000);
        armStale();
      };
      socket.onmessage = (message) => {
        let body: unknown;
        try {
          body = JSON.parse(String(message.data));
        } catch {
          return;
        }
        const next = parseBybitBook(body);
        if (!next) return;
        if (stopped) return;
        setValue(next);
        setStatus("live");
        setError("");
        armStale();
      };
      socket.onerror = () => socket?.close();
      socket.onclose = () => {
        if (ping) clearInterval(ping);
        ping = null;
        if (stopped) return;
        setStatus("error");
        setError("Bybit connection closed.");
        retry = setTimeout(connect, 5_000);
      };
    };

    connect();
    return () => {
      stopped = true;
      if (ping) clearInterval(ping);
      if (retry) clearTimeout(retry);
      if (stale) clearTimeout(stale);
      socket?.close();
    };
  }, [spec.origin, spec.topic]);

  return (
    <div className="cex-live">
      <span className="eyebrow">HOW THIS DATA ARRIVES</span>
      <div className="stat-line"><span>Address</span><b className="mono">{spec.origin}</b></div>
      <div className="stat-line"><span>Request</span><b className="mono">{`{"op":"subscribe","args":["${spec.topic}"]}`}</b></div>
      <SocketDetails rows={[
        { label: "Address", value: spec.origin },
        { label: "Subscribe", value: `{"op":"subscribe","args":["${spec.topic}"]}` },
        { label: "Heartbeat", value: "JSON {\"op\":\"ping\"} every 20 seconds" },
        { label: "Auth", value: "None. The private socket is not opened." },
        { label: "Stale", value: "Error if no book arrives for 10 seconds" },
        { label: "Reconnect", value: "5 seconds after the socket closes" },
      ]} />
      <div className="stat-line"><span>Socket</span><b className={status === "live" ? "status-implemented" : "status-blocked"}>{status === "live" ? "LIVE" : `ERROR · ${status}`}</b></div>
      {error ? <p className="notice notice-error">{error}</p> : null}
      <div className="stat-line"><span>Bid / ask</span><b>{value ? `${value.bid} × ${value.bidQty} / ${value.ask} × ${value.askQty}` : "—"}</b></div>
      <div className="stat-line"><span>Update id</span><b>{value?.updateId ?? "—"}</b></div>
    </div>
  );
}
