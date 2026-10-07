import { createFileRoute } from "@tanstack/react-router";
import { getSpotSymbols } from "../../../../engine/apps/web/spot-symbols-http.mjs";

export const Route = createFileRoute("/api/spot/symbols")({
  server: {
    handlers: {
      GET: () => getSpotSymbols(),
    },
  },
});
