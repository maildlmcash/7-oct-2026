import {
  emptyUserVisibleStatus,
  parseClientViewState,
  refreshClientViewState,
} from "@crypto-prediction-engine/contracts";
import { recordServerFailure } from "./page-health-server.mjs";
import { CORRELATION_HEADER, resolveCorrelationId, SECTION_HEADER } from "./request-correlation.mjs";

export function respondViewState(request, body, status) {
  const correlationId = resolveCorrelationId(request.headers.get(CORRELATION_HEADER));
  if (status >= 400) {
    recordServerFailure({
      routeViewId: "/api/view-state",
      viewId: request.headers.get(SECTION_HEADER),
      httpStatus: status,
      requestId: correlationId,
    });
  }
  return Response.json(
    { ...body, correlationId },
    {
      status,
      headers: {
        [CORRELATION_HEADER]: correlationId,
        "cache-control": "no-store",
      },
    },
  );
}

export function getViewState(request) {
  const raw = new URL(request.url).searchParams.get("pageSize");
  const pageSize = raw === null ? Number.NaN : Number(raw);
  const result = refreshClientViewState({
    pageSize,
    status: emptyUserVisibleStatus(),
  });
  return respondViewState(request, result, result.ok ? 200 : 400);
}

export async function postViewState(request) {
  let body;
  try {
    body = await request.json();
  } catch {
    return respondViewState(request, { ok: false, error: "invalid view state" }, 400);
  }
  const result = parseClientViewState(body);
  return respondViewState(request, result, result.ok ? 200 : 400);
}
