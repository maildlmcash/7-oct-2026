import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/dex/search")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const query = new URL(request.url).searchParams.get("q")?.trim() ?? "";
        if (query.length < 2 || query.length > 100) {
          return Response.json(
            { ok: false, error: "Search must be between 2 and 100 characters." },
            { status: 400, headers: { "cache-control": "no-store" } },
          );
        }
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 8_000);
        try {
          const upstream = await fetch(
            `https://api.dexscreener.com/latest/dex/search?q=${encodeURIComponent(query)}`,
            { headers: { accept: "application/json" }, signal: controller.signal },
          );
          if (!upstream.ok) {
            return Response.json(
              { ok: false, error: `DEX data source returned HTTP ${upstream.status}.` },
              { status: 502, headers: { "cache-control": "no-store" } },
            );
          }
          const payload: unknown = await upstream.json();
          const pairs =
            payload && typeof payload === "object" && Array.isArray((payload as { pairs?: unknown }).pairs)
              ? (payload as { pairs: unknown[] }).pairs
              : [];
          const data = pairs.slice(0, 30).flatMap((item) => {
            if (!item || typeof item !== "object") return [];
            const pair = item as Record<string, unknown>;
            const base = pair.baseToken as Record<string, unknown> | undefined;
            const quote = pair.quoteToken as Record<string, unknown> | undefined;
            const liquidity = pair.liquidity as Record<string, unknown> | undefined;
            const volume = pair.volume as Record<string, unknown> | undefined;
            if (typeof pair.pairAddress !== "string" || typeof pair.chainId !== "string") return [];
            return [
              {
                chain: pair.chainId,
                dex: typeof pair.dexId === "string" ? pair.dexId : "unknown",
                pairAddress: pair.pairAddress,
                base: typeof base?.symbol === "string" ? base.symbol : "?",
                quote: typeof quote?.symbol === "string" ? quote.symbol : "?",
                priceUsd: typeof pair.priceUsd === "string" ? pair.priceUsd : null,
                liquidityUsd: typeof liquidity?.usd === "number" ? liquidity.usd : null,
                volume24hUsd: typeof volume?.h24 === "number" ? volume.h24 : null,
                url: typeof pair.url === "string" && pair.url.startsWith("https://") ? pair.url : null,
              },
            ];
          });
          return Response.json(
            { ok: true, source: "DexScreener public search", observedAt: new Date().toISOString(), pairs: data },
            { headers: { "cache-control": "no-store" } },
          );
        } catch (error) {
          const timedOut = error instanceof Error && error.name === "AbortError";
          return Response.json(
            { ok: false, error: timedOut ? "DEX search timed out." : "DEX search is unavailable." },
            { status: 502, headers: { "cache-control": "no-store" } },
          );
        } finally {
          clearTimeout(timeout);
        }
      },
    },
  },
});
