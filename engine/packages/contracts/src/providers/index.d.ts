export const PROVIDER_LISTS: readonly ["CEX", "DEX", "data vendor", "wallet-monitoring"];
export const CONNECTION_STATUSES: readonly ["NOT_CONFIGURED", "NOT_TESTED"];
export const DETAIL_TABS: readonly ["REST", "WebSocket", "chain/RPC", "fields", "calculations", "permissions"];
export const CAPABILITY_LABELS: readonly ["public-read-only", "account-read", "trade"];
export const EDITABLE_FIELDS: readonly ["product", "version", "sourceUrl"];
export const REGISTRY_COLUMNS: readonly ["status", "product", "version", "lastVerified", "sourceUrl"];

export type ProviderRecord = {
  id: string;
  list: (typeof PROVIDER_LISTS)[number];
  tenantId: string;
  product: string;
  version: string;
  sourceUrl: string | null;
  lastVerified: null;
  capabilities: {
    "public-read-only": string;
    "account-read": "unavailable";
    trade: "unavailable";
  };
  tabs: Record<string, unknown>;
};

export function connectionStatus(record: { sourceUrl?: string | null }): "NOT_CONFIGURED" | "NOT_TESTED";

export function screenRegistry(): ProviderRecord[];

export function registrySchema(): {
  lists: string[];
  columns: string[];
  statuses: string[];
  tabs: string[];
  capabilityLabels: string[];
  editable: string[];
  lastVerified: null;
  connectionTest: "NOT_TESTED";
  secrets: false;
  orders: false;
  walletAccess: false;
};

export function filterProviders<T extends ProviderRecord>(rows: readonly T[], query: string): T[];

export function sortProviders<T extends ProviderRecord>(rows: readonly T[], key: string, direction?: "asc" | "desc"): T[];

export function editProviderMetadata(
  record: ProviderRecord,
  patch: Record<string, unknown>,
  actor: { role?: string; tenantId?: string } | null,
): { ok: true; record: ProviderRecord; status: "NOT_CONFIGURED" | "NOT_TESTED" } | { ok: false; error: string };
