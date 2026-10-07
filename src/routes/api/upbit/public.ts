import { createFileRoute } from "@tanstack/react-router";
import { getUpbitPublic } from "../../../../engine/apps/web/upbit-http.mjs";

export const Route = createFileRoute("/api/upbit/public")({
  server: {
    handlers: {
      GET: ({ request }) => getUpbitPublic(request),
    },
  },
});
