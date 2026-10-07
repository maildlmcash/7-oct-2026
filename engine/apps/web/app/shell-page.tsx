import { headers } from "next/headers";
import { parseUserVisibleStatus } from "@crypto-prediction-engine/contracts";
import { emptyChecklistStatusView, renderChecklistStatusView } from "../../../services/checklist-status-view.mjs";
import { authorizeShell } from "../../../services/shell-capabilities.mjs";
import { approvedPreviews, resolveTenantHost } from "../../../services/tenants/white-label.mjs";
import { knownEnvironment } from "../page-health.mjs";
import { navigationFromSession } from "./navigation/matrix.mjs";
import Shell from "./shell";

export default async function ShellPage() {
  const headerList = await headers();
  const branding = resolveTenantHost({
    host: headerList.get("host"),
    forwardedHost: headerList.get("x-forwarded-host"),
    originalHost: headerList.get("x-original-host"),
  });
  const checklistView = emptyChecklistStatusView();
  const status = parseUserVisibleStatus({
    state: checklistView.state,
    counts: checklistView.counts,
    error: checklistView.error,
  });
  if (!status.ok) throw new Error(status.error);
  const checklistMarkup = renderChecklistStatusView(checklistView);
  const capabilities = authorizeShell(null, null);
  const navigation = navigationFromSession(null);
  return (
    <Shell
      checklistMarkup={checklistMarkup}
      capabilities={capabilities}
      status={status.status}
      environment={knownEnvironment(process.env.APP_ENV)}
      navigation={navigation}
      branding={branding}
      previews={approvedPreviews()}
    />
  );
}
