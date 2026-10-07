import { SHELL_SECTIONS } from "@crypto-prediction-engine/contracts";

// The source asks for a request correlation ID and names no header or charset.
// A UUID is accepted. Any other inbound value is replaced so a secret is not echoed.
export const CORRELATION_HEADER = "x-correlation-id";
export const SECTION_HEADER = "x-shell-section";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SECTION_SET = new Set(SHELL_SECTIONS);
const ROUTES = new Set(["/api/view-state", "/api/checklist-owner", "section-render"]);

export function resolveCorrelationId(header) {
  if (typeof header === "string" && UUID_PATTERN.test(header)) return header;
  return crypto.randomUUID();
}

export function shellSectionName(header) {
  if (typeof header === "string" && SECTION_SET.has(header)) return header;
  return null;
}

export function diagnosticEvent(input) {
  const source = input && typeof input === "object" ? input : {};
  const route = typeof source.route === "string" && ROUTES.has(source.route) ? source.route : null;
  const httpStatus = Number.isInteger(source.httpStatus) ? source.httpStatus : null;
  return {
    correlationId: resolveCorrelationId(source.correlationId),
    section: shellSectionName(source.section),
    route,
    httpStatus,
  };
}
