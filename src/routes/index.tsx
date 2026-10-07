import { createFileRoute } from "@tanstack/react-router";
import { parseUserVisibleStatus } from "@crypto-prediction-engine/contracts";
import { emptyChecklistStatusView, renderChecklistStatusView } from "../../engine/services/checklist-status-view.mjs";
import { authorizeShell } from "../../engine/services/shell-capabilities.mjs";
import Shell from "../../engine/apps/web/app/shell";

export const Route = createFileRoute("/")({
  component: Home,
});

function Home() {
  const checklistView = emptyChecklistStatusView();
  const status = parseUserVisibleStatus({
    state: checklistView.state,
    counts: checklistView.counts,
    error: checklistView.error,
  });
  if (!status.ok) throw new Error(status.error);
  return (
    <Shell
      checklistMarkup={renderChecklistStatusView(checklistView)}
      capabilities={authorizeShell(null, null)}
      status={status.status}
      environment={null}
    />
  );
}
