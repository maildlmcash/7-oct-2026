import { BITFINEX_ORIGIN, explainBitfinex } from "../../services/bitfinex-public.mjs";

const PATHS = Object.freeze({
  "spot:rest-ticker": "/v2/ticker/tBTCUSD",
  "spot:rest-book": "/v2/book/tBTCUSD/P0?len=1",
  "futures:rest-ticker": "/v2/ticker/tBTCF0:USTF0",
  "futures:rest-status": "/v2/status/deriv?keys=tBTCF0:USTF0",
});

export async function getBitfinexPublic(request) {
  const params = new URL(request.url).searchParams;
  const book = params.get("book") ?? "";
  const view = params.get("view") ?? "";
  const path = PATHS[`${book}:${view}`];
  if (!path) return Response.json({ ok: false, error: "Bitfinex connection is not on this page." }, { status: 400 });
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8_000);
  try {
    const upstream = await fetch(`${BITFINEX_ORIGIN}${path}`, { headers: { accept: "application/json" }, cache: "no-store", signal: controller.signal });
    if (!upstream.ok) return Response.json({ ok: false, error: "Bitfinex REST is not connected." }, { status: 502 });
    const rows = explainBitfinex(view, book, await upstream.json());
    if (!rows) return Response.json({ ok: false, error: "Bitfinex returned a frame this page does not accept." }, { status: 502 });
    return Response.json({ ok: true, rows });
  } catch {
    return Response.json({ ok: false, error: "Bitfinex REST is not connected." }, { status: 502 });
  } finally {
    clearTimeout(timeout);
  }
}
