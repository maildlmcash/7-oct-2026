import { HTX_FUTURES_ORIGIN, HTX_SPOT_ORIGIN, explainHtx } from "../../services/htx-public.mjs";

const PATHS = Object.freeze({
  "spot:rest-merged": `${HTX_SPOT_ORIGIN}/market/detail/merged?symbol=btcusdt`,
  "futures:rest-merged": `${HTX_FUTURES_ORIGIN}/linear-swap-ex/market/detail/merged?contract_code=BTC-USDT`,
  "futures:rest-funding": `${HTX_FUTURES_ORIGIN}/linear-swap-api/v1/swap_funding_rate?contract_code=BTC-USDT`,
});

export async function getHtxPublic(request) {
  const params = new URL(request.url).searchParams;
  const book = params.get("book") ?? "";
  const view = params.get("view") ?? "";
  const url = PATHS[`${book}:${view}`];
  if (!url) return Response.json({ ok: false, error: "HTX connection is not on this page." }, { status: 400 });
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8_000);
  try {
    const upstream = await fetch(url, { headers: { accept: "application/json" }, cache: "no-store", signal: controller.signal });
    if (!upstream.ok) return Response.json({ ok: false, error: "HTX REST is not connected." }, { status: 502 });
    const rows = explainHtx(view, book, await upstream.json());
    if (!rows) return Response.json({ ok: false, error: "HTX returned a frame this page does not accept." }, { status: 502 });
    return Response.json({ ok: true, rows });
  } catch {
    return Response.json({ ok: false, error: "HTX REST is not connected." }, { status: 502 });
  } finally {
    clearTimeout(timeout);
  }
}
