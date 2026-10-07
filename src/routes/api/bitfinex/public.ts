import { createFileRoute } from "@tanstack/react-router";
import { getBitfinexPublic } from "../../../../engine/apps/web/bitfinex-http.mjs";

export const Route = createFileRoute("/api/bitfinex/public")({
  server: {
    handlers: {
      GET: ({ request }) => getBitfinexPublic(request),
    },
  },
});
