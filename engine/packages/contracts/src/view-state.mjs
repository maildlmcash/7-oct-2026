export const SHELL_SECTIONS = Object.freeze([
  "Dashboard",
  "Market",
  "DEX",
  "Wallets",
  "Predictions",
  "Paper",
  "Search",
  "Checklist",
  "Bugs",
  "Admin",
]);

const SECTION_SET = new Set(SHELL_SECTIONS);
const STATUS_STATES = new Set(["empty", "loading", "ready", "error"]);
const COUNT_KEYS = Object.freeze(["PASS", "FAIL", "BLOCKED", "STALE"]);
const VIEW_KEYS = Object.freeze(["section", "filters", "pagination", "status"]);
const PAGINATION_KEYS = Object.freeze(["pageIndex", "pageSize"]);
const STATUS_KEYS = Object.freeze(["state", "counts", "error"]);

function plainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function unknownKey(value, allowed) {
  for (const key of Object.keys(value)) {
    if (!allowed.includes(key)) return true;
  }
  return false;
}

function integerAtLeast(value, minimum) {
  return typeof value === "number" && Number.isInteger(value) && value >= minimum;
}

function copyCounts(counts) {
  return {
    PASS: counts.PASS,
    FAIL: counts.FAIL,
    BLOCKED: counts.BLOCKED,
    STALE: counts.STALE,
  };
}

function copyState(state) {
  return {
    section: state.section,
    filters: {},
    pagination: {
      pageIndex: state.pagination.pageIndex,
      pageSize: state.pagination.pageSize,
    },
    status: {
      state: state.status.state,
      counts: copyCounts(state.status.counts),
      error: state.status.error,
    },
  };
}

export function emptyUserVisibleStatus() {
  return {
    state: "empty",
    counts: { PASS: 0, FAIL: 0, BLOCKED: 0, STALE: 0 },
    error: null,
  };
}

export function parseUserVisibleStatus(input) {
  if (!plainObject(input) || unknownKey(input, STATUS_KEYS)) {
    return { ok: false, error: "invalid status" };
  }
  if (!STATUS_STATES.has(input.state)) {
    return { ok: false, error: "invalid status" };
  }
  if (!plainObject(input.counts) || unknownKey(input.counts, COUNT_KEYS)) {
    return { ok: false, error: "invalid status" };
  }
  const counts = {};
  for (const key of COUNT_KEYS) {
    if (!integerAtLeast(input.counts[key], 0)) {
      return { ok: false, error: "invalid status" };
    }
    counts[key] = input.counts[key];
  }
  if (input.state === "error") {
    if (typeof input.error !== "string" || input.error.trim().length === 0) {
      return { ok: false, error: "invalid status" };
    }
    return { ok: true, status: { state: "error", counts, error: input.error } };
  }
  if (input.error !== null) {
    return { ok: false, error: "invalid status" };
  }
  return { ok: true, status: { state: input.state, counts, error: null } };
}

function parseFilters(input) {
  if (!plainObject(input) || Object.keys(input).length > 0) {
    return { ok: false, error: "invalid filters" };
  }
  return { ok: true, filters: {} };
}

function parsePagination(input) {
  if (!plainObject(input) || unknownKey(input, PAGINATION_KEYS)) {
    return { ok: false, error: "invalid pagination" };
  }
  if (!integerAtLeast(input.pageIndex, 0)) {
    return { ok: false, error: "invalid page" };
  }
  if (!integerAtLeast(input.pageSize, 1)) {
    return { ok: false, error: "invalid page size" };
  }
  return {
    ok: true,
    pagination: { pageIndex: input.pageIndex, pageSize: input.pageSize },
  };
}

export function parseClientViewState(input) {
  if (!plainObject(input) || unknownKey(input, VIEW_KEYS)) {
    return { ok: false, error: "unknown field" };
  }
  if (!SECTION_SET.has(input.section)) {
    return { ok: false, error: "invalid section" };
  }
  const filters = parseFilters(input.filters);
  if (!filters.ok) return filters;
  const pagination = parsePagination(input.pagination);
  if (!pagination.ok) return pagination;
  const status = parseUserVisibleStatus(input.status);
  if (!status.ok) return status;
  return {
    ok: true,
    state: {
      section: input.section,
      filters: filters.filters,
      pagination: pagination.pagination,
      status: status.status,
    },
  };
}

export function initialClientViewState(input) {
  if (!plainObject(input) || unknownKey(input, ["pageSize", "status"])) {
    return { ok: false, error: "unknown field" };
  }
  return parseClientViewState({
    section: "Dashboard",
    filters: {},
    pagination: { pageIndex: 0, pageSize: input.pageSize },
    status: input.status,
  });
}

export function refreshClientViewState(input) {
  return initialClientViewState(input);
}

export function selectSection(state, section) {
  if (!SECTION_SET.has(section)) {
    return { ok: false, error: "invalid section" };
  }
  const next = copyState(state);
  next.section = section;
  return { ok: true, state: next };
}

export function setPageIndex(state, pageIndex) {
  if (!integerAtLeast(pageIndex, 0)) {
    return { ok: false, error: "invalid page" };
  }
  const next = copyState(state);
  next.pagination.pageIndex = pageIndex;
  return { ok: true, state: next };
}
