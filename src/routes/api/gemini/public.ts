import { createFileRoute } from "@tanstack/react-router";
import { getGeminiPublic } from "../../../../engine/apps/web/gemini-http.mjs";

export const Route = createFileRoute("/api/gemini/public")({
  server: {
    handlers: {
      GET: ({ request }) => getGeminiPublic(request),
    },
  },
});
