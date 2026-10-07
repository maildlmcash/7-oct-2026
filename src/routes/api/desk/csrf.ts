import { createFileRoute } from "@tanstack/react-router";
import { getDeskCsrf } from "../../../../engine/apps/web/desk-http.mjs";

export const Route = createFileRoute("/api/desk/csrf")({
  server: {
    handlers: {
      GET: ({ request }) => getDeskCsrf(request),
    },
  },
});
