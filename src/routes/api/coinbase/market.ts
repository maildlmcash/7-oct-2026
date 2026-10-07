import { createFileRoute } from "@tanstack/react-router";
import { getCoinbaseMarket } from "../../../../engine/apps/web/coinbase-http.mjs";

export const Route = createFileRoute("/api/coinbase/market")({
  server: {
    handlers: {
      GET: ({ request }) => getCoinbaseMarket(request),
    },
  },
});
