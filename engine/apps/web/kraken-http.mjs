import { KRAKEN_FUTURES_ORIGIN, KRAKEN_SPOT_ORIGIN, explainKraken } from "../../services/kraken-public.mjs";

const PATHS = Object.freeze({
  "spot:rest-ticker": ["/0/public/Ticker?pair=XBTUSD", "spot"],
  "spot:rest-depth": ["/0/public/Depth?pair=XBTUSD&count=1", "spot"],
  "futures:rest-ticker": ["/derivatives/api/v3/tickers/PI_XBTUSD", "futures"],
});

export async function getKrakenPublic(request) {
  const params = new URL(request.url).searchParams;
  const book = params.get("book") ?? "";
  const view = params.get("view") ?? "";
  const located = PATHS[`${book}:${view}`];
  if (!located) return Response.json({ ok: false, error: "Kraken connection is not on this page." }, { status: 400 });
  const origin = book === "spot" ? KRAKEN_SPOT_ORIGIN : KRAKEN_FUTURES_ORIGIN;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8_000);
  try {
    const upstream = await fetch(`${origin}${located[0]}`, { headers: { accept: "application/json" }, cache: "no-store", signal: controller.signal });
    if (!upstream.ok) return Response.json({ ok: false, error: "Kraken REST is not connected." }, { status: 502 });
    const rows = explainKraken(view, located[1], await upstream.json());
    if (!rows) return Response.json({ ok: false, error: "Kraken returned a frame this page does not accept." }, { status: 502 });
    return Response.json({ ok: true, rows });
  } catch {
    return Response.json({ ok: false, error: "Kraken REST is not connected." }, { status: 502 });
  } finally {
    clearTimeout(timeout);
  }
}
