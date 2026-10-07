import { getSpotBook } from "../../../../spot-v3-http.mjs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function GET(request: Request) {
  return getSpotBook(request);
}
