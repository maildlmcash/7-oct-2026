export const CHECKLIST_STATUSES = Object.freeze([
  "NOT_STARTED",
  "IN_PROGRESS",
  "PASS",
  "FAIL",
  "BLOCKED",
  "NOT_APPLICABLE",
]);

const STATUS_SET = new Set(CHECKLIST_STATUSES);

// The source does not enumerate "unresolved". PASS closes an item.
// NOT_APPLICABLE means the item does not apply. Every other status is still open.
const RESOLVED = new Set(["PASS", "NOT_APPLICABLE"]);

export function checklistPrerequisiteUnresolved(status) {
  return !RESOLVED.has(status);
}

function blank(value) {
  return typeof value !== "string" || value.trim().length === 0;
}

export function assertChecklistStatus(status) {
  if (!STATUS_SET.has(status)) {
    return { ok: false, error: "invalid status" };
  }
  return { ok: true, status };
}

export function transitionChecklistItem(input) {
  const fromStatus = assertChecklistStatus(input.fromStatus);
  if (!fromStatus.ok) {
    return fromStatus;
  }
  const toStatus = assertChecklistStatus(input.toStatus);
  if (!toStatus.ok) {
    return toStatus;
  }

  const prerequisites = input.prerequisites ?? [];
  if (
    toStatus.status === "IN_PROGRESS" &&
    prerequisites.some((item) => item.status === "BLOCKED")
  ) {
    return { ok: false, error: "a BLOCKED prerequisite locks the downstream task" };
  }

  if (toStatus.status === "PASS") {
    const unresolved = prerequisites.some((item) => !RESOLVED.has(item.status));
    if (unresolved) {
      return {
        ok: false,
        error: "a dependent task cannot pass while a prerequisite is unresolved",
      };
    }
    if (input.hasEvidence !== true) {
      return { ok: false, error: "PASS requires evidence" };
    }
    if (blank(input.approver)) {
      return { ok: false, error: "PASS requires an approver" };
    }
    if (input.passExpiry == null || input.passExpiry === "") {
      return { ok: false, error: "PASS requires pass_expiry" };
    }
  }

  if (toStatus.status === "NOT_APPLICABLE") {
    if (blank(input.reason)) {
      return { ok: false, error: "NOT_APPLICABLE requires a reason" };
    }
    if (blank(input.approver)) {
      return { ok: false, error: "NOT_APPLICABLE requires an authorized approver" };
    }
  }

  if ((toStatus.status === "FAIL" || toStatus.status === "BLOCKED") && input.hasLinkedFinding !== true) {
    return { ok: false, error: "FAIL or BLOCKED requires a linked finding" };
  }

  return { ok: true, status: toStatus.status };
}
