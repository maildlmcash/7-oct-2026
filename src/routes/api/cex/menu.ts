import { createFileRoute } from "@tanstack/react-router";
import { getCexMenu } from "../../../../engine/apps/web/cex-menu-http.mjs";

export const Route = createFileRoute("/api/cex/menu")({
  server: {
    handlers: {
      GET: ({ request }) => getCexMenu(request),
    },
  },
});
