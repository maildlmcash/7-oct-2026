import { createFileRoute } from "@tanstack/react-router";
import { getCryptoComPublic } from "../../../../engine/apps/web/crypto-com-http.mjs";

export const Route = createFileRoute("/api/crypto-com/public")({
  server: {
    handlers: {
      GET: ({ request }) => getCryptoComPublic(request),
    },
  },
});
