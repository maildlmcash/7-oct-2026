import { GEMINI_ORIGIN, explainGemini } from "../../services/gemini-public.mjs";

const PATHS = Object.freeze({
  "spot:rest-ticker": "/v1/pubticker/btcusd",
  "spot:rest-book": "/v1/book/btcusd?limit_bids=1&limit_asks=1",
  "futures:rest-ticker": "/v1/pubticker/btcgusdperp",
  "futures:rest-book": "/v1/book/btcgusdperp?limit_bids=1&limit_asks=1",
  "futures:rest-funding": "/v1/fundingamount/btcgusdperp",
});

export async function getGeminiPublic(request) {
  const params = new URL(request.url).searchParams;
  const book = params.get("book") ?? "";
  const view = params.get("view") ?? "";
  const path = PATHS[`${book}:${view}`];
  if (!path) return Response.json({ ok: false, error: "Gemini connection is not on this page." }, { status: 400 });
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8_000);
  try {
    const upstream = await fetch(`${GEMINI_ORIGIN}${path}`, { headers: { accept: "application/json" }, cache: "no-store", signal: controller.signal });
    if (!upstream.ok) return Response.json({ ok: false, error: "Gemini REST is not connected." }, { status: 502 });
    const rows = explainGemini(view, book, await upstream.json());
    if (!rows) return Response.json({ ok: false, error: "Gemini returned a frame this page does not accept." }, { status: 502 });
    return Response.json({ ok: true, rows });
  } catch {
    return Response.json({ ok: false, error: "Gemini REST is not connected." }, { status: 502 });
  } finally {
    clearTimeout(timeout);
  }
}
