import { parseRestBookTicker, publicMarketUrl } from "../../services/binance-spot-public.mjs";

const BOOK_PATH = "/api/v3/ticker/bookTicker";

export async function getSpotBook(request) {
  const symbol = new URL(request.url).searchParams.get("symbol") ?? "";
  const located = publicMarketUrl(BOOK_PATH, { symbol });
  if (!located.ok) {
    return Response.json({ ok: false, error: located.error }, { status: 400 });
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8_000);
  try {
    const upstream = await fetch(located.url, {
      headers: { accept: "application/json" },
      cache: "no-store",
      signal: controller.signal,
    });
    if (!upstream.ok) {
      return Response.json({ ok: false, error: "Spot API v3 is not connected" }, { status: 502 });
    }
    const parsed = parseRestBookTicker(await upstream.json());
    if (!parsed.ok) {
      return Response.json({ ok: false, error: parsed.error }, { status: 502 });
    }
    return Response.json({
      ok: true,
      source: "spot-api-v3",
      path: BOOK_PATH,
      book: parsed.book,
    });
  } catch {
    return Response.json({ ok: false, error: "Spot API v3 is not connected" }, { status: 502 });
  } finally {
    clearTimeout(timeout);
  }
}
