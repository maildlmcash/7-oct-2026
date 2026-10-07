import assert from "node:assert/strict";
import test from "node:test";
import {
  emptyUserVisibleStatus,
  initialClientViewState,
  parseClientViewState,
  refreshClientViewState,
  selectSection,
  setPageIndex,
  SHELL_SECTIONS,
} from "../packages/contracts/src/view-state.mjs";

const emptyStatus = emptyUserVisibleStatus();

function validState(overrides = {}) {
  return {
    section: "Dashboard",
    filters: {},
    pagination: { pageIndex: 0, pageSize: 2 },
    status: emptyStatus,
    ...overrides,
  };
}

test("initial and refresh view state use Dashboard, empty filters, and the first page", () => {
  const initial = initialClientViewState({ pageSize: 2, status: emptyStatus });
  const refreshed = refreshClientViewState({ pageSize: 2, status: emptyStatus });
  assert.equal(initial.ok, true);
  assert.deepEqual(initial.state, refreshed.state);
  assert.equal(initial.state.section, "Dashboard");
  assert.deepEqual(initial.state.filters, {});
  assert.deepEqual(initial.state.pagination, { pageIndex: 0, pageSize: 2 });
  assert.equal(initial.state.status.state, "empty");
  assert.equal(initial.state.status.error, null);
  assert.deepEqual(SHELL_SECTIONS, [
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
});

test("refresh replaces a changed section and page", () => {
  const initial = initialClientViewState({ pageSize: 2, status: emptyStatus });
  const selected = selectSection(initial.state, "Market");
  const paged = setPageIndex(selected.state, 1);
  assert.equal(paged.state.section, "Market");
  assert.equal(paged.state.pagination.pageIndex, 1);
  const refreshed = refreshClientViewState({ pageSize: 2, status: emptyStatus });
  assert.deepEqual(refreshed.state.section, "Dashboard");
  assert.deepEqual(refreshed.state.pagination.pageIndex, 0);
});

test("invalid section, filters, pagination, and status are rejected", () => {
  const initial = initialClientViewState({ pageSize: 2, status: emptyStatus });
  assert.deepEqual(selectSection(initial.state, "Settings"), { ok: false, error: "invalid section" });
  assert.deepEqual(selectSection(initial.state, "dashboard"), { ok: false, error: "invalid section" });
  assert.equal(initial.state.section, "Dashboard");

  assert.equal(parseClientViewState(validState({ filters: { symbol: "BTC" } })).error, "invalid filters");
  assert.equal(parseClientViewState(validState({ pagination: { pageIndex: -1, pageSize: 2 } })).error, "invalid page");
  assert.equal(parseClientViewState(validState({ pagination: { pageIndex: 1.5, pageSize: 2 } })).error, "invalid page");
  assert.equal(parseClientViewState(validState({ pagination: { pageIndex: 0, pageSize: 0 } })).error, "invalid page size");
  assert.equal(parseClientViewState(validState({ pagination: { pageIndex: 0, pageSize: "2" } })).error, "invalid page size");
  assert.equal(setPageIndex(initial.state, -1).error, "invalid page");
  assert.equal(initial.state.pagination.pageIndex, 0);

  assert.equal(parseClientViewState(validState({ status: { ...emptyStatus, state: "READY" } })).error, "invalid status");
  assert.equal(
    parseClientViewState(validState({ status: { state: "empty", counts: { PASS: 0 }, error: null } })).error,
    "invalid status",
  );
  assert.equal(
    parseClientViewState(validState({
      status: { state: "error", counts: emptyStatus.counts, error: "   " },
    })).error,
    "invalid status",
  );
  assert.equal(initialClientViewState({ pageSize: 2 }).error, "invalid status");
  const extra = initialClientViewState({ pageSize: 2, status: emptyStatus, secret: "super-secret-value" });
  assert.equal(extra.error, "unknown field");
  assert.equal(JSON.stringify(extra).includes("super-secret-value"), false);
});

test("secrets and exchange credentials are rejected and not echoed", () => {
  const secret = "super-secret-value";
  const cases = [
    validState({ secret }),
    validState({ credential: "exchange-key" }),
    validState({ apiKey: secret }),
    validState({ filters: { exchangeCredential: secret } }),
  ];
  for (const input of cases) {
    const result = parseClientViewState(input);
    assert.equal(result.ok, false);
    assert.equal(JSON.stringify(result).includes(secret), false);
    assert.equal(JSON.stringify(result).includes("exchange-key"), false);
  }
});

test("a valid view state is accepted and selectSection does not change pagination", () => {
  const parsed = parseClientViewState(validState({ section: "Checklist", pagination: { pageIndex: 3, pageSize: 2 } }));
  assert.equal(parsed.ok, true);
  assert.equal(parsed.state.section, "Checklist");
  assert.equal(parsed.state.pagination.pageIndex, 3);
  const selected = selectSection(parsed.state, "Bugs");
  assert.equal(selected.state.section, "Bugs");
  assert.equal(selected.state.pagination.pageIndex, 3);
  assert.equal(parsed.state.section, "Checklist");
});
