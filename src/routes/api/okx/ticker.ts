import { createFileRoute } from "@tanstack/react-router";
import { getOkxTicker } from "../../../../engine/apps/web/okx-http.mjs";

export const Route = createFileRoute("/api/okx/ticker")({
  server: {
    handlers: {
      GET: ({ request }) => getOkxTicker(request),
    },
  },
});
