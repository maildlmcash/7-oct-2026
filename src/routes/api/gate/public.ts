import { createFileRoute } from "@tanstack/react-router";
import { getGatePublic } from "../../../../engine/apps/web/gate-http.mjs";

export const Route = createFileRoute("/api/gate/public")({
  server: {
    handlers: {
      GET: ({ request }) => getGatePublic(request),
    },
  },
});
