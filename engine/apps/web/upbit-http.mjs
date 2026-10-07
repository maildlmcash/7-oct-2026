import { UPBIT_ORIGIN, explainUpbit } from "../../services/upbit-public.mjs";

const PATHS = Object.freeze({
  "rest-ticker": "/v1/ticker?markets=KRW-BTC",
  "rest-book": "/v1/orderbook?markets=KRW-BTC",
});

export async function getUpbitPublic(request) {
  const view = new URL(request.url).searchParams.get("view") ?? "";
  const path = PATHS[view];
  if (!path) return Response.json({ ok: false, error: "Upbit connection is not on this page." }, { status: 400 });
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8_000);
  try {
    const upstream = await fetch(`${UPBIT_ORIGIN}${path}`, { headers: { accept: "application/json" }, cache: "no-store", signal: controller.signal });
    if (!upstream.ok) return Response.json({ ok: false, error: "Upbit REST is not connected." }, { status: 502 });
    const rows = explainUpbit(view, await upstream.json());
    if (!rows) return Response.json({ ok: false, error: "Upbit returned a frame this page does not accept." }, { status: 502 });
    return Response.json({ ok: true, rows });
  } catch {
    return Response.json({ ok: false, error: "Upbit REST is not connected." }, { status: 502 });
  } finally {
    clearTimeout(timeout);
  }
}
