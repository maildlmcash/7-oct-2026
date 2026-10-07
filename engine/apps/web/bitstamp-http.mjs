import { BITSTAMP_ORIGIN, explainBitstamp } from "../../services/bitstamp-public.mjs";

const PATHS = Object.freeze({
  "spot:rest-ticker": "/api/v2/ticker/btcusd/",
  "spot:rest-book": "/api/v2/order_book/btcusd/",
  "futures:rest-ticker": "/api/v2/ticker/btcusd-perp/",
  "futures:rest-book": "/api/v2/order_book/btcusd-perp/",
});

export async function getBitstampPublic(request) {
  const params = new URL(request.url).searchParams;
  const book = params.get("book") ?? "";
  const view = params.get("view") ?? "";
  const path = PATHS[`${book}:${view}`];
  if (!path) return Response.json({ ok: false, error: "Bitstamp connection is not on this page." }, { status: 400 });
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8_000);
  try {
    const upstream = await fetch(`${BITSTAMP_ORIGIN}${path}`, { headers: { accept: "application/json" }, cache: "no-store", signal: controller.signal });
    if (!upstream.ok) return Response.json({ ok: false, error: "Bitstamp REST is not connected." }, { status: 502 });
    const rows = explainBitstamp(view, book, await upstream.json());
    if (!rows) return Response.json({ ok: false, error: "Bitstamp returned a frame this page does not accept." }, { status: 502 });
    return Response.json({ ok: true, rows });
  } catch {
    return Response.json({ ok: false, error: "Bitstamp REST is not connected." }, { status: 502 });
  } finally {
    clearTimeout(timeout);
  }
}
