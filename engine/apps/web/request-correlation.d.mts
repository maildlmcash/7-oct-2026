export const CORRELATION_HEADER: "x-correlation-id";
export const SECTION_HEADER: "x-shell-section";

export function resolveCorrelationId(header: unknown): string;
export function shellSectionName(header: unknown): string | null;

export type DiagnosticEvent = {
  correlationId: string;
  section: string | null;
  route: string | null;
  httpStatus: number | null;
};

export function diagnosticEvent(input: {
  correlationId?: unknown;
  section?: unknown;
  route?: unknown;
  httpStatus?: unknown;
}): DiagnosticEvent;
