export const METRIC_FAMILIES: readonly ["latency", "uptime", "rate-limit", "security", "device-error"];
export const BREACH_STATES: readonly ["UNKNOWN", "BREACH", "WITHIN"];
export const METRIC_FIELDS: readonly ["target", "measured", "limit", "source", "sampleWindow", "breach"];
export const OBSERVED_SERIES: readonly ["p50", "p95", "p99", "freshness", "disconnects", "rateLimitHeadroom"];
export const SYNTHETIC_SURFACES: readonly ["browser", "mobile"];
export const SYNTHETIC_CHECKS: readonly ["page", "login", "resend-password", "layout"];
export const TRUTH: "MOCK";

export type BoundField = { configured: boolean; value: number | null; note: string };
export type MeasuredField = {
  present: boolean;
  value: number | null;
  evidence: string | null;
  note: string | null;
};
export type BreachState = "UNKNOWN" | "BREACH" | "WITHIN";

export type MetricRow = {
  id: string;
  family: (typeof METRIC_FAMILIES)[number];
  owner: string | null;
  target: BoundField;
  measured: MeasuredField;
  limit: BoundField;
  source: string;
  sampleWindow: BoundField;
  breach: BreachState;
};

export type SeriesCell = {
  target: BoundField;
  measured: MeasuredField;
  limit: BoundField;
  source: string;
  sampleWindow: BoundField;
  breach: BreachState;
};

export type SecurityCheck = SeriesCell & { name: string; owner: string | null };

export type SyntheticRow = {
  surface: (typeof SYNTHETIC_SURFACES)[number];
  check: (typeof SYNTHETIC_CHECKS)[number];
  result: "UNKNOWN" | "FAIL";
  evidence: string | null;
  note: string;
};

export type ReadinessView = {
  truth: "MOCK";
  metrics: readonly MetricRow[];
  observed: {
    p50: SeriesCell;
    p95: SeriesCell;
    p99: SeriesCell;
    freshness: SeriesCell;
    disconnects: SeriesCell;
    rateLimitHeadroom: SeriesCell;
    securityChecks: readonly SecurityCheck[];
  };
  synthetic: readonly SyntheticRow[];
  orders: false;
  walletAccess: false;
};

export function percentileOf(samples: readonly number[], percent: number): number;
export function readinessCatalog(): MetricRow[];
export function observedSnapshot(): ReadinessView["observed"];
export function syntheticViews(): readonly SyntheticRow[];
export function readinessView(): ReadinessView;
export function displayOwner(owner: string | null | undefined): string;
export function fieldText(field: BoundField | MeasuredField | null | undefined): string;
export function definitionTable(view?: ReadinessView): Array<{
  metric: string;
  owner: string;
  target: string;
  measured: string;
  measuredEvidence: string | null;
  limit: string;
  source: string;
  sampleWindow: string;
  breach: BreachState;
}>;
export function evaluateReading(input: {
  family: string;
  owner?: string | null;
  status?: string;
  breach?: string;
  target?: { configured?: boolean; value?: number | null } | null;
  limit?: { configured?: boolean; value?: number | null } | null;
  sampleWindow?: { configured?: boolean; value?: number | null } | null;
  measured?: { present?: boolean; value?: number | null; evidence?: string | null } | null;
}): { ok: true; row: MetricRow } | { ok: false; error: string };
export function assignOwner(row: MetricRow, role: string): { ok: true; row: MetricRow } | { ok: false; error: string };
export function rateLimitHeadroom(policy: { accountLimit?: number; windowMs?: number } | null, used?: number): {
  ok: true;
  configured: boolean;
  limit: number | null;
  sampleWindow: number | null;
  measured: number | null;
  evidence: string | null;
  breach: "UNKNOWN";
  note: string;
};
export function applySearchReport(view: ReadinessView | null, report: {
  ok?: boolean;
  measured?: { p50?: number; p95?: number; p99?: number; freshness?: number };
  targets?: Record<string, { configured?: boolean; value?: number }>;
}): { ok: true; view: ReadinessView } | { ok: false; error: string };
export function recordSynthetic(view: ReadinessView | null, input: {
  surface: string;
  check: string;
  result?: string | null;
  evidence?: string | null;
}): { ok: true; view: ReadinessView } | { ok: false; error: string };
export function attachTestEvent(view?: ReadinessView | null): ReadinessView;
export function greenReadings(view: ReadinessView): string[];
