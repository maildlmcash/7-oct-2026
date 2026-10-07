import { createFileRoute } from "@tanstack/react-router";
import { getViewState, postViewState } from "../../../engine/apps/web/view-state-http.mjs";

export const Route = createFileRoute("/api/view-state")({
  server: {
    handlers: {
      GET: ({ request }) => getViewState(request),
      POST: ({ request }) => postViewState(request),
    },
  },
});
