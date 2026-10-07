// Control-operation ids for the policy evaluator.
// GET and POST /api/checklist-owner are the protected HTTP handlers.
// /api/control/* ids are evaluator routes only. They are not HTTP handlers.

export const CONTROL_ROUTES = Object.freeze([
  Object.freeze({ method: "GET", path: "/api/checklist-owner", capability: "checklist.read", privileged: false }),
  Object.freeze({ method: "POST", path: "/api/checklist-owner", capability: "checklist.write", privileged: true }),
  Object.freeze({ method: "POST", path: "/api/control/policy", capability: "global.policy", privileged: true }),
  Object.freeze({ method: "POST", path: "/api/control/tenant", capability: "tenant.admin", privileged: true }),
  Object.freeze({ method: "POST", path: "/api/control/subtree", capability: "subtree.delegate", privileged: true }),
  Object.freeze({ method: "POST", path: "/api/control/commission", capability: "commission.manage", privileged: true }),
  Object.freeze({ method: "GET", path: "/api/control/principals", capability: "other-user.read", privileged: true }),
  Object.freeze({ method: "POST", path: "/api/control/connector", capability: "connector.secret", privileged: true }),
]);

export function matchControlRoute(method, path) {
  const verb = typeof method === "string" ? method.toUpperCase() : "";
  const name = typeof path === "string" ? path : "";
  return CONTROL_ROUTES.find((route) => route.method === verb && route.path === name) ?? null;
}
