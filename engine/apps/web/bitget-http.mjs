import { BITGET_ORIGIN, explainBitget } from "../../services/bitget-public.mjs";

const PATHS = Object.freeze({
  "spot:rest-ticker": "/api/v2/spot/market/tickers?symbol=BTCUSDT",
  "spot:rest-book": "/api/v2/spot/market/orderbook?symbol=BTCUSDT&limit=1",
  "futures:rest-ticker": "/api/v2/mix/market/ticker?productType=USDT-FUTURES&symbol=BTCUSDT",
});

export async function getBitgetPublic(request) {
  const params = new URL(request.url).searchParams;
  const book = params.get("book") ?? "";
  const view = params.get("view") ?? "";
  const path = PATHS[`${book}:${view}`];
  if (!path) return Response.json({ ok: false, error: "Bitget connection is not on this page." }, { status: 400 });
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8_000);
  try {
    const upstream = await fetch(`${BITGET_ORIGIN}${path}`, { headers: { accept: "application/json" }, cache: "no-store", signal: controller.signal });
    if (!upstream.ok) return Response.json({ ok: false, error: "Bitget REST is not connected." }, { status: 502 });
    const rows = explainBitget(view, book, await upstream.json());
    if (!rows) return Response.json({ ok: false, error: "Bitget returned a frame this page does not accept." }, { status: 502 });
    return Response.json({ ok: true, rows });
  } catch {
    return Response.json({ ok: false, error: "Bitget REST is not connected." }, { status: 502 });
  } finally {
    clearTimeout(timeout);
  }
}
