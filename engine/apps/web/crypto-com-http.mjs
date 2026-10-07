import { CRYPTO_ORIGIN, explainCryptoCom } from "../../services/crypto-com-public.mjs";

const PATHS = Object.freeze({
  "spot:rest-ticker": "/exchange/v1/public/get-tickers?instrument_name=BTC_USDT",
  "spot:rest-book": "/exchange/v1/public/get-book?instrument_name=BTC_USDT&depth=1",
  "futures:rest-ticker": "/exchange/v1/public/get-tickers?instrument_name=BTCUSD-PERP",
  "futures:rest-book": "/exchange/v1/public/get-book?instrument_name=BTCUSD-PERP&depth=1",
  "futures:rest-funding": "/exchange/v1/public/get-valuations?instrument_name=BTCUSD-PERP&valuation_type=funding_hist&count=1",
});

export async function getCryptoComPublic(request) {
  const params = new URL(request.url).searchParams;
  const book = params.get("book") ?? "";
  const view = params.get("view") ?? "";
  const path = PATHS[`${book}:${view}`];
  if (!path) return Response.json({ ok: false, error: "Crypto.com connection is not on this page." }, { status: 400 });
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8_000);
  try {
    const upstream = await fetch(`${CRYPTO_ORIGIN}${path}`, { headers: { accept: "application/json" }, cache: "no-store", signal: controller.signal });
    if (!upstream.ok) return Response.json({ ok: false, error: "Crypto.com REST is not connected." }, { status: 502 });
    const rows = explainCryptoCom(view, book, await upstream.json());
    if (!rows) return Response.json({ ok: false, error: "Crypto.com returned a frame this page does not accept." }, { status: 502 });
    return Response.json({ ok: true, rows });
  } catch {
    return Response.json({ ok: false, error: "Crypto.com REST is not connected." }, { status: 502 });
  } finally {
    clearTimeout(timeout);
  }
}
