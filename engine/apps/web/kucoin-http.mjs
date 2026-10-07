import { KUCOIN_FUTURES_ORIGIN, KUCOIN_SPOT_ORIGIN, explainKucoin } from "../../services/kucoin-public.mjs";

const PATHS = Object.freeze({
  "spot:rest-level1": [`${KUCOIN_SPOT_ORIGIN}/api/v1/market/orderbook/level1?symbol=BTC-USDT`, "spot"],
  "futures:rest-ticker": [`${KUCOIN_FUTURES_ORIGIN}/api/v1/ticker?symbol=XBTUSDTM`, "futures"],
  "futures:rest-funding": [`${KUCOIN_FUTURES_ORIGIN}/api/v1/funding-rate/XBTUSDTM/current`, "futures"],
});

export async function getKucoinPublic(request) {
  const params = new URL(request.url).searchParams;
  const book = params.get("book") ?? "";
  const view = params.get("view") ?? "";
  const located = PATHS[`${book}:${view}`];
  if (!located) return Response.json({ ok: false, error: "KuCoin connection is not on this page." }, { status: 400 });
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8_000);
  try {
    const upstream = await fetch(located[0], { headers: { accept: "application/json" }, cache: "no-store", signal: controller.signal });
    if (!upstream.ok) return Response.json({ ok: false, error: "KuCoin REST is not connected." }, { status: 502 });
    const rows = explainKucoin(view, located[1], await upstream.json());
    if (!rows) return Response.json({ ok: false, error: "KuCoin returned a frame this page does not accept." }, { status: 502 });
    return Response.json({ ok: true, rows });
  } catch {
    return Response.json({ ok: false, error: "KuCoin REST is not connected." }, { status: 502 });
  } finally {
    clearTimeout(timeout);
  }
}

export async function getKucoinBullet(request) {
  const book = new URL(request.url).searchParams.get("book") ?? "";
  const origin = book === "spot" ? KUCOIN_SPOT_ORIGIN : book === "futures" ? KUCOIN_FUTURES_ORIGIN : "";
  if (!origin) return Response.json({ ok: false, error: "KuCoin book is not on this page." }, { status: 400 });
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8_000);
  try {
    const upstream = await fetch(`${origin}/api/v1/bullet-public`, { method: "POST", cache: "no-store", signal: controller.signal });
    if (!upstream.ok) return Response.json({ ok: false, error: "KuCoin public websocket token is not connected." }, { status: 502 });
    const payload = await upstream.json();
    const server = payload?.data?.instanceServers?.[0];
    if (payload?.code !== "200000" || typeof payload?.data?.token !== "string" || typeof server?.endpoint !== "string") {
      return Response.json({ ok: false, error: "KuCoin public websocket token is not connected." }, { status: 502 });
    }
    return Response.json({
      ok: true,
      endpoint: server.endpoint,
      token: payload.data.token,
      pingInterval: Number(server.pingInterval) || 18000,
      pingTimeout: Number(server.pingTimeout) || 10000,
    });
  } catch {
    return Response.json({ ok: false, error: "KuCoin public websocket token is not connected." }, { status: 502 });
  } finally {
    clearTimeout(timeout);
  }
}
