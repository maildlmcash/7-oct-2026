import { createFileRoute } from "@tanstack/react-router";
import { getHtxPublic } from "../../../../engine/apps/web/htx-http.mjs";

export const Route = createFileRoute("/api/htx/public")({
  server: {
    handlers: {
      GET: ({ request }) => getHtxPublic(request),
    },
  },
});
