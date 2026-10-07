import { parseUserVisibleStatus } from "@crypto-prediction-engine/contracts";
import { emptyChecklistStatusView, renderChecklistStatusView } from "../../../services/checklist-status-view.mjs";
import { authorizeShell } from "../../../services/shell-capabilities.mjs";
import { knownEnvironment } from "../page-health.mjs";
import Shell from "./shell";

export default function Page() {
  const checklistView = emptyChecklistStatusView();
  const status = parseUserVisibleStatus({
    state: checklistView.state,
    counts: checklistView.counts,
    error: checklistView.error,
  });
  if (!status.ok) throw new Error(status.error);
  const checklistMarkup = renderChecklistStatusView(checklistView);
  const capabilities = authorizeShell(null, null);
  return (
    <Shell
      checklistMarkup={checklistMarkup}
      capabilities={capabilities}
      status={status.status}
      environment={knownEnvironment(process.env.APP_ENV)}
    />
  );
}
