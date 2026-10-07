import { OKX_REST_ORIGIN, OKX_TICKER_PATH, explainOkx } from "../../services/okx-public.mjs";

const ALLOWED = new Set(["BTC-USDT", "BTC-USDT-SWAP"]);

export async function getOkxTicker(request) {
  const instId = new URL(request.url).searchParams.get("instId") ?? "";
  if (!ALLOWED.has(instId)) {
    return Response.json({ ok: false, error: "OKX instrument is not on this connection." }, { status: 400 });
  }
  const book = instId === "BTC-USDT" ? "spot" : "swap";
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8_000);
  try {
    const upstream = await fetch(`${OKX_REST_ORIGIN}${OKX_TICKER_PATH}?instId=${instId}`, {
      headers: { accept: "application/json" },
      cache: "no-store",
      signal: controller.signal,
    });
    if (!upstream.ok) {
      return Response.json({ ok: false, error: "OKX REST ticker is not connected." }, { status: 502 });
    }
    const payload = await upstream.json();
    const rows = explainOkx("rest-ticker", book, payload);
    if (!rows) return Response.json({ ok: false, error: "OKX REST ticker returned a frame this page does not accept." }, { status: 502 });
    return Response.json({ ok: true, rows });
  } catch {
    return Response.json({ ok: false, error: "OKX REST ticker is not connected." }, { status: 502 });
  } finally {
    clearTimeout(timeout);
  }
}
