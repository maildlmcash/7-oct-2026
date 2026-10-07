import { createFileRoute } from "@tanstack/react-router";
import { getSpotBook } from "../../../../engine/apps/web/spot-v3-http.mjs";

export const Route = createFileRoute("/api/spot/book")({
  server: {
    handlers: {
      GET: ({ request }) => getSpotBook(request),
    },
  },
});
