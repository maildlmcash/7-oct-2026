import { GATE_ORIGIN, explainGate } from "../../services/gate-public.mjs";

const PATHS = Object.freeze({
  "spot:rest-ticker": "/api/v4/spot/tickers?currency_pair=BTC_USDT",
  "spot:rest-book": "/api/v4/spot/order_book?currency_pair=BTC_USDT&limit=1",
  "futures:rest-ticker": "/api/v4/futures/usdt/tickers?contract=BTC_USDT",
});

export async function getGatePublic(request) {
  const params = new URL(request.url).searchParams;
  const book = params.get("book") ?? "";
  const view = params.get("view") ?? "";
  const path = PATHS[`${book}:${view}`];
  if (!path || (book !== "spot" && book !== "futures")) {
    return Response.json({ ok: false, error: "Gate connection is not on this page." }, { status: 400 });
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8_000);
  try {
    const upstream = await fetch(`${GATE_ORIGIN}${path}`, { headers: { accept: "application/json" }, cache: "no-store", signal: controller.signal });
    if (!upstream.ok) return Response.json({ ok: false, error: "Gate REST is not connected." }, { status: 502 });
    const rows = explainGate(view, book, await upstream.json());
    if (!rows) return Response.json({ ok: false, error: "Gate returned a frame this page does not accept." }, { status: 502 });
    return Response.json({ ok: true, rows });
  } catch {
    return Response.json({ ok: false, error: "Gate REST is not connected." }, { status: 502 });
  } finally {
    clearTimeout(timeout);
  }
}
