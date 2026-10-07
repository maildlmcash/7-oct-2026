import { ROLE_NAMES } from "../packages/contracts/src/roles.mjs";
import { canEditChecklist, editChecklistOwner } from "./checklist-status-view.mjs";

// The contract owns the names. This module does not add catalog permissions.
export const SHELL_ROLES = ROLE_NAMES;

function sameCustomer(actor, tenantId) {
  return Boolean(actor) && actor.role === "Customer" && actor.tenantId === tenantId;
}

export function authorizeShell(actor, tenantId) {
  return {
    editChecklist: canEditChecklist(actor, tenantId),
    userChecklist: sameCustomer(actor, tenantId),
    market: sameCustomer(actor, tenantId),
  };
}

export function authorizeChecklistWrite(input) {
  if (!canEditChecklist(input?.actor, input?.tenantId)) {
    return { ok: false, error: "role scope denied" };
  }
  return { ok: true };
}

export function writeChecklistOwner(store, input) {
  const allowed = authorizeChecklistWrite(input);
  if (!allowed.ok) {
    return allowed;
  }
  return editChecklistOwner(store, input);
}

export function renderSectionCapability(capabilities, section, checklistMarkup = "") {
  if (section === "Admin" && capabilities?.editChecklist === true) {
    return '<section data-view="admin-controls"><button type="button">Edit checklist</button></section>';
  }
  if (section === "Checklist" && capabilities?.userChecklist === true) {
    return `<section data-view="user-checklist">${checklistMarkup}</section>`;
  }
  if (section === "Market" && capabilities?.market === true) {
    return '<section data-view="market"><p>market view</p></section>';
  }
  if (section === "Checklist") {
    return checklistMarkup;
  }
  return "";
}
