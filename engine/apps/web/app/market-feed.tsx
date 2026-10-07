"use client";

import { useEffect, useState } from "react";

export type FeedState<T> = { status: "connecting" | "live" | "reconnecting"; value: T | null; seenAt: number | null };

export type SpotTrade = {
  symbol: string;
  price: string;
  qty: string;
  buyerMaker: boolean;
  time: number;
  eventTime: number | null;
  tradeId: number | null;
  bestMatch: boolean | null;
};

export type SpotValue = {
  symbol: string;
  bid: string;
  bidQty: string;
  ask: string;
  askQty: string;
  bookUpdateId: number | null;
  trades: SpotTrade[];
};

export type FutureValue = {
  event: string | null;
  eventTime: number | null;
  symbol: string | null;
  mark: string;
  index: string;
  funding: string;
  nextFunding: number;
  settle: string | null;
  markAverage: string | null;
};

const EMPTY_SPOT: SpotValue = {
  symbol: "",
  bid: "—",
  bidQty: "—",
  ask: "—",
  askQty: "—",
  bookUpdateId: null,
  trades: [],
};

function asRecord(input: unknown): Record<string, unknown> | null {
  if (!input || typeof input !== "object") return null;
  const wrapped = input as { data?: unknown };
  const event = wrapped.data ?? input;
  if (!event || typeof event !== "object") return null;
  return event as Record<string, unknown>;
}

export function useSocketFeed<T>(url: string, parse: (input: unknown, prior: T | null) => T | null) {
  const [state, setState] = useState<FeedState<T>>({ status: "connecting", value: null, seenAt: null });
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  useEffect(() => {
    let stopped = false;
    let socket: WebSocket | null = null;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let attempts = 0;
    const connect = () => {
      if (stopped) return;
      setState((current) => ({ ...current, status: attempts ? "reconnecting" : "connecting" }));
      socket = new WebSocket(url);
      socket.onopen = () => {
        attempts = 0;
      };
      socket.onmessage = (message) => {
        try {
          const decoded: unknown = JSON.parse(String(message.data));
          setState((prior) => {
            const next = parse(decoded, prior.value);
            return next === null ? prior : { status: "live", value: next, seenAt: Date.now() };
          });
        } catch {
          // An invalid frame is ignored and never treated as a zero value.
        }
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
    return () => {
      stopped = true;
      if (timer) clearTimeout(timer);
      socket?.close();
    };
  }, [url, parse]);
  const fresh = state.seenAt !== null && now - state.seenAt < 10_000;
  return {
    ...state,
    status: state.status === "live" && !fresh ? ("reconnecting" as const) : state.status,
    ageSeconds: state.seenAt ? Math.max(0, Math.floor((now - state.seenAt) / 1000)) : null,
  };
}

export function parseSpot(input: unknown, prior: SpotValue | null): SpotValue | null {
  const event = asRecord(input);
  if (!event || typeof event.s !== "string") return null;
  if (event.e === "trade" && typeof event.p === "string" && typeof event.q === "string" && typeof event.T === "number") {
    const base = prior ?? EMPTY_SPOT;
    const trade: SpotTrade = {
      symbol: event.s,
      price: event.p,
      qty: event.q,
      buyerMaker: event.m === true,
      time: event.T,
      eventTime: typeof event.E === "number" ? event.E : null,
      tradeId: typeof event.t === "number" ? event.t : null,
      bestMatch: typeof event.M === "boolean" ? event.M : null,
    };
    return { ...base, symbol: event.s, trades: [trade, ...base.trades].slice(0, 12) };
  }
  if (typeof event.b === "string" && typeof event.B === "string" && typeof event.a === "string" && typeof event.A === "string") {
    const base = prior ?? EMPTY_SPOT;
    return {
      ...base,
      symbol: event.s,
      bid: event.b,
      bidQty: event.B,
      ask: event.a,
      askQty: event.A,
      bookUpdateId: typeof event.u === "number" ? event.u : base.bookUpdateId,
    };
  }
  return null;
}

export function parseFuture(input: unknown, _prior: FutureValue | null): FutureValue | null {
  const event = asRecord(input);
  if (!event || typeof event.p !== "string" || typeof event.i !== "string" || typeof event.r !== "string" || typeof event.T !== "number") {
    return null;
  }
  return {
    event: typeof event.e === "string" ? event.e : null,
    eventTime: typeof event.E === "number" ? event.E : null,
    symbol: typeof event.s === "string" ? event.s : null,
    mark: event.p,
    index: event.i,
    funding: event.r,
    nextFunding: event.T,
    settle: typeof event.P === "string" ? event.P : null,
    markAverage: typeof event.ap === "string" ? event.ap : null,
  };
}
