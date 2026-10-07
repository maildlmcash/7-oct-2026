import { createFileRoute } from "@tanstack/react-router";
import { getKrakenPublic } from "../../../../engine/apps/web/kraken-http.mjs";

export const Route = createFileRoute("/api/kraken/public")({
  server: {
    handlers: {
      GET: ({ request }) => getKrakenPublic(request),
    },
  },
});
