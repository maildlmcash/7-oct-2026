import {
  COINBASE_BOOK_PATH,
  COINBASE_FUTURE_PRODUCT,
  COINBASE_REST_ORIGIN,
  COINBASE_SPOT_PRODUCT,
  explainCoinbase,
} from "../../services/coinbase-public.mjs";

const BOOKS = Object.freeze({
  [COINBASE_SPOT_PRODUCT]: "spot",
  [COINBASE_FUTURE_PRODUCT]: "futures",
});

export async function getCoinbaseMarket(request) {
  const params = new URL(request.url).searchParams;
  const productId = params.get("product_id") ?? "";
  const view = params.get("view") ?? "";
  const book = BOOKS[productId];
  if (!book || !["product_book", "ticker", "product", "candles"].includes(view)) {
    return Response.json({ ok: false, error: "Coinbase product is not on this connection." }, { status: 400 });
  }
  const end = Math.floor(Date.now() / 1000);
  const path = view === "product_book"
    ? `${COINBASE_BOOK_PATH}?product_id=${productId}&limit=1`
    : view === "candles"
      ? `/api/v3/brokerage/market/products/${productId}/candles?start=${end - 120}&end=${end}&granularity=ONE_MINUTE`
      : view === "product"
        ? `/api/v3/brokerage/market/products/${productId}`
        : `/api/v3/brokerage/market/products/${productId}/ticker`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8_000);
  try {
    const upstream = await fetch(`${COINBASE_REST_ORIGIN}${path}`, {
      headers: { accept: "application/json" },
      cache: "no-store",
      signal: controller.signal,
    });
    if (!upstream.ok) {
      return Response.json({ ok: false, error: "Coinbase REST is not connected." }, { status: 502 });
    }
    const connectionId = view === "product_book" ? "rest-book" : view === "ticker" ? "rest-ticker" : view === "product" ? "rest-product" : "rest-candles";
    const rows = explainCoinbase(connectionId, book, await upstream.json());
    if (!rows) return Response.json({ ok: false, error: "Coinbase returned a frame this page does not accept." }, { status: 502 });
    return Response.json({ ok: true, rows });
  } catch {
    return Response.json({ ok: false, error: "Coinbase REST is not connected." }, { status: 502 });
  } finally {
    clearTimeout(timeout);
  }
}
