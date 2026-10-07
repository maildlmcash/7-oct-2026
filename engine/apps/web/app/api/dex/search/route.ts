import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const query = new URL(request.url).searchParams.get("q")?.trim() ?? "";
  if (query.length < 2 || query.length > 100) {
    return NextResponse.json({ ok: false, error: "Search must be between 2 and 100 characters." }, { status: 400 });
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8_000);
  try {
    const upstream = await fetch(`https://api.dexscreener.com/latest/dex/search?q=${encodeURIComponent(query)}`, {
      headers: { accept: "application/json" },
      cache: "no-store",
      signal: controller.signal,
    });
    if (!upstream.ok) return NextResponse.json({ ok: false, error: `DEX data source returned HTTP ${upstream.status}.` }, { status: 502 });
    const payload: unknown = await upstream.json();
    const pairs = payload && typeof payload === "object" && Array.isArray((payload as { pairs?: unknown }).pairs)
      ? (payload as { pairs: unknown[] }).pairs
      : [];
    const data = pairs.slice(0, 30).flatMap((item) => {
      if (!item || typeof item !== "object") return [];
      const p = item as Record<string, unknown>;
      const base = p.baseToken as Record<string, unknown> | undefined;
      const quote = p.quoteToken as Record<string, unknown> | undefined;
      const liquidity = p.liquidity as Record<string, unknown> | undefined;
      const volume = p.volume as Record<string, unknown> | undefined;
      if (typeof p.pairAddress !== "string" || typeof p.chainId !== "string") return [];
      return [{
        chain: p.chainId,
        dex: typeof p.dexId === "string" ? p.dexId : "unknown",
        pairAddress: p.pairAddress,
        base: typeof base?.symbol === "string" ? base.symbol : "?",
        quote: typeof quote?.symbol === "string" ? quote.symbol : "?",
        priceUsd: typeof p.priceUsd === "string" ? p.priceUsd : null,
        liquidityUsd: typeof liquidity?.usd === "number" ? liquidity.usd : null,
        volume24hUsd: typeof volume?.h24 === "number" ? volume.h24 : null,
        url: typeof p.url === "string" && p.url.startsWith("https://") ? p.url : null,
      }];
    });
    return NextResponse.json({ ok: true, source: "DexScreener public search", observedAt: new Date().toISOString(), pairs: data }, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error && error.name === "AbortError" ? "DEX search timed out." : "DEX search is unavailable." }, { status: 502 });
  } finally {
    clearTimeout(timeout);
  }
}
