import { createFileRoute } from "@tanstack/react-router";
import { getBitgetPublic } from "../../../../engine/apps/web/bitget-http.mjs";

export const Route = createFileRoute("/api/bitget/public")({
  server: {
    handlers: {
      GET: ({ request }) => getBitgetPublic(request),
    },
  },
});
