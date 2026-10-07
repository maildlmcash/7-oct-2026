import { createFileRoute } from "@tanstack/react-router";
import { getDeskSession } from "../../../../engine/apps/web/desk-http.mjs";

export const Route = createFileRoute("/api/desk/session")({
  server: {
    handlers: {
      GET: ({ request }) => getDeskSession(request),
    },
  },
});
