import { postNavigationAction } from "../../../../navigation-http.mjs";
import { sessionRuntime } from "../../../../session-http.mjs";

export const runtime = "nodejs";

export function POST(request: Request) {
  return postNavigationAction(request, sessionRuntime);
}
