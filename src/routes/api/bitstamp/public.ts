import { createFileRoute } from "@tanstack/react-router";
import { getBitstampPublic } from "../../../../engine/apps/web/bitstamp-http.mjs";

export const Route = createFileRoute("/api/bitstamp/public")({
  server: {
    handlers: {
      GET: ({ request }) => getBitstampPublic(request),
    },
  },
});
