"use client";

import { useEffect, useState } from "react";

type Book = { symbol: string; bidPrice: string; bidQty: string; askPrice: string; askQty: string };

export function SpotApiV3({ symbol }: { symbol: string }) {
  const [book, setBook] = useState<Book | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!/^[A-Z0-9]{5,20}$/.test(symbol)) return undefined;
    let stopped = false;
    const load = async () => {
      try {
        const response = await fetch(`/api/spot/book?symbol=${symbol}`, { cache: "no-store" });
        const body = await response.json() as { ok?: boolean; error?: string; book?: Book };
        if (stopped) return;
        if (!response.ok || !body.ok || !body.book) {
          setBook(null);
          setError(body.error ?? "Spot API v3 is not connected");
          return;
        }
        setError("");
        setBook(body.book);
      } catch {
        if (!stopped) {
          setBook(null);
          setError("Spot API v3 is not connected");
        }
      }
    };
    void load();
    const timer = setInterval(() => void load(), 5_000);
    return () => {
      stopped = true;
      clearInterval(timer);
    };
  }, [symbol]);

  return (
    <div className="cex-live">
      <h4>Spot API v3</h4>
      <p className="muted tiny">GET /api/v3/ticker/bookTicker · {symbol} · same Binance Spot book, separate from the push stream. No order route.</p>
      <div className="stat-line"><span>API</span><b className={book && !error ? "status-implemented" : "status-blocked"}>{book && !error ? "LIVE" : "ERROR"}</b></div>
      {error ? <p className="notice notice-error">{error}</p> : null}
      <div className="stat-line"><span>Bid / ask</span><b>{book ? `${book.bidPrice} × ${book.bidQty} / ${book.askPrice} × ${book.askQty}` : "—"}</b></div>
    </div>
  );
}
