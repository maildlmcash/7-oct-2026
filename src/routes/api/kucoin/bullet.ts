import { createFileRoute } from "@tanstack/react-router";
import { getKucoinBullet } from "../../../../engine/apps/web/kucoin-http.mjs";

export const Route = createFileRoute("/api/kucoin/bullet")({
  server: {
    handlers: {
      GET: ({ request }) => getKucoinBullet(request),
    },
  },
});
