import { getDeskCsrf } from "../../../../desk-http.mjs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function GET(request: Request) {
  return getDeskCsrf(request);
}
