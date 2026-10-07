import { getRateLimits, sessionRuntime } from "../../../../session-http.mjs";

export const runtime = "nodejs";

export function GET(request: Request) {
  return getRateLimits(request, sessionRuntime);
}
