import { getSpotSymbols } from "../../../../spot-symbols-http.mjs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function GET() {
  return getSpotSymbols();
}
