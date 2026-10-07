import { postLogin, sessionRuntime } from "../../../../session-http.mjs";

export const runtime = "nodejs";

export function POST(request: Request) {
  return postLogin(request, sessionRuntime);
}
