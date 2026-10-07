// Control-room provider lists for task 1.C.1.
// A source URL is metadata. It is not a connection test.
// Last verified stays empty. Account-read and trade stay unavailable.

export const PROVIDER_LISTS = Object.freeze(["CEX", "DEX", "data vendor", "wallet-monitoring"]);
export const CONNECTION_STATUSES = Object.freeze(["NOT_CONFIGURED", "NOT_TESTED"]);
export const DETAIL_TABS = Object.freeze(["REST", "WebSocket", "chain/RPC", "fields", "calculations", "permissions"]);
export const CAPABILITY_LABELS = Object.freeze(["public-read-only", "account-read", "trade"]);
export const EDITABLE_FIELDS = Object.freeze(["product", "version", "sourceUrl"]);
export const REGISTRY_COLUMNS = Object.freeze(["status", "product", "version", "lastVerified", "sourceUrl"]);

const LIST_SET = new Set(PROVIDER_LISTS);
const EDITABLE = new Set(EDITABLE_FIELDS);

export function connectionStatus(record) {
  if (record?.sourceUrl == null || String(record.sourceUrl).trim() === "") return "NOT_CONFIGURED";
  return "NOT_TESTED";
}

function capabilities(sourceUrl) {
  return Object.freeze({
    "public-read-only": sourceUrl ? "declared" : "NOT_CONFIGURED",
    "account-read": "unavailable",
    trade: "unavailable",
  });
}

function row(input) {
  const sourceUrl = input.sourceUrl ?? null;
  return Object.freeze({
    id: input.id,
    list: input.list,
    tenantId: "screen",
    product: input.product,
    version: input.version,
    sourceUrl,
    lastVerified: null,
    capabilities: capabilities(sourceUrl),
    tabs: input.tabs,
  });
}

const emptyTabs = Object.freeze({
  REST: Object.freeze({ family: "none", version: "none", endpoints: Object.freeze([]) }),
  WebSocket: Object.freeze({ version: "none", host: null, streams: Object.freeze([]) }),
  "chain/RPC": Object.freeze({ state: "NOT_CONFIGURED", endpoints: Object.freeze([]) }),
  fields: Object.freeze([]),
  calculations: Object.freeze(["none configured"]),
  permissions: CAPABILITY_LABELS,
});

export function screenRegistry() {
  return [
    row({
      id: "cex-binance-spot",
      list: "CEX",
      product: "Binance Spot",
      version: "2026-09-18",
      sourceUrl: "https://data-api.binance.vision/",
      tabs: {
        REST: { family: "public market", version: "v3", endpoints: ["GET /api/v3/exchangeInfo", "GET /api/v3/ticker/bookTicker", "GET /api/v3/trades"] },
        WebSocket: { version: "2026-09-18", host: "wss://data-stream.binance.vision:443", streams: ["<symbol>@trade", "<symbol>@bookTicker"] },
        "chain/RPC": { state: "NOT_CONFIGURED", endpoints: [] },
        fields: ["symbol", "price", "quantity"],
        calculations: ["none configured"],
        permissions: [...CAPABILITY_LABELS],
      },
    }),
    row({
      id: "cex-unnamed",
      list: "CEX",
      product: "CEX adapter not named",
      version: "none",
      tabs: emptyTabs,
    }),
    row({
      id: "dex-unnamed",
      list: "DEX",
      product: "DEX adapter not named",
      version: "none",
      tabs: emptyTabs,
    }),
    row({
      id: "vendor-unnamed",
      list: "data vendor",
      product: "Data vendor not named",
      version: "none",
      tabs: emptyTabs,
    }),
    row({
      id: "wallet-monitor",
      list: "wallet-monitoring",
      product: "Wallet monitor not named",
      version: "none",
      tabs: emptyTabs,
    }),
  ];
}

export function registrySchema() {
  return {
    lists: [...PROVIDER_LISTS],
    columns: [...REGISTRY_COLUMNS],
    statuses: [...CONNECTION_STATUSES],
    tabs: [...DETAIL_TABS],
    capabilityLabels: [...CAPABILITY_LABELS],
    editable: [...EDITABLE_FIELDS],
    lastVerified: null,
    connectionTest: "NOT_TESTED",
    secrets: false,
    orders: false,
    walletAccess: false,
  };
}

export function filterProviders(rows, query) {
  const needle = typeof query === "string" ? query.trim().toLowerCase() : "";
  if (needle.length === 0) return [...rows];
  return rows.filter((record) => {
    const haystack = [
      connectionStatus(record),
      record.product,
      record.version,
      record.sourceUrl ?? "",
      record.lastVerified ?? "not verified",
    ].join(" ").toLowerCase();
    return haystack.includes(needle);
  });
}

function sortValue(record, key) {
  if (key === "status") return connectionStatus(record);
  if (key === "lastVerified") return record.lastVerified ?? "";
  if (key === "sourceUrl") return record.sourceUrl ?? "";
  return record[key] ?? "";
}

export function sortProviders(rows, key, direction = "asc") {
  const name = REGISTRY_COLUMNS.includes(key) ? key : "product";
  const factor = direction === "desc" ? -1 : 1;
  return [...rows].sort((left, right) => {
    const compared = String(sortValue(left, name)).localeCompare(String(sortValue(right, name)));
    if (compared !== 0) return compared * factor;
    return left.id.localeCompare(right.id);
  });
}

function unsafe(value) {
  if (typeof value !== "string") return false;
  if (/^live$/i.test(value.trim())) return true;
  if (/bearer\s+/i.test(value)) return true;
  if (value.includes("BEGIN PRIVATE KEY")) return true;
  if (/seed phrase/i.test(value)) return true;
  if (/api[_-]?key|api[_-]?secret|private[_-]?key/i.test(value)) return true;
  return false;
}

function sourceUrlValue(value) {
  if (value == null || value === "") return { ok: true, value: null };
  if (typeof value !== "string" || unsafe(value)) return { ok: false, error: "secret value is not allowed" };
  let url;
  try {
    url = new URL(value.trim());
  } catch {
    return { ok: false, error: "source URL is not allowed" };
  }
  if (!["http:", "https:", "wss:"].includes(url.protocol)) return { ok: false, error: "source URL is not allowed" };
  if (url.username || url.password) return { ok: false, error: "secret value is not allowed" };
  if (/key|token|secret/i.test(url.search)) return { ok: false, error: "secret value is not allowed" };
  return { ok: true, value: url.toString() };
}

export function editProviderMetadata(record, patch, actor) {
  if (!record || !LIST_SET.has(record.list)) return { ok: false, error: "provider not found" };
  if (!actor || actor.role !== "Admin" || actor.tenantId !== record.tenantId) {
    return { ok: false, error: "role scope denied" };
  }
  const source = patch && typeof patch === "object" && !Array.isArray(patch) ? patch : {};
  const keys = Object.keys(source);
  if (keys.length === 0 || keys.some((key) => !EDITABLE.has(key))) {
    return { ok: false, error: "field is not editable" };
  }
  const next = {
    ...record,
    capabilities: capabilities(record.sourceUrl),
    lastVerified: null,
  };
  if (Object.hasOwn(source, "product")) {
    if (typeof source.product !== "string" || source.product.trim().length === 0 || unsafe(source.product)) {
      return { ok: false, error: unsafe(source.product) ? "secret value is not allowed" : "product is required" };
    }
    next.product = source.product.trim();
  }
  if (Object.hasOwn(source, "version")) {
    if (typeof source.version !== "string" || source.version.trim().length === 0 || unsafe(source.version)) {
      return { ok: false, error: unsafe(source.version) ? "secret value is not allowed" : "version is required" };
    }
    next.version = source.version.trim();
  }
  if (Object.hasOwn(source, "sourceUrl")) {
    const parsed = sourceUrlValue(source.sourceUrl);
    if (!parsed.ok) return parsed;
    next.sourceUrl = parsed.value;
  }
  next.capabilities = capabilities(next.sourceUrl);
  next.lastVerified = null;
  return { ok: true, record: next, status: connectionStatus(next) };
}
