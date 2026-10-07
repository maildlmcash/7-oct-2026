import { createFileRoute } from "@tanstack/react-router";
import { postDeskLogout } from "../../../../engine/apps/web/desk-http.mjs";

export const Route = createFileRoute("/api/desk/logout")({
  server: {
    handlers: {
      POST: ({ request }) => postDeskLogout(request),
    },
  },
});
