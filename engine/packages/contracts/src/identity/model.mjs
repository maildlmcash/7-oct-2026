// Parent and child links stay inside one tenant.
// A tenant may point at another tenant as its subtree parent.
// A principal's parent must be a principal of that same tenant.

export function tenantParentLink({ tenantId, parentId }) {
  if (parentId == null) return { ok: true };
  if (tenantId == null) return { ok: false, error: "tenant is outside subtree" };
  if (String(parentId) === String(tenantId)) return { ok: false, error: "parent cycle" };
  return { ok: true };
}

export function assignmentParentLink({ tenantId, parentTenantId }) {
  if (parentTenantId == null) return { ok: true };
  if (tenantId == null || String(parentTenantId) !== String(tenantId)) {
    return { ok: false, error: "tenant is outside subtree" };
  }
  return { ok: true };
}

// True when targetId is actorId, or a descendant found by walking parentOf
// from the target toward the root. A cycle or a broken chain is outside.
export function isInSubtree(actorId, targetId, parentOf) {
  if (actorId == null || targetId == null || typeof parentOf !== "function") return false;
  const actor = String(actorId);
  let current = String(targetId);
  const seen = new Set();
  while (!seen.has(current)) {
    if (current === actor) return true;
    seen.add(current);
    let parent;
    try {
      parent = parentOf(current);
    } catch {
      return false;
    }
    if (parent == null) return false;
    current = String(parent);
  }
  return false;
}
