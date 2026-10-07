import { createFileRoute } from "@tanstack/react-router";
import { getKucoinPublic } from "../../../../engine/apps/web/kucoin-http.mjs";

export const Route = createFileRoute("/api/kucoin/public")({
  server: {
    handlers: {
      GET: ({ request }) => getKucoinPublic(request),
    },
  },
});
