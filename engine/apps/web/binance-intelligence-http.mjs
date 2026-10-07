import { BINANCE_INTELLIGENCE } from "../../services/cex-catalog.mjs";

function line(field, value, meaning) {
  return { field, value: String(value), meaning };
}

function explain(product, body) {
  if (product.call === "ticker") {
    if (body?.symbol !== "BTCUSDT" || body.lastPrice == null) return null;
    return [
      line("symbol", body.symbol, "Spot symbol"),
      line("lastPrice", body.lastPrice, "Last trade price"),
      line("priceChangePercent", body.priceChangePercent, "24 hour change, percent"),
      line("bidPrice", body.bidPrice, "Best bid"),
      line("askPrice", body.askPrice, "Best ask"),
    ];
  }
  if (product.call === "klines") {
    const candle = Array.isArray(body) ? body.at(-1) : null;
    if (!Array.isArray(candle) || candle.length < 5) return null;
    return [
      line("symbol", "BTCUSDT", "Spot symbol on this call"),
      line("open", candle[1], "1 minute open"),
      line("high", candle[2], "1 minute high"),
      line("low", candle[3], "1 minute low"),
      line("close", candle[4], "1 minute close"),
    ];
  }
  if (product.call === "depth") {
    const bid = body?.bids?.[0];
    const ask = body?.asks?.[0];
    if (!Array.isArray(bid) || !Array.isArray(ask)) return null;
    return [
      line("symbol", "BTCUSDT", "Spot symbol on this call"),
      line("bid", bid[0], "Best bid"),
      line("bidQty", bid[1], "Best bid size"),
      line("ask", ask[0], "Best ask"),
      line("askQty", ask[1], "Best ask size"),
    ];
  }
  return null;
}

export async function getBinanceIntelligence(request) {
  const id = new URL(request.url).searchParams.get("product") ?? "";
  const product = BINANCE_INTELLIGENCE.products.find((item) => item.id === id);
  if (!product) return Response.json({ ok: false, error: "This Binance Intelligence call is not on the menu." }, { status: 400 });
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8_000);
  try {
    const upstream = await fetch(product.address, { headers: { accept: "application/json" }, cache: "no-store", signal: controller.signal });
    if (!upstream.ok) return Response.json({ ok: false, id: product.id, error: "Public market call is not connected." }, { status: 502 });
    const rows = explain(product, await upstream.json());
    if (!rows) return Response.json({ ok: false, id: product.id, error: "The response was not BTCUSDT." }, { status: 502 });
    return Response.json({ ok: true, id: product.id, rows });
  } catch {
    return Response.json({ ok: false, id: product.id, error: "Public market call is not connected." }, { status: 502 });
  } finally {
    clearTimeout(timeout);
  }
}
