import { explainMenu, menuCall } from "../../services/cex-menu.mjs";
import { KUCOIN_FUTURES_ORIGIN, KUCOIN_SPOT_ORIGIN } from "../../services/kucoin-public.mjs";

export async function getCexMenu(request) {
  const params = new URL(request.url).searchParams;
  const venue = params.get("venue") ?? "";
  const book = params.get("book") ?? "";
  const coin = params.get("coin") ?? "";
  const call = params.get("call") ?? "";
  const recipe = menuCall(venue, book, coin, call);
  if (!recipe.ok) return Response.json(recipe, { status: 400 });
  if (recipe.bullet) {
    const origin = recipe.bullet === "spot" ? KUCOIN_SPOT_ORIGIN : KUCOIN_FUTURES_ORIGIN;
    try {
      const upstream = await fetch(`${origin}/api/v1/bullet-public`, { method: "POST", cache: "no-store" });
      const payload = await upstream.json();
      const server = payload?.data?.instanceServers?.[0];
      if (!upstream.ok || typeof payload?.data?.token !== "string" || typeof server?.endpoint !== "string") {
        return Response.json({ ok: false, error: "KuCoin websocket token is not connected." }, { status: 502 });
      }
      return Response.json({ ...recipe, address: `${server.endpoint}?token=${payload.data.token}` });
    } catch {
      return Response.json({ ok: false, error: "KuCoin websocket token is not connected." }, { status: 502 });
    }
  }
  if (recipe.kind === "ws") return Response.json(recipe);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8_000);
  try {
    const upstream = await fetch(recipe.address, { headers: { accept: "application/json" }, cache: "no-store", signal: controller.signal });
    if (!upstream.ok) return Response.json({ ...recipe, ok: false, error: "REST call is not connected." }, { status: 502 });
    const explained = explainMenu(venue, await upstream.json(), recipe.symbol);
    if (!explained) return Response.json({ ...recipe, ok: false, error: "The response did not match this coin." }, { status: 502 });
    return Response.json({ ...recipe, ...explained });
  } catch {
    return Response.json({ ...recipe, ok: false, error: "REST call is not connected." }, { status: 502 });
  } finally {
    clearTimeout(timeout);
  }
}
