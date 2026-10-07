"use client";

import { BINANCE_INTELLIGENCE } from "../../../services/cex-catalog.mjs";
import { observationLabel } from "./feed-evidence.mjs";
import { parseFuture, parseSpot, useSocketFeed, type FutureValue, type SpotValue } from "./market-feed";

function DeskBrief() {
  const spotSource = "wss://data-stream.binance.vision:443/stream?streams=btcusdt@trade/btcusdt@bookTicker";
  const futureSource = "wss://fstream.binance.com/market/stream?streams=btcusdt@markPrice@1s";
  const spot = useSocketFeed<SpotValue>(spotSource, parseSpot);
  const future = useSocketFeed<FutureValue>(futureSource, parseFuture);
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
      <div className="stat-line"><span>Spot socket</span><b className={spotDown ? "status-blocked" : "status-implemented"}>{observationLabel(spot.status, spotSource, spot.seenAt).text}</b></div>
      <div className="stat-line"><span>Last trade</span><b>{last ? `${last.price} · ${last.qty}` : "—"}</b></div>
      <div className="stat-line"><span>Bid / ask</span><b>{spot.value?.bid ?? "—"} / {spot.value?.ask ?? "—"}</b></div>
      <div className="stat-line"><span>Futures socket</span><b className={futureDown ? "status-blocked" : "status-implemented"}>{observationLabel(future.status, futureSource, future.seenAt).text}</b></div>
      <div className="stat-line"><span>Mark / funding</span><b>{future.value?.mark ?? "—"} / {future.value?.funding ?? "—"}</b></div>
      <p className="muted tiny">Used on Market only. Not sent to Binance AI, AI Pro, or Agent OS.</p>
    </article>
  );
}

export function IntelligenceDesk() {
  return (
    <div className="intel-desk">
      <article className="card">
        <span className="eyebrow">SEPARATE APP · LAUNCHED {BINANCE_INTELLIGENCE.launched}</span>
        <h3>Binance Intelligence</h3>
        <p>Binance ने 5 अक्टूबर 2026 को यह ऐप खोली: Binance AI, AI Pro, और Agent OS। इस पोर्टल का उनसे कोई सेशन नहीं है, इसलिए तीनों error हैं।</p>
      </article>
      <div className="grid grid-3">
        {BINANCE_INTELLIGENCE.products.map((product) => (
          <article className="card" key={product.id}>
            <span className="pill pill-warn">ERROR</span>
            <h3>{product.name}</h3>
            <p>{product.error}</p>
            <p className="muted tiny">Used on this website: nowhere.</p>
          </article>
        ))}
      </div>
      <DeskBrief />
    </div>
  );
}
