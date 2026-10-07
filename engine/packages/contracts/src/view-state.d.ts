export const SHELL_SECTIONS: readonly [
  "Dashboard",
  "Market",
  "Predictions",
  "Search",
  "Checklist",
  "Bugs",
  "Admin",
];

export type ShellSection = (typeof SHELL_SECTIONS)[number];

/** The source names no shell filter fields. Only an empty object is valid. */
export type ViewFilters = Record<string, never>;

/**
 * pageIndex 0 is the first page. The source does not define that origin.
 * pageSize is caller-supplied. The source does not define a page size.
 */
export type ViewPagination = {
  pageIndex: number;
  pageSize: number;
};

/** User-visible checklist status states already produced by the status view. */
export type UserVisibleState = "empty" | "loading" | "ready" | "error";

export type UserVisibleCounts = {
  PASS: number;
  FAIL: number;
  BLOCKED: number;
  STALE: number;
};

export type UserVisibleStatus = {
  state: UserVisibleState;
  counts: UserVisibleCounts;
  error: string | null;
};

export type ClientViewState = {
  section: ShellSection;
  filters: ViewFilters;
  pagination: ViewPagination;
  status: UserVisibleStatus;
};

export type ViewStateResult =
  | { ok: true; state: ClientViewState }
  | { ok: false; error: string };

export function emptyUserVisibleStatus(): UserVisibleStatus;

export function parseUserVisibleStatus(
  input: unknown,
): { ok: true; status: UserVisibleStatus } | { ok: false; error: string };

export function initialClientViewState(input: {
  pageSize: number;
  status: unknown;
}): ViewStateResult;

/** A document refresh uses the same initial state. It does not restore the previous view. */
export function refreshClientViewState(input: {
  pageSize: number;
  status: unknown;
}): ViewStateResult;

export function parseClientViewState(input: unknown): ViewStateResult;

export function selectSection(state: ClientViewState, section: unknown): ViewStateResult;

export function setPageIndex(state: ClientViewState, pageIndex: unknown): ViewStateResult;
