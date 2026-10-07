import { MEXC_FUTURES_ORIGIN, MEXC_SPOT_ORIGIN, explainMexc } from "../../services/mexc-public.mjs";

const PATHS = Object.freeze({
  "spot:rest-book": `${MEXC_SPOT_ORIGIN}/api/v3/ticker/bookTicker?symbol=BTCUSDT`,
  "spot:rest-ticker": `${MEXC_SPOT_ORIGIN}/api/v3/ticker/24hr?symbol=BTCUSDT`,
  "futures:rest-ticker": `${MEXC_FUTURES_ORIGIN}/api/v1/contract/ticker?symbol=BTC_USDT`,
  "futures:rest-funding": `${MEXC_FUTURES_ORIGIN}/api/v1/contract/funding_rate/BTC_USDT`,
});

export async function getMexcPublic(request) {
  const params = new URL(request.url).searchParams;
  const book = params.get("book") ?? "";
  const view = params.get("view") ?? "";
  const url = PATHS[`${book}:${view}`];
  if (!url) return Response.json({ ok: false, error: "MEXC connection is not on this page." }, { status: 400 });
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8_000);
  try {
    const upstream = await fetch(url, { headers: { accept: "application/json" }, cache: "no-store", signal: controller.signal });
    if (!upstream.ok) return Response.json({ ok: false, error: "MEXC REST is not connected." }, { status: 502 });
    const rows = explainMexc(view, book, await upstream.json());
    if (!rows) return Response.json({ ok: false, error: "MEXC returned a frame this page does not accept." }, { status: 502 });
    return Response.json({ ok: true, rows });
  } catch {
    return Response.json({ ok: false, error: "MEXC REST is not connected." }, { status: 502 });
  } finally {
    clearTimeout(timeout);
  }
}
