"use client";

import { useState } from "react";
import {
  BYBIT_LINEAR,
  BYBIT_SPOT,
} from "../../../services/bybit-public.mjs";
import {
  BINANCE_FUTURES_FIELDS,
  BINANCE_FUTURES_SOCKET,
  BINANCE_SPOT_FIELDS,
  BINANCE_SPOT_SOCKET,
  CEX_RANK_NOTE,
  CEX_VENUES,
} from "../../../services/cex-catalog.mjs";
import { DexPlan } from "./dex-plan";
import { ExchangeTools } from "./exchange-tools";
import { BitfinexFeed } from "./bitfinex-feed";
import { BitgetFeed } from "./bitget-feed";
import { BitstampFeed } from "./bitstamp-feed";
import { BybitBook } from "./bybit-book";
import { CoinbaseFeed } from "./coinbase-feed";
import { CryptoComFeed } from "./crypto-com-feed";
import { GateFeed } from "./gate-feed";
import { GeminiFeed } from "./gemini-feed";
import { HtxFeed } from "./htx-feed";
import { IntelligenceDesk } from "./intelligence-desk";
import { MexcFeed } from "./mexc-feed";
import { KrakenFeed } from "./kraken-feed";
import { KucoinFeed } from "./kucoin-feed";
import { OkxFeed } from "./okx-feed";
import { parseFuture, parseSpot, useSocketFeed, type FutureValue, type SpotValue } from "./market-feed";
import { SpotApiV3 } from "./spot-api-v3";
import { UpbitFeed } from "./upbit-feed";
import { SocketDetails } from "./socket-details";

type BookName = "spot" | "futures";
type Venue = (typeof CEX_VENUES)[number];
type BookPlan = Venue["spot"];

function doneCount(plan: BookPlan) {
  return plan.steps.filter((step) => step.done).length;
}

function SpotLive() {
  const feed = useSocketFeed<SpotValue>(
    "wss://data-stream.binance.vision:443/stream?streams=btcusdt@trade/btcusdt@bookTicker",
    parseSpot,
  );
  const last = feed.value?.trades[0];
  const down = feed.status !== "live";
  return (
    <div className="cex-live">
      <p className="muted tiny">{BINANCE_SPOT_SOCKET.origin}/stream · trade + bookTicker · BTCUSDT</p>
      <SocketDetails rows={[
        { label: "Address", value: `${BINANCE_SPOT_SOCKET.origin}/stream?streams=btcusdt@trade/btcusdt@bookTicker` },
        { label: "Subscribe", value: "Streams are in the URL. No subscribe message is sent." },
        { label: "Heartbeat", value: "Server ping every 20 seconds. Pong is required within 1 minute." },
        { label: "Auth", value: "None. No API key and no order route." },
        { label: "Stale", value: "Reconnecting if no frame arrives for 10 seconds" },
        { label: "Reconnect", value: "Starts at 1 second and doubles, capped at 15 seconds" },
      ]} />
      <div className="stat-line"><span>Socket</span><b className={down ? "status-blocked" : "status-implemented"}>{down ? `ERROR · ${feed.status}` : "LIVE"}</b></div>
      <div className="stat-line"><span>Book update</span><b>{feed.value?.bookUpdateId ?? "—"}</b></div>
      <div className="stat-line"><span>Bid / ask</span><b>{feed.value?.bid ?? "—"} / {feed.value?.ask ?? "—"}</b></div>
      <div className="stat-line"><span>Last trade</span><b>{last ? `${last.tradeId ?? "—"} · ${last.price} · ${last.qty}` : "—"}</b></div>
    </div>
  );
}

function FuturesLive() {
  const feed = useSocketFeed<FutureValue>(
    "wss://fstream.binance.com/market/stream?streams=btcusdt@markPrice@1s",
    parseFuture,
  );
  const value = feed.value;
  const down = feed.status !== "live";
  return (
    <div className="cex-live">
      <p className="muted tiny">{BINANCE_FUTURES_SOCKET.origin}/stream · markPrice@1s · BTCUSDT</p>
      <SocketDetails rows={[
        { label: "Address", value: `${BINANCE_FUTURES_SOCKET.origin}/stream?streams=btcusdt@markPrice@1s` },
        { label: "Subscribe", value: "The stream is in the URL. No subscribe message is sent." },
        { label: "Heartbeat", value: "Server ping every 3 minutes. Pong is required within 10 minutes." },
        { label: "Auth", value: "None. No API key and no order route." },
        { label: "Stale", value: "Reconnecting if no frame arrives for 10 seconds" },
        { label: "Reconnect", value: "Starts at 1 second and doubles, capped at 15 seconds" },
      ]} />
      <div className="stat-line"><span>Socket</span><b className={down ? "status-blocked" : "status-implemented"}>{down ? `ERROR · ${feed.status}` : "LIVE"}</b></div>
      <div className="stat-line"><span>Mark / index</span><b>{value?.mark ?? "—"} / {value?.index ?? "—"}</b></div>
      <div className="stat-line"><span>Funding / average</span><b>{value?.funding ?? "—"} / {value?.markAverage ?? "—"}</b></div>
      <div className="stat-line"><span>Settle estimate</span><b>{value?.settle ?? "—"}</b></div>
    </div>
  );
}

function BookDetail({ venue, book }: { venue: Venue; book: BookName }) {
  const [binanceSpotSource, setBinanceSpotSource] = useState<"stream" | "v3">("stream");
  const plan = book === "spot" ? venue.spot : venue.futures;
  const spec = plan.feed === "binance-spot"
    ? { conditions: BINANCE_SPOT_SOCKET.conditions, fields: BINANCE_SPOT_FIELDS }
    : plan.feed === "binance-futures"
      ? { conditions: BINANCE_FUTURES_SOCKET.conditions, fields: BINANCE_FUTURES_FIELDS }
      : plan.feed === "bybit-spot"
        ? BYBIT_SPOT
        : plan.feed === "bybit-linear"
          ? BYBIT_LINEAR
          : { conditions: [], fields: [] };
  const title = book === "spot" ? "SPOT" : "FUTURES";
  const complete = doneCount(plan);
  const live = plan.state === "live";
  return (
    <article className="card" aria-live="polite">
      <header className="card-head">
        <div>
          <span className="eyebrow">{venue.name} · {title} ONLY</span>
          <h3>{venue.name} {book} API</h3>
        </div>
        <span className={live ? "pill pill-live" : "pill pill-warn"}>{live ? "LIVE" : "ERROR"}</span>
      </header>
      <p className="muted tiny">Plan {complete}/{plan.steps.length}. Another exchange's fields are not shown here.</p>
      {plan.error ? <div className="notice notice-error"><b>{venue.name} {book}</b><span>{plan.error}</span></div> : null}
      {live ? <ExchangeTools venue={venue.id} book={book === "spot" ? "spot" : "futures"} /> : null}
      <ul className="cex-limits">
        {plan.steps.map((step) => (
          <li key={step.name} className={step.done ? "status-implemented" : "status-blocked"}>{step.done ? "Done" : "Error"} · {step.name}</li>
        ))}
      </ul>
      <h4>Used on this website</h4>
      {plan.uses.length === 0 ? <p className="notice notice-error">Nowhere. This API is not wired into Market, DEX, Wallets, or Paper.</p> : (
        <ul className="cex-limits">{plan.uses.map((place) => <li key={place}>{place}</li>)}</ul>
      )}
      </article>
  );
}

export function CexDesk() {
  const [mode, setMode] = useState<"exchanges" | "intelligence" | "dex">("exchanges");
  const [venueId, setVenueId] = useState<string | null>(null);
  const [book, setBook] = useState<BookName>("spot");
  const venue = CEX_VENUES.find((item) => item.id === venueId) ?? null;

  function chooseVenue(id: string) {
    setMode("exchanges");
    setVenueId(id);
    setBook("spot");
  }

  return (
    <section className="cex-desk" aria-label="Centralized exchanges">
      <div className="section-intro">
        <div>
          <span className="eyebrow">ADMIN · ONE VENUE AT A TIME</span>
          <h2>Connection plan</h2>
          <p>एक एक्सचेंज चुनें। Spot और Futures अलग खुलते हैं। जो API नहीं जुड़ी, वह error है। Binance Intelligence अलग ऐप है।</p>
        </div>
      </div>
      <div className="cex-books" role="group" aria-label="Desk mode">
        <button type="button" className="button button-accent" aria-pressed={mode === "exchanges"} onClick={() => setMode("exchanges")}>15 exchanges</button>
        <button type="button" className="button button-dark" aria-pressed={mode === "dex"} onClick={() => { setMode("dex"); setVenueId(null); }}>Ethereum DEX</button>
        <button type="button" className="button button-dark" aria-pressed={mode === "intelligence"} onClick={() => { setMode("intelligence"); setVenueId(null); }}>Binance Intelligence</button>
      </div>
      {mode === "intelligence" ? <IntelligenceDesk /> : mode === "dex" ? <DexPlan /> : (
        <div className="cex-pick">
          <article className="card">
            <p className="muted tiny">{CEX_RANK_NOTE}</p>
            <div className="cex-venue-list">
              {CEX_VENUES.map((item) => (
                <button key={item.id} type="button" aria-pressed={item.id === venueId} onClick={() => chooseVenue(item.id)}>
                  <b>{item.rank}. {item.name}</b>
                  <small>{item.spot.state === "live" ? "Spot live" : "Spot error"} · {item.futures.state === "live" ? "Futures live" : "Futures error"}</small>
                </button>
              ))}
            </div>
          </article>
          {venue ? (
            <div className="cex-detail">
              <div className="cex-books" role="group" aria-label={`${venue.name} book`}>
                <button type="button" className="button button-accent" aria-pressed={book === "spot"} onClick={() => setBook("spot")}>{venue.name} Spot</button>
                <button type="button" className="button button-dark" aria-pressed={book === "futures"} onClick={() => setBook("futures")}>{venue.name} Futures</button>
              </div>
              <BookDetail key={`${venue.id}-${book}`} venue={venue} book={book} />
            </div>
          ) : <article className="card"><h3>Select one exchange</h3><p className="muted">No API history is open. Mixed venue data stays hidden until you click a name.</p></article>}
        </div>
      )}
    </section>
  );
}
