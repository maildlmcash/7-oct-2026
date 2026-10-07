import { createFileRoute } from "@tanstack/react-router";
import { getDexPlan } from "../../../../engine/apps/web/dex-plan-http.mjs";

export const Route = createFileRoute("/api/dex/plan")({
  server: {
    handlers: {
      GET: ({ request }) => getDexPlan(request),
    },
  },
});
