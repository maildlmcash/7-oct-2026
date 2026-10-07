import { getChecklistOwner, postChecklistOwner } from "../../../policy-http.mjs";
import { sessionRuntime } from "../../../session-http.mjs";

export const runtime = "nodejs";

export function GET(request: Request) {
  return getChecklistOwner(request, sessionRuntime);
}

export function POST(request: Request) {
  return postChecklistOwner(request, sessionRuntime);
}
