import { postLogout, sessionRuntime } from "../../../../session-http.mjs";

export const runtime = "nodejs";

export function POST(request: Request) {
  return postLogout(request, sessionRuntime);
}
