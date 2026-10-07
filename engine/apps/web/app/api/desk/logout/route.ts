import { postDeskLogout } from "../../../../desk-http.mjs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function POST(request: Request) {
  return postDeskLogout(request);
}
