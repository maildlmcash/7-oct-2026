import { createFileRoute } from "@tanstack/react-router";
import { getMexcPublic } from "../../../../engine/apps/web/mexc-http.mjs";

export const Route = createFileRoute("/api/mexc/public")({
  server: {
    handlers: {
      GET: ({ request }) => getMexcPublic(request),
    },
  },
});
