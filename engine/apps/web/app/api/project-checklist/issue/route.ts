import { postProjectChecklistIssue } from "../../../../project-checklist-http.mjs";

export const runtime = "nodejs";

export function POST(request: Request) {
  return postProjectChecklistIssue(request);
}
