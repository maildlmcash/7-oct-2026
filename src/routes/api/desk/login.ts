import { createFileRoute } from "@tanstack/react-router";
import { postDeskLogin } from "../../../../engine/apps/web/desk-http.mjs";

export const Route = createFileRoute("/api/desk/login")({
  server: {
    handlers: {
      POST: ({ request }) => postDeskLogin(request),
    },
  },
});
