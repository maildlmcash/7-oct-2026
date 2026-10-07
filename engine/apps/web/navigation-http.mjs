// Direct navigation calls use the server identity session.
// The desk cookie is not an identity role. A missing session is login denied.
// The JSON body cannot select a role or a preview.

import { decideNavigationAction } from "./app/navigation/matrix.mjs";

async function readFields(request) {
  try {
    const body = await request.json();
    if (!body || typeof body !== "object" || Array.isArray(body)) return { action: null, screen: null };
    return {
      action: typeof body.action === "string" ? body.action : null,
      screen: typeof body.screen === "string" ? body.screen : null,
    };
  } catch {
    return { action: null, screen: null };
  }
}

export async function postNavigationAction(request, runtime) {
  const identity = runtime?.identitySession?.authenticated === true ? runtime.identitySession : null;
  const fields = identity ? await readFields(request) : { action: null, screen: null };
  const decision = decideNavigationAction(identity, fields);
  const status = decision.ok ? 200 : decision.error === "login denied" ? 401 : 403;
  const body = decision.ok ? { ok: true } : { ok: false, error: decision.error };
  return Response.json(body, { status });
}
