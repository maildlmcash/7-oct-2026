import { getProjectChecklist, postProjectChecklist } from "../../../project-checklist-http.mjs";

export const runtime = "nodejs";

export function GET(request: Request) {
  return getProjectChecklist(request);
}

export function POST(request: Request) {
  return postProjectChecklist(request);
}
