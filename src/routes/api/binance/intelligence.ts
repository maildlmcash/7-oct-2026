import { createFileRoute } from "@tanstack/react-router";
import { getBinanceIntelligence } from "../../../../engine/apps/web/binance-intelligence-http.mjs";

export const Route = createFileRoute("/api/binance/intelligence")({
  server: {
    handlers: {
      GET: ({ request }) => getBinanceIntelligence(request),
    },
  },
});
