import { parseSymbolCatalog, publicSymbolCatalogUrl } from "../../services/binance-spot-public.mjs";

const CATALOG_TTL_MS = 5 * 60 * 1000;
let cached = null;

export async function getSpotSymbols() {
  const now = Date.now();
  if (cached && now - cached.at < CATALOG_TTL_MS) {
    return Response.json({ ok: true, source: "spot-api-v3", symbols: cached.symbols });
  }
  const located = publicSymbolCatalogUrl();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12_000);
  try {
    const upstream = await fetch(located.url, {
      headers: { accept: "application/json" },
      cache: "no-store",
      signal: controller.signal,
    });
    if (!upstream.ok) {
      return Response.json({ ok: false, error: "Spot symbol list is not connected" }, { status: 502 });
    }
    const parsed = parseSymbolCatalog(await upstream.json());
    if (!parsed.ok) {
      return Response.json({ ok: false, error: parsed.error }, { status: 502 });
    }
    cached = { at: now, symbols: parsed.symbols };
    return Response.json({ ok: true, source: "spot-api-v3", symbols: parsed.symbols });
  } catch {
    return Response.json({ ok: false, error: "Spot symbol list is not connected" }, { status: 502 });
  } finally {
    clearTimeout(timeout);
  }
}
