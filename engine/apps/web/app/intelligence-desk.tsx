"use client";

import { useEffect, useState } from "react";
import { BINANCE_INTELLIGENCE } from "../../../services/cex-catalog.mjs";
import { parseFuture, parseSpot, useSocketFeed, type FutureValue, type SpotValue } from "./market-feed";

type Row = { field: string; value: string; meaning: string };
type Live = { ok: boolean; error?: string; rows?: Row[] };

function ProductCard({ product }: { product: (typeof BINANCE_INTELLIGENCE.products)[number] }) {
  const [live, setLive] = useState<Live | null>(null);
  useEffect(() => {
    let stopped = false;
    const load = () => {
      void fetch(`/api/binance/intelligence?product=${product.id}`, { cache: "no-store" })
        .then((response) => response.json())
        .then((body: Live) => { if (!stopped) setLive(body); })
        .catch(() => { if (!stopped) setLive({ ok: false, error: "Public market call is not connected." }); });
    };
    load();
    const timer = setInterval(load, 15_000);
    return () => { stopped = true; clearInterval(timer); };
  }, [product.id]);
  const down = live?.ok !== true;
  return (
    <article className="card">
      <span className={down ? "pill pill-warn" : "pill pill-live"}>{live == null ? "CONNECTING" : down ? "ERROR" : "LIVE"}</span>
      <h3>{product.name}</h3>
      <p className="mono tiny">{product.address}</p>
      {down && live ? <p className="notice notice-error">{live.error}</p> : null}
      {live?.rows?.map((row) => <div className="stat-line" key={row.field}><span>{row.meaning}</span><b className="mono">{row.value}</b></div>)}
      <p className="muted tiny">Planned use: {product.uses[0]}</p>
      <p className="muted tiny">{product.locked}</p>
    </article>
  );
}

function DeskBrief() {
  const spot = useSocketFeed<SpotValue>(
    "wss://data-stream.binance.vision:443/stream?streams=btcusdt@trade/btcusdt@bookTicker",
    parseSpot,
  );
  const future = useSocketFeed<FutureValue>(
    "wss://fstream.binance.com/market/stream?streams=btcusdt@markPrice@1s",
    parseFuture,
  );
  const last = spot.value?.trades[0];
  const spotDown = spot.status !== "live";
  const futureDown = future.status !== "live";
  return (
    <article className="card">
      <header className="card-head">
        <div>
          <span className="eyebrow">OUR DESK · NOT BINANCE INTELLIGENCE</span>
          <h3>Read-only BTCUSDT brief</h3>
        </div>
        <span className="pill pill-warn">ORDERS LOCKED</span>
      </header>
      <p>यह Binance की नई ऐप नहीं है। यह उसी public Binance socket का छोटा ब्रीफ है जो Market पेज पहले से पढ़ता है। कोई रणनीति नहीं चलती।</p>
      <div className="stat-line"><span>Spot socket</span><b className={spotDown ? "status-blocked" : "status-implemented"}>{spotDown ? `ERROR · ${spot.status}` : "LIVE"}</b></div>
      <div className="stat-line"><span>Last trade</span><b>{last ? `${last.price} · ${last.qty}` : "—"}</b></div>
      <div className="stat-line"><span>Bid / ask</span><b>{spot.value?.bid ?? "—"} / {spot.value?.ask ?? "—"}</b></div>
      <div className="stat-line"><span>Futures socket</span><b className={futureDown ? "status-blocked" : "status-implemented"}>{futureDown ? `ERROR · ${future.status}` : "LIVE"}</b></div>
      <div className="stat-line"><span>Mark / funding</span><b>{future.value?.mark ?? "—"} / {future.value?.funding ?? "—"}</b></div>
      <p className="muted tiny">Same public BTCUSDT numbers as the cards above. No order is sent.</p>
    </article>
  );
}

export function IntelligenceDesk() {
  return (
    <div className="intel-desk">
      <article className="card">
        <span className="eyebrow">SEPARATE APP · LAUNCHED {BINANCE_INTELLIGENCE.launched}</span>
        <h3>Binance Intelligence</h3>
        <p>Each card uses one public BTCUSDT call. No Binance login, no API key, and no order.</p>
      </article>
      <div className="grid grid-3">
        {BINANCE_INTELLIGENCE.products.map((product) => <ProductCard key={product.id} product={product} />)}
      </div>
      <DeskBrief />
    </div>
  );
}
