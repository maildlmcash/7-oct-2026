import { getViewState, postViewState } from "../../../view-state-http.mjs";

export const runtime = "nodejs";

export function GET(request: Request) {
  return getViewState(request);
}

export function POST(request: Request) {
  return postViewState(request);
}
