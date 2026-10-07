import { createFileRoute } from "@tanstack/react-router";
import { DEXSCREENER_PIPELINE, DEXSCREENER_PREDICTION, DEXSCREENER_USES, readDexScreener } from "../../../../engine/services/dexscreener.mjs";

export const Route = createFileRoute("/api/dex/search")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const query = new URL(request.url).searchParams.get("q")?.trim() ?? "";
        if (query.length < 2 || query.length > 100) {
          return Response.json({ ok: false, error: "Search must be between 2 and 100 characters." }, { status: 400, headers: { "cache-control": "no-store" } });
        }
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 12_000);
        try {
          let upstream = await fetch(`https://api.dexscreener.com/latest/dex/search?q=${encodeURIComponent(query)}`, {
            headers: { accept: "application/json", "user-agent": "desk" },
            signal: controller.signal,
          });
          if (upstream.status === 429) {
            await new Promise((resolve) => setTimeout(resolve, 1_200));
            upstream = await fetch(`https://api.dexscreener.com/latest/dex/search?q=${encodeURIComponent(query)}`, {
              headers: { accept: "application/json", "user-agent": "desk" },
              signal: controller.signal,
            });
          }
          if (!upstream.ok) {
            return Response.json({ ok: false, error: `DexScreener returned HTTP ${upstream.status}.` }, { status: 502, headers: { "cache-control": "no-store" } });
          }
          const read = readDexScreener(await upstream.json());
          return Response.json({
            ok: true,
            live: true,
            source: "DexScreener public search",
            observedAt: new Date().toISOString(),
            limit: { requestsPerMinute: read.requestsPerMinute, requestsUsed: read.requestsUsed, pairsImported: read.imported },
            uses: DEXSCREENER_USES,
            predictionPlan: DEXSCREENER_PREDICTION,
            pipeline: DEXSCREENER_PIPELINE,
            pairs: read.pairs,
          }, { headers: { "cache-control": "no-store" } });
        } catch (error) {
          const timedOut = error instanceof Error && error.name === "AbortError";
          return Response.json({ ok: false, error: timedOut ? "DEX search timed out." : "DEX search is unavailable." }, { status: 502, headers: { "cache-control": "no-store" } });
        } finally {
          clearTimeout(timeout);
        }
      },
    },
  },
});
