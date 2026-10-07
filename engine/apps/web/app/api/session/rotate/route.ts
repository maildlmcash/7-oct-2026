import { postRotate, sessionRuntime } from "../../../../session-http.mjs";

export const runtime = "nodejs";

export function POST(request: Request) {
  return postRotate(request, sessionRuntime);
}