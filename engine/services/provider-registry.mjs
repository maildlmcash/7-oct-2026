// Versioned provider registry for TASK 06.A.01 and vault references for TASK 06.A.02.
// Kinds are the five names in the task. The source names no numeric limit,
// heartbeat interval, provider status vocabulary, or secret-manager product.
// Market-data scope is read-only. Order credentials are a separate configuration.
// Withdrawals stay closed. This module does not connect to an endpoint and does
// not store a secret value.

export const PROVIDER_KINDS = Object.freeze([
  "CEX",
  "DEX",
  "chain",
  "market-data API",
  "WebSocket",
]);

const KIND_SET = new Set(PROVIDER_KINDS);
const MARKET_SCOPE = "read-only";
const ORDER_SCOPE = "order-capable";
const CREDENTIAL_KEYS = new Set(["vaultReference", "permissionScope"]);
const SECRET_KEYS = new Set([
  "password",
  "otp",
  "apisecret",
  "api_secret",
  "apikey",
  "api_key",
  "privatekey",
  "private_key",
  "seedphrase",
  "seed_phrase",
  "accesstoken",
  "access_token",
  "authorization",
  "cookie",
  "credential",
  "token",
  "secret",
  "set-cookie",
  "x-csrf-token",
  "x-api-key",
]);
const EMAIL = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i;

function blank(value) {
  return typeof value !== "string" || value.trim().length === 0;
}

function denied(actor, tenantId) {
  if (!actor || actor.role !== "Admin" || actor.tenantId !== tenantId) {
    return { ok: false, error: "role scope denied" };
  }
  return null;
}

function requireText(value, error) {
  if (blank(value)) {
    return { ok: false, error };
  }
  return { ok: true, value: value.trim() };
}

function optionalText(value, error) {
  if (value == null) {
    return { ok: true, value: null };
  }
  if (typeof value !== "string") {
    return { ok: false, error };
  }
  const trimmed = value.trim();
  return { ok: true, value: trimmed.length === 0 ? null : trimmed };
}

function collectSecrets(value, found) {
  if (!value || typeof value !== "object") return;
  if (Array.isArray(value)) {
    for (const item of value) collectSecrets(item, found);
    return;
  }
  for (const [key, item] of Object.entries(value)) {
    if (SECRET_KEYS.has(key.toLowerCase()) && typeof item === "string" && item.length >= 4) {
      found.add(item);
    }
    collectSecrets(item, found);
  }
}

function leaked(value, secrets) {
  if (typeof value !== "string" || value.length === 0) return false;
  if (EMAIL.test(value)) return true;
  if (/bearer\s+/i.test(value)) return true;
  if (value.includes("BEGIN PRIVATE KEY")) return true;
  if (/seed phrase/i.test(value)) return true;
  for (const secret of secrets) {
    if (value.includes(secret)) return true;
  }
  return false;
}

function textsAllowed(values, secrets) {
  for (const value of values) {
    if (typeof value === "string" && leaked(value, secrets)) {
      return { ok: false, error: "secret value is not allowed" };
    }
  }
  return { ok: true };
}

function copyCredential(value) {
  if (!value) return null;
  return Object.freeze({
    vaultReference: value.vaultReference,
    permissionScope: value.permissionScope,
  });
}

function resolveOne(value, scope, scopeError, secrets) {
  if (value == null) return { ok: true, value: null };
  if (typeof value !== "object" || Array.isArray(value)) {
    return { ok: false, error: "credential configuration is required" };
  }
  for (const key of Object.keys(value)) {
    if (!CREDENTIAL_KEYS.has(key)) {
      return { ok: false, error: "credential field is not allowed" };
    }
  }
  const reference = requireText(value.vaultReference, "vault reference is required");
  if (!reference.ok) return reference;
  if (leaked(reference.value, secrets)) {
    return { ok: false, error: "vault reference is not allowed" };
  }
  if (value.permissionScope !== scope) {
    return { ok: false, error: scopeError };
  }
  return { ok: true, value: copyCredential({ vaultReference: reference.value, permissionScope: scope }) };
}

function resolveCredentials(source, current, secrets) {
  if (source.withdrawals !== undefined && source.withdrawals !== false) {
    return { ok: false, error: "withdrawals are closed" };
  }
  const marketData = source.marketData === undefined
    ? { ok: true, value: current ? copyCredential(current.marketData) : null }
    : resolveOne(source.marketData, MARKET_SCOPE, "read-only scope is required", secrets);
  if (!marketData.ok) return marketData;
  const orders = source.orders === undefined
    ? { ok: true, value: current ? copyCredential(current.orders) : null }
    : resolveOne(source.orders, ORDER_SCOPE, "order-capable scope is required", secrets);
  if (!orders.ok) return orders;
  if (marketData.value && leaked(marketData.value.vaultReference, secrets)) {
    return { ok: false, error: "vault reference is not allowed" };
  }
  if (orders.value && leaked(orders.value.vaultReference, secrets)) {
    return { ok: false, error: "vault reference is not allowed" };
  }
  if (
    marketData.value
    && orders.value
    && marketData.value.vaultReference === orders.value.vaultReference
  ) {
    return { ok: false, error: "order credentials must be separate" };
  }
  return { ok: true, marketData: marketData.value, orders: orders.value, withdrawals: false };
}

function snapshot(record) {
  return JSON.stringify({
    id: record.id,
    lineageId: record.lineageId,
    kind: record.kind,
    product: record.product,
    channel: record.channel,
    docsReference: record.docsReference,
    region: record.region,
    limits: record.limits,
    heartbeat: record.heartbeat,
    status: record.status,
    lastError: record.lastError,
    version: record.version,
    archivedAt: record.archivedAt,
    marketData: record.marketData,
    orders: record.orders,
    withdrawals: false,
    autoStart: false,
    knownGood: record.knownGood === true,
    proposedBy: record.proposedBy ?? null,
    approver: record.approver ?? null,
  });
}

function writeAudit(store, input) {
  store.audits.push(Object.freeze({
    tenantId: input.tenantId,
    actor: input.actor,
    action: input.action,
    beforeValue: input.beforeValue,
    afterValue: input.afterValue,
    reason: input.reason ?? null,
    approval: input.approval ?? null,
    changedAt: input.changedAt,
    configChecksum: null,
    lineageId: input.lineageId,
  }));
}

function lineageRecords(store, lineageId) {
  return store.records.filter((record) => record.lineageId === lineageId);
}

function currentRecord(versions) {
  return [...versions].reverse().find((record) => (
    record.archivedAt == null && record.knownGood === true
  )) ?? null;
}

function scopeText(record) {
  return JSON.stringify({
    marketData: record.marketData ?? null,
    orders: record.orders ?? null,
  });
}

function needsReview(current, next) {
  return current.docsReference !== next.docsReference
    || current.channel !== next.channel
    || current.limits !== next.limits
    || scopeText(current) !== scopeText(next);
}

export function createProviderRegistry() {
  return { nextId: 1, records: [], audits: [], actions: [], health: [], documentation: [] };
}

function subscriptionEnabled(store, lineageId) {
  return (store.actions ?? []).some((entry) => (
    entry.lineageId === lineageId && entry.action === "auto-start" && entry.autoStart === true
  ));
}

export function createProvider(store, input) {
  return insertProvider(store, input, "create");
}

export function importProvider(store, input) {
  return insertProvider(store, input, "import");
}

function insertProvider(store, input, action) {
  const source = input && typeof input === "object" ? input : {};
  const denial = denied(source.actor, source.tenantId);
  if (denial) {
    return denial;
  }
  if (!KIND_SET.has(source.kind)) {
    return { ok: false, error: "unknown provider kind" };
  }
  const product = requireText(source.product, "product is required");
  if (!product.ok) return product;
  const channel = requireText(source.channel, "channel is required");
  if (!channel.ok) return channel;
  const docsReference = requireText(source.docsReference, "docs reference is required");
  if (!docsReference.ok) return docsReference;
  const region = requireText(source.region, "region is required");
  if (!region.ok) return region;
  const status = requireText(source.status, "status is required");
  if (!status.ok) return status;
  const version = requireText(source.version, "version is required");
  if (!version.ok) return version;
  const changedAt = requireText(source.changedAt, "changedAt is required");
  if (!changedAt.ok) return changedAt;
  const limits = optionalText(source.limits, "limits must be text");
  if (!limits.ok) return limits;
  const heartbeat = optionalText(source.heartbeat, "heartbeat must be text");
  if (!heartbeat.ok) return heartbeat;
  const lastError = optionalText(source.lastError, "last error must be text");
  if (!lastError.ok) return lastError;
  const secrets = new Set();
  collectSecrets(source, secrets);
  const allowed = textsAllowed([
    product.value,
    channel.value,
    docsReference.value,
    region.value,
    limits.value,
    heartbeat.value,
    status.value,
    lastError.value,
    version.value,
    changedAt.value,
    source.reason,
    source.actor?.id,
  ], secrets);
  if (!allowed.ok) return allowed;
  const credentials = resolveCredentials(source, null, secrets);
  if (!credentials.ok) return credentials;

  const id = store.nextId;
  store.nextId += 1;
  const record = {
    id,
    tenantId: source.tenantId,
    lineageId: id,
    kind: source.kind,
    product: product.value,
    channel: channel.value,
    docsReference: docsReference.value,
    region: region.value,
    limits: limits.value,
    heartbeat: heartbeat.value,
    status: status.value,
    lastError: lastError.value,
    version: version.value,
    archivedAt: null,
    marketData: credentials.marketData,
    orders: credentials.orders,
    withdrawals: false,
    autoStart: false,
    knownGood: true,
    proposedBy: source.actor.id,
    approver: null,
    approvedAt: null,
  };
  store.records.push(record);
  writeAudit(store, {
    tenantId: source.tenantId,
    actor: source.actor.id,
    action,
    beforeValue: null,
    afterValue: snapshot(record),
    reason: source.reason,
    changedAt: changedAt.value,
    lineageId: id,
  });
  return { ok: true, record: { ...record } };
}

export function updateProvider(store, input) {
  const source = input && typeof input === "object" ? input : {};
  const versions = lineageRecords(store, source.lineageId);
  if (versions.length === 0) {
    return { ok: false, error: "provider not found" };
  }
  const current = currentRecord(versions);
  if (!current) {
    return { ok: false, error: "provider is archived" };
  }
  const denial = denied(source.actor, current.tenantId);
  if (denial) {
    return denial;
  }
  if (source.kind != null && source.kind !== current.kind) {
    return { ok: false, error: "provider kind cannot change" };
  }
  const version = requireText(source.version, "version is required");
  if (!version.ok) return version;
  const changedAt = requireText(source.changedAt, "changedAt is required");
  if (!changedAt.ok) return changedAt;

  const product = source.product === undefined
    ? { ok: true, value: current.product }
    : requireText(source.product, "product is required");
  if (!product.ok) return product;
  const channel = source.channel === undefined
    ? { ok: true, value: current.channel }
    : requireText(source.channel, "channel is required");
  if (!channel.ok) return channel;
  const docsReference = source.docsReference === undefined
    ? { ok: true, value: current.docsReference }
    : requireText(source.docsReference, "docs reference is required");
  if (!docsReference.ok) return docsReference;
  const region = source.region === undefined
    ? { ok: true, value: current.region }
    : requireText(source.region, "region is required");
  if (!region.ok) return region;
  const status = source.status === undefined
    ? { ok: true, value: current.status }
    : requireText(source.status, "status is required");
  if (!status.ok) return status;
  const limits = source.limits === undefined
    ? { ok: true, value: current.limits }
    : optionalText(source.limits, "limits must be text");
  if (!limits.ok) return limits;
  const heartbeat = source.heartbeat === undefined
    ? { ok: true, value: current.heartbeat }
    : optionalText(source.heartbeat, "heartbeat must be text");
  if (!heartbeat.ok) return heartbeat;
  const lastError = source.lastError === undefined
    ? { ok: true, value: current.lastError }
    : optionalText(source.lastError, "last error must be text");
  if (!lastError.ok) return lastError;
  const secrets = new Set();
  collectSecrets(source, secrets);
  const allowed = textsAllowed([
    product.value,
    channel.value,
    docsReference.value,
    region.value,
    limits.value,
    heartbeat.value,
    status.value,
    lastError.value,
    version.value,
    changedAt.value,
    source.reason,
    source.actor?.id,
  ], secrets);
  if (!allowed.ok) return allowed;
  const credentials = resolveCredentials(source, current, secrets);
  if (!credentials.ok) return credentials;

  const id = store.nextId;
  store.nextId += 1;
  const record = {
    id,
    tenantId: current.tenantId,
    lineageId: current.lineageId,
    kind: current.kind,
    product: product.value,
    channel: channel.value,
    docsReference: docsReference.value,
    region: region.value,
    limits: limits.value,
    heartbeat: heartbeat.value,
    status: status.value,
    lastError: lastError.value,
    version: version.value,
    archivedAt: null,
    marketData: credentials.marketData,
    orders: credentials.orders,
    withdrawals: false,
    autoStart: false,
    knownGood: false,
    proposedBy: source.actor.id,
    approver: null,
    approvedAt: null,
  };
  record.knownGood = !needsReview(current, record);
  store.records.push(record);
  writeAudit(store, {
    tenantId: current.tenantId,
    actor: source.actor.id,
    action: "update",
    beforeValue: snapshot(current),
    afterValue: snapshot(record),
    reason: source.reason,
    changedAt: changedAt.value,
    lineageId: current.lineageId,
  });
  return { ok: true, record: { ...record } };
}

export function archiveProvider(store, input) {
  const source = input && typeof input === "object" ? input : {};
  const versions = lineageRecords(store, source.lineageId);
  if (versions.length === 0) {
    return { ok: false, error: "provider not found" };
  }
  const denial = denied(source.actor, versions[0].tenantId);
  if (denial) {
    return denial;
  }
  const changedAt = requireText(source.changedAt, "changedAt is required");
  if (!changedAt.ok) return changedAt;
  const current = currentRecord(versions);
  if (!current) {
    return { ok: false, error: "provider is archived" };
  }
  const beforeValue = snapshot(current);
  for (const record of versions) {
    if (record.archivedAt == null) {
      record.archivedAt = changedAt.value;
    }
  }
  writeAudit(store, {
    tenantId: versions[0].tenantId,
    actor: source.actor.id,
    action: "archive",
    beforeValue,
    afterValue: snapshot(current),
    reason: source.reason,
    changedAt: changedAt.value,
    lineageId: source.lineageId,
  });
  return { ok: true, versions: versions.map((record) => ({ ...record })) };
}

export function readProviderVersions(store, input) {
  const source = input && typeof input === "object" ? input : {};
  const versions = lineageRecords(store, source.lineageId);
  if (versions.length === 0) {
    return { ok: false, error: "provider not found" };
  }
  const denial = denied(source.actor, versions[0].tenantId);
  if (denial) {
    return denial;
  }
  const audits = store.audits.filter((audit) => audit.lineageId === source.lineageId);
  return {
    ok: true,
    versions: versions.map((record) => ({
      ...record,
      marketData: copyCredential(record.marketData),
      orders: copyCredential(record.orders),
      withdrawals: false,
      autoStart: false,
    })),
    audits: audits.map((audit) => ({ ...audit })),
  };
}

export function authorizeProviderUse(record, purpose) {
  if (purpose === "withdrawals") {
    return { ok: false, error: "withdrawals are closed", withdrawals: false };
  }
  if (purpose === "market-data") {
    if (record?.marketData?.permissionScope !== MARKET_SCOPE) {
      return { ok: false, error: "read-only scope is required" };
    }
    return {
      ok: true,
      permissionScope: MARKET_SCOPE,
      vaultReference: record.marketData.vaultReference,
      withdrawals: false,
    };
  }
  if (purpose === "orders") {
    if (record?.marketData && !record?.orders) {
      return { ok: false, error: "read-only scope cannot place orders" };
    }
    if (record?.orders?.permissionScope !== ORDER_SCOPE) {
      return { ok: false, error: "order credentials are separate" };
    }
    if (
      record.marketData
      && record.marketData.vaultReference === record.orders.vaultReference
    ) {
      return { ok: false, error: "order credentials must be separate" };
    }
    return {
      ok: true,
      permissionScope: ORDER_SCOPE,
      vaultReference: record.orders.vaultReference,
      withdrawals: false,
    };
  }
  return { ok: false, error: "unknown provider use" };
}

export function displayProvider(record) {
  const market = record.marketData
    ? `market-data ${record.marketData.permissionScope} ${record.marketData.vaultReference}`
    : "market-data none";
  const orders = record.orders
    ? `orders ${record.orders.permissionScope} ${record.orders.vaultReference}`
    : "orders none";
  return [record.kind, record.product, record.channel, market, orders, "withdrawals closed"].join("\n");
}

export function providerLog(record) {
  return Object.freeze({
    lineageId: record.lineageId,
    kind: record.kind,
    version: record.version,
    marketDataScope: record.marketData?.permissionScope ?? null,
    marketDataVaultReference: record.marketData?.vaultReference ?? null,
    orderScope: record.orders?.permissionScope ?? null,
    orderVaultReference: record.orders?.vaultReference ?? null,
    withdrawals: false,
  });
}

export function providerExports(store, input) {
  const read = readProviderVersions(store, input);
  if (!read.ok) return read;
  const source = input && typeof input === "object" ? input : {};
  return {
    ok: true,
    serialization: JSON.stringify(read.versions),
    ui: [
      read.versions.map((record) => displayProvider(record)).join("\n"),
      displayProviderActions(store, source.lineageId),
    ].join("\n"),
    log: JSON.stringify(read.versions.map((record) => providerLog(record))),
    audit: JSON.stringify(read.audits),
  };
}

function prepareAction(store, input) {
  const source = input && typeof input === "object" ? input : {};
  const versions = lineageRecords(store, source.lineageId);
  if (versions.length === 0) return { ok: false, error: "provider not found" };
  const current = currentRecord(versions);
  if (!current) return { ok: false, error: "provider is archived" };
  const denial = denied(source.actor, current.tenantId);
  if (denial) return denial;
  const changedAt = requireText(source.changedAt, "changedAt is required");
  if (!changedAt.ok) return changedAt;
  const secrets = new Set();
  collectSecrets(source, secrets);
  const allowed = textsAllowed([
    changedAt.value,
    source.reason,
    source.actor?.id,
  ], secrets);
  if (!allowed.ok) return allowed;
  return { ok: true, source, current, changedAt: changedAt.value };
}

function recordAction(store, current, source, changedAt, action, confirmed, autoStart) {
  const beforeAuto = subscriptionEnabled(store, current.lineageId);
  const row = Object.freeze({
    tenantId: current.tenantId,
    lineageId: current.lineageId,
    action,
    confirmed,
    autoStart,
    connected: false,
    fetched: false,
    changedAt,
  });
  store.actions.push(row);
  writeAudit(store, {
    tenantId: current.tenantId,
    actor: source.actor.id,
    action,
    beforeValue: JSON.stringify({ autoStart: beforeAuto }),
    afterValue: JSON.stringify(row),
    reason: source.reason,
    changedAt,
    lineageId: current.lineageId,
  });
  return {
    ok: true,
    action,
    confirmed,
    autoStart,
    connected: false,
    fetched: false,
    recordAutoStart: false,
  };
}

export function testConnection(store, input) {
  const ready = prepareAction(store, input);
  if (!ready.ok) return ready;
  return recordAction(store, ready.current, ready.source, ready.changedAt, "test-connection", false, false);
}

export function fetchOnce(store, input) {
  const ready = prepareAction(store, input);
  if (!ready.ok) return ready;
  return recordAction(store, ready.current, ready.source, ready.changedAt, "fetch-once", false, false);
}

export function startAuto(store, input) {
  const ready = prepareAction(store, input);
  if (!ready.ok) return ready;
  if (ready.source.confirmation !== true) {
    return { ok: false, error: "confirmation is required", autoStart: false };
  }
  const permission = authorizeProviderUse(ready.current, "market-data");
  if (!permission.ok) {
    return { ok: false, error: permission.error, autoStart: false };
  }
  const recorded = recordAction(
    store,
    ready.current,
    ready.source,
    ready.changedAt,
    "auto-start",
    true,
    true,
  );
  return { ...recorded, permissionScope: permission.permissionScope };
}

export function displayProviderActions(store, lineageId) {
  const actions = (store.actions ?? []).filter((entry) => entry.lineageId === lineageId);
  const tests = actions.filter((entry) => entry.action === "test-connection").length;
  const fetches = actions.filter((entry) => entry.action === "fetch-once").length;
  const autos = actions.filter((entry) => entry.action === "auto-start").length;
  return [
    "Test Connection",
    "Fetch Once",
    "Auto Start",
    `test-connection ${tests}`,
    `fetch-once ${fetches}`,
    `auto-start ${autos}`,
    subscriptionEnabled(store, lineageId) ? "auto on" : "auto off",
  ].join("\n");
}

function wholeNumber(value) {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 ? value : null;
}

function heartbeatAge(value, secrets) {
  if (value == null) return { ok: true, value: null };
  if (typeof value === "number" && Number.isFinite(value) && value >= 0) {
    return { ok: true, value: String(value) };
  }
  if (typeof value === "string" && !leaked(value, secrets) && value.trim().length > 0) {
    return { ok: true, value: value.trim() };
  }
  if (typeof value === "string" && leaked(value, secrets)) {
    return { ok: false, error: "secret value is not allowed" };
  }
  return { ok: false, error: "heartbeat age is not allowed" };
}

function rateLimitHeaders(headers, secrets) {
  if (headers == null) return { ok: true, value: {} };
  if (typeof headers !== "object" || Array.isArray(headers)) {
    return { ok: false, error: "rate-limit headers must be text" };
  }
  const stored = {};
  for (const [key, value] of Object.entries(headers)) {
    if (typeof key !== "string" || typeof value !== "string") continue;
    if (SECRET_KEYS.has(key.toLowerCase())) continue;
    if (leaked(key, secrets) || leaked(value, secrets)) continue;
    const name = key.trim();
    if (name.length === 0) continue;
    stored[name] = value.trim();
  }
  return { ok: true, value: stored };
}

function boundedAttempts(failure, configured, overMargin, budget) {
  if (!failure) return { attempts: 0, backoffState: null };
  if (!configured || overMargin || budget === 0) {
    return { attempts: 0, backoffState: "stopped" };
  }
  let attempts = 0;
  while (attempts < budget) {
    attempts += 1;
  }
  return { attempts, backoffState: "bounded" };
}

export function recordProviderHealth(store, input) {
  const ready = prepareAction(store, input);
  if (!ready.ok) return ready;
  const source = ready.source;
  const secrets = new Set();
  collectSecrets(source, secrets);
  const age = heartbeatAge(source.heartbeatAge, secrets);
  if (!age.ok) return age;
  const headers = rateLimitHeaders(source.headers, secrets);
  if (!headers.ok) return headers;
  const connection = source.connectionStatus == null
    ? null
    : requireText(source.connectionStatus, "connection status is required");
  if (connection && !connection.ok) return connection;
  if (connection && leaked(connection.value, secrets)) {
    return { ok: false, error: "secret value is not allowed" };
  }
  const documentedLimit = wholeNumber(source.documentedLimit);
  const safetyMargin = wholeNumber(source.safetyMargin);
  const configured = documentedLimit !== null && safetyMargin !== null;
  const observed = wholeNumber(source.observed);
  const overMargin = configured && observed !== null && observed + safetyMargin > documentedLimit;
  const budget = wholeNumber(source.retryBudget) ?? 0;
  const failure = source.httpStatus === 429 || connection?.value === "disconnected";
  const bounded = boundedAttempts(failure, configured, overMargin, budget);
  const row = Object.freeze({
    tenantId: ready.current.tenantId,
    lineageId: ready.current.lineageId,
    connectionStatus: connection ? connection.value : null,
    heartbeatAge: age.value,
    retryBudget: wholeNumber(source.retryBudget),
    attempts: bounded.attempts,
    backoffState: bounded.backoffState,
    status: failure ? "degraded" : null,
    headers: headers.value,
    documentedLimit,
    safetyMargin,
    changedAt: ready.changedAt,
  });
  store.health.push(row);
  writeAudit(store, {
    tenantId: ready.current.tenantId,
    actor: source.actor.id,
    action: "provider-health",
    beforeValue: null,
    afterValue: JSON.stringify(row),
    reason: source.reason,
    changedAt: ready.changedAt,
    lineageId: ready.current.lineageId,
  });
  return {
    ok: true,
    status: row.status,
    connectionStatus: row.connectionStatus,
    heartbeatAge: row.heartbeatAge,
    retryBudget: row.retryBudget,
    attempts: row.attempts,
    backoffState: row.backoffState,
    headers: row.headers,
  };
}

export function displayProviderHealth(store, lineageId) {
  const latest = [...(store.health ?? [])].reverse().find((entry) => entry.lineageId === lineageId);
  if (!latest) return "health none";
  const headerText = Object.entries(latest.headers).map(([key, value]) => `${key}=${value}`).join(",");
  return [
    `connection ${latest.connectionStatus ?? "none"}`,
    `heartbeat-age ${latest.heartbeatAge ?? "none"}`,
    `retry-budget ${latest.retryBudget ?? "none"}`,
    `backoff ${latest.backoffState ?? "none"}`,
    `status ${latest.status ?? "none"}`,
    `attempts ${latest.attempts}`,
    `headers ${headerText || "none"}`,
  ].join("\n");
}

function copyRecord(record) {
  return {
    ...record,
    marketData: copyCredential(record.marketData),
    orders: copyCredential(record.orders),
    withdrawals: false,
    autoStart: false,
  };
}

export function readLastKnownGood(store, input) {
  const source = input && typeof input === "object" ? input : {};
  const versions = lineageRecords(store, source.lineageId);
  if (versions.length === 0) return { ok: false, error: "provider not found" };
  const denial = denied(source.actor, versions[0].tenantId);
  if (denial) return denial;
  const current = currentRecord(versions);
  if (!current) return { ok: false, error: "provider is archived" };
  return { ok: true, record: copyRecord(current) };
}

export function approveProviderChange(store, input) {
  const source = input && typeof input === "object" ? input : {};
  const versions = lineageRecords(store, source.lineageId);
  if (versions.length === 0) return { ok: false, error: "provider not found" };
  const denial = denied(source.actor, versions[0].tenantId);
  if (denial) return denial;
  const record = versions.find((item) => item.id === source.versionId);
  if (!record) return { ok: false, error: "provider not found" };
  if (record.archivedAt != null) return { ok: false, error: "provider is archived" };
  if (record.knownGood === true) return { ok: false, error: "version is already approved" };
  const changedAt = requireText(source.changedAt, "changedAt is required");
  if (!changedAt.ok) return changedAt;
  if (!source.actor || source.actor.id === record.proposedBy) {
    return { ok: false, error: "maker cannot approve" };
  }
  const secrets = new Set();
  collectSecrets(source, secrets);
  const allowed = textsAllowed([changedAt.value, source.reason, source.actor.id], secrets);
  if (!allowed.ok) return allowed;
  const before = snapshot(record);
  record.knownGood = true;
  record.approver = source.actor.id;
  record.approvedAt = changedAt.value;
  writeAudit(store, {
    tenantId: record.tenantId,
    actor: source.actor.id,
    action: "approve",
    beforeValue: before,
    afterValue: snapshot(record),
    reason: source.reason,
    approval: source.actor.id,
    changedAt: changedAt.value,
    lineageId: record.lineageId,
  });
  return { ok: true, record: copyRecord(record) };
}

export function rollbackProvider(store, input) {
  const source = input && typeof input === "object" ? input : {};
  const versions = lineageRecords(store, source.lineageId);
  if (versions.length === 0) return { ok: false, error: "provider not found" };
  const denial = denied(source.actor, versions[0].tenantId);
  if (denial) return denial;
  const selected = versions.find((item) => item.id === source.versionId);
  if (!selected || selected.knownGood !== true) {
    return { ok: false, error: "last known good is required" };
  }
  if (selected.archivedAt != null) return { ok: false, error: "provider is archived" };
  const version = requireText(source.version, "version is required");
  if (!version.ok) return version;
  const changedAt = requireText(source.changedAt, "changedAt is required");
  if (!changedAt.ok) return changedAt;
  const secrets = new Set();
  collectSecrets(source, secrets);
  const allowed = textsAllowed([version.value, changedAt.value, source.reason, source.actor.id], secrets);
  if (!allowed.ok) return allowed;
  const id = store.nextId;
  store.nextId += 1;
  const record = {
    ...copyRecord(selected),
    id,
    lineageId: selected.lineageId,
    version: version.value,
    archivedAt: null,
    knownGood: true,
    proposedBy: source.actor.id,
    approver: source.actor.id,
    approvedAt: changedAt.value,
  };
  store.records.push(record);
  writeAudit(store, {
    tenantId: selected.tenantId,
    actor: source.actor.id,
    action: "rollback",
    beforeValue: snapshot(currentRecord(versions)),
    afterValue: snapshot(record),
    reason: source.reason,
    approval: source.actor.id,
    changedAt: changedAt.value,
    lineageId: selected.lineageId,
  });
  return { ok: true, record: copyRecord(record) };
}

export function displayProviderReview(store, lineageId) {
  const versions = lineageRecords(store, lineageId);
  const good = currentRecord(versions);
  const pending = [...versions].reverse().find((record) => (
    record.archivedAt == null && record.knownGood !== true
  ));
  const scope = good?.marketData?.permissionScope ?? "none";
  return [
    `last known good ${good ? good.version : "none"}`,
    `endpoint ${good ? good.docsReference : "none"}`,
    `channel ${good ? good.channel : "none"}`,
    `scope ${scope}`,
    `limits ${good?.limits ?? "none"}`,
    `pending ${pending ? pending.version : "none"}`,
  ].join("\n");
}

function documentationUrl(value, secrets) {
  const text = requireText(value, "documentation url is required");
  if (!text.ok) return text;
  if (leaked(text.value, secrets)) return { ok: false, error: "documentation url is not allowed" };
  let url;
  try {
    url = new URL(text.value);
  } catch {
    return { ok: false, error: "documentation url is not allowed" };
  }
  if (url.username || url.password) return { ok: false, error: "documentation url is not allowed" };
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return { ok: false, error: "documentation url is not allowed" };
  }
  for (const key of url.searchParams.keys()) {
    if (SECRET_KEYS.has(key.toLowerCase())) return { ok: false, error: "documentation url is not allowed" };
  }
  return { ok: true, value: text.value };
}

function checkedAt(value) {
  const text = requireText(value, "checked-at is required");
  if (!text.ok) return text;
  if (Number.isNaN(Date.parse(text.value))) return { ok: false, error: "checked-at is required" };
  return text;
}

function supportedProducts(value, secrets) {
  if (!Array.isArray(value) || value.length === 0) {
    return { ok: false, error: "supported products are required" };
  }
  const products = [];
  for (const item of value) {
    const text = requireText(item, "supported products are required");
    if (!text.ok) return text;
    if (leaked(text.value, secrets)) return { ok: false, error: "secret value is not allowed" };
    products.push(text.value);
  }
  return { ok: true, value: products };
}

function reviewState(row) {
  if (!row || row.enabled !== true) return "unverified";
  if (!row.documentationUrl || !row.checkedAt || !row.verificationOwner || row.supportedProducts.length === 0) {
    return "unverified";
  }
  if (row.stale === true) return "stale";
  return "verified";
}

export function recordProviderDocumentation(store, input) {
  const ready = prepareAction(store, input);
  if (!ready.ok) return ready;
  const source = ready.source;
  if (source.enabled !== true && source.enabled !== false && source.enabled !== undefined) {
    return { ok: false, error: "enabled is not allowed" };
  }
  if (source.stale !== true && source.stale !== false && source.stale !== undefined) {
    return { ok: false, error: "stale is not allowed" };
  }
  const enabled = source.enabled === true;
  const stale = source.stale === true;
  const secrets = new Set();
  collectSecrets(source, secrets);
  let documentation = { ok: true, value: null };
  let checked = { ok: true, value: null };
  let products = { ok: true, value: [] };
  let owner = { ok: true, value: null };
  if (enabled || source.documentationUrl != null) documentation = documentationUrl(source.documentationUrl, secrets);
  if (!documentation.ok) return documentation;
  if (enabled || source.checkedAt != null) checked = checkedAt(source.checkedAt);
  if (!checked.ok) return checked;
  if (enabled || source.supportedProducts != null) products = supportedProducts(source.supportedProducts, secrets);
  if (!products.ok) return products;
  if (enabled || source.verificationOwner != null) {
    owner = requireText(source.verificationOwner, "verification owner is required");
    if (owner.ok && leaked(owner.value, secrets)) return { ok: false, error: "secret value is not allowed" };
  }
  if (!owner.ok) return owner;
  const allowed = textsAllowed([ready.changedAt, source.reason, source.actor?.id], secrets);
  if (!allowed.ok) return allowed;
  const row = Object.freeze({
    tenantId: ready.current.tenantId,
    lineageId: ready.current.lineageId,
    documentationUrl: documentation.value,
    checkedAt: checked.value,
    supportedProducts: products.value,
    verificationOwner: owner.value,
    enabled,
    stale,
    changedAt: ready.changedAt,
  });
  store.documentation.push(row);
  writeAudit(store, {
    tenantId: ready.current.tenantId,
    actor: source.actor.id,
    action: "documentation-review",
    beforeValue: null,
    afterValue: JSON.stringify(row),
    reason: source.reason,
    changedAt: ready.changedAt,
    lineageId: ready.current.lineageId,
  });
  return { ok: true, review: reviewState(row), row: { ...row, supportedProducts: [...row.supportedProducts] } };
}

export function displayProviderDocumentation(store, lineageId) {
  const latest = [...(store.documentation ?? [])].reverse().find((entry) => entry.lineageId === lineageId);
  const state = reviewState(latest);
  if (!latest) return "review unverified";
  return [
    `documentation ${latest.documentationUrl ?? "none"}`,
    `checked-at ${latest.checkedAt ?? "none"}`,
    `products ${latest.supportedProducts.length === 0 ? "none" : latest.supportedProducts.join(",")}`,
    `owner ${latest.verificationOwner ?? "none"}`,
    `review ${state}`,
  ].join("\n");
}
