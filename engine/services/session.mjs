import { createHash, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import { health } from "../apps/web/health.mjs";

// The source names no cookie name. The __Host- prefix requires Secure, Path=/, and no Domain.
export const SESSION_COOKIE_NAME = "__Host-session";
// The source names no CSRF header. State-changing session requests require this header.
export const CSRF_HEADER = "x-csrf-token";
// The source names no client IP header. Per-IP throttles use this request field when present.
export const CLIENT_IP_HEADER = "x-client-ip";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ACTIONS = new Set(["login", "logout", "rotate", "revoke", "csrf"]);
const RESULTS = new Set(["ok", "denied", "revoked", "expired", "rotated", "unconfigured", "throttled"]);
// Node's built-in scrypt parameters. The source names no password KDF.
const SCRYPT = Object.freeze({ N: 16384, r: 8, p: 1 });

function digest(value) {
  return createHash("sha256").update(value).digest("hex");
}

function newSecret() {
  return randomBytes(32).toString("base64url");
}

function configured(policy) {
  return Boolean(policy) && Number.isInteger(policy.ttlMs) && policy.ttlMs >= 1;
}

function finiteNow(now) {
  return typeof now === "number" && Number.isFinite(now);
}

function writeLog(log, event) {
  if (!Array.isArray(log)) return;
  const action = ACTIONS.has(event.action) ? event.action : "login";
  const result = RESULTS.has(event.result) ? event.result : "denied";
  const sessionPublicId = typeof event.sessionPublicId === "string" && UUID_PATTERN.test(event.sessionPublicId)
    ? event.sessionPublicId
    : null;
  const correlationId = typeof event.correlationId === "string" && UUID_PATTERN.test(event.correlationId)
    ? event.correlationId
    : null;
  log.push({ action, result, sessionPublicId, correlationId });
}

function tradingFlags() {
  return {
    liveTrading: health.liveTrading,
    liveOrdersLocked: health.liveOrdersLocked,
  };
}

export function createSessionStore() {
  return {
    accounts: new Map(),
    challenges: new Map(),
    sessions: new Map(),
    byPublicId: new Map(),
    recovery: new Map(),
    throttle: new Map(),
  };
}

export function createAccount(store, input) {
  const loginId = input?.loginId;
  const password = input?.password;
  if (typeof loginId !== "string" || loginId.length === 0) return { ok: false, error: "invalid login" };
  if (typeof password !== "string" || password.length === 0) return { ok: false, error: "invalid login" };
  if (store.accounts.has(loginId)) return { ok: false, error: "duplicate login" };
  const salt = randomBytes(16);
  const hash = scryptSync(password, salt, 32, SCRYPT);
  const subjectId = crypto.randomUUID();
  store.accounts.set(loginId, { loginId, salt, hash, subjectId });
  return { ok: true, subjectId };
}

function passwordMatches(account, password) {
  if (!account || typeof password !== "string") return false;
  const hash = scryptSync(password, account.salt, 32, SCRYPT);
  return hash.length === account.hash.length && timingSafeEqual(hash, account.hash);
}

function findAccount(store, loginId, password) {
  if (typeof loginId !== "string" || typeof password !== "string") return null;
  const account = store.accounts.get(loginId);
  if (!passwordMatches(account, password)) return null;
  return account;
}

export function sessionCookieHeader(token, expiresAt) {
  const expires = new Date(expiresAt).toUTCString();
  return `${SESSION_COOKIE_NAME}=${token}; HttpOnly; Secure; SameSite=Strict; Path=/; Expires=${expires}`;
}

export function clearSessionCookieHeader() {
  return `${SESSION_COOKIE_NAME}=; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=0`;
}

export function reviewSessionCookie(header) {
  const parts = String(header).split(";").map((part) => part.trim()).filter(Boolean);
  const pair = parts[0] ?? "";
  const eq = pair.indexOf("=");
  const name = eq === -1 ? pair : pair.slice(0, eq);
  const value = eq === -1 ? "" : pair.slice(eq + 1);
  const attrs = parts.slice(1);
  const lowered = attrs.map((attr) => attr.toLowerCase());
  const sameSite = attrs.find((attr) => attr.toLowerCase().startsWith("samesite="));
  const path = attrs.find((attr) => attr.toLowerCase().startsWith("path="));
  const maxAge = attrs.find((attr) => attr.toLowerCase().startsWith("max-age="));
  return {
    name,
    httpOnly: lowered.includes("httponly"),
    secure: lowered.includes("secure"),
    sameSite: sameSite ? sameSite.split("=")[1] : null,
    path: path ? path.split("=")[1] : null,
    domain: lowered.some((attr) => attr.startsWith("domain=")),
    maxAge: maxAge ? maxAge.split("=")[1] : null,
    hasValue: value.length > 0,
  };
}

export function readCookie(header, name) {
  if (typeof header !== "string") return null;
  for (const part of header.split(";")) {
    const trimmed = part.trim();
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    if (trimmed.slice(0, eq) === name) return trimmed.slice(eq + 1);
  }
  return null;
}

function issueSession(store, subjectId, now, policy) {
  const token = newSecret();
  const csrfToken = newSecret();
  const publicId = crypto.randomUUID();
  const expiresAt = now + policy.ttlMs;
  const record = {
    publicId,
    subjectId,
    tokenHash: digest(token),
    csrfHash: digest(csrfToken),
    expiresAt,
    revokedAt: null,
  };
  store.sessions.set(record.tokenHash, record);
  store.byPublicId.set(publicId, record);
  return {
    token,
    csrfToken,
    sessionPublicId: publicId,
    expiresAt,
    setCookie: sessionCookieHeader(token, expiresAt),
    ...tradingFlags(),
  };
}

function sessionByToken(store, token) {
  if (typeof token !== "string" || token.length === 0) return null;
  return store.sessions.get(digest(token)) ?? null;
}

function csrfMatches(record, csrfToken) {
  if (!record?.csrfHash || typeof csrfToken !== "string" || csrfToken.length === 0) return false;
  const actual = Buffer.from(record.csrfHash);
  const expected = Buffer.from(digest(csrfToken));
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

function takeChallenge(store, csrfToken, now) {
  if (typeof csrfToken !== "string" || csrfToken.length === 0) return false;
  const key = digest(csrfToken);
  const row = store.challenges.get(key);
  if (!row) return false;
  store.challenges.delete(key);
  return finiteNow(now) && now < row.expiresAt;
}

export function beginLogin(store, input) {
  const now = input?.now;
  const log = input?.log;
  const correlationId = input?.correlationId;
  if (!configured(input?.policy) || !finiteNow(now)) {
    writeLog(log, { action: "csrf", result: "unconfigured", correlationId });
    return { ok: false, error: "session expiry is not configured" };
  }
  const csrfToken = newSecret();
  store.challenges.set(digest(csrfToken), { expiresAt: now + input.policy.ttlMs });
  writeLog(log, { action: "csrf", result: "ok", correlationId });
  return { ok: true, csrfToken, expiresAt: now + input.policy.ttlMs };
}

export function login(store, input) {
  const now = input?.now;
  const log = input?.log;
  const correlationId = input?.correlationId;
  if (!configured(input?.policy) || !finiteNow(now)) {
    writeLog(log, { action: "login", result: "unconfigured", correlationId });
    return { ok: false, error: "session expiry is not configured" };
  }
  const challengeOk = takeChallenge(store, input?.csrfToken, now);
  if (!challengeOk) {
    writeLog(log, { action: "login", result: "denied", correlationId });
    return { ok: false, error: "csrf denied" };
  }
  // The source names no login cap. A missing cap fails closed. A throttle stays a public denial.
  if (!limitsReady(input?.policy)) {
    writeLog(log, { action: "login", result: "unconfigured", correlationId });
    return { ok: false, error: "rate limit is not configured" };
  }
  const loginId = input?.loginId;
  const ip = input?.ip;
  if (typeof loginId !== "string" || loginId.length === 0 || typeof ip !== "string" || ip.length === 0) {
    writeLog(log, { action: "login", result: "denied", correlationId });
    return { ok: false, error: "login denied" };
  }
  const accountAllowed = allowThrottle(
    store,
    `login:account:${digest(loginId)}`,
    now,
    input.policy.accountLimit,
    input.policy.windowMs,
  );
  const ipAllowed = allowThrottle(
    store,
    `login:ip:${digest(ip)}`,
    now,
    input.policy.ipLimit,
    input.policy.windowMs,
  );
  const known = store.accounts.get(loginId) ?? null;
  if (!accountAllowed || !ipAllowed) {
    writeLog(log, { action: "login", result: "throttled", correlationId });
    writeAlert(input?.alerts, {
      action: "login",
      result: "throttled",
      subjectId: known?.subjectId,
      correlationId,
    });
    return { ok: false, error: "login denied" };
  }
  const account = findAccount(store, loginId, input?.password);
  if (!account) {
    writeLog(log, { action: "login", result: "denied", correlationId });
    return { ok: false, error: "login denied" };
  }
  const existing = sessionByToken(store, input?.existingToken);
  const issued = issueSession(store, account.subjectId, now, input.policy);
  if (existing && existing.revokedAt == null) existing.revokedAt = now;
  writeLog(log, { action: "login", result: "ok", sessionPublicId: issued.sessionPublicId, correlationId });
  return { ok: true, ...issued };
}

export function readSession(store, token, now) {
  const record = sessionByToken(store, token);
  if (!record) return { ok: false, error: "login denied" };
  if (record.revokedAt != null) return { ok: false, error: "session revoked", sessionPublicId: record.publicId };
  if (!finiteNow(now) || now >= record.expiresAt) {
    return { ok: false, error: "session expired", sessionPublicId: record.publicId };
  }
  return {
    ok: true,
    sessionPublicId: record.publicId,
    subjectId: record.subjectId,
    expiresAt: record.expiresAt,
    ...tradingFlags(),
  };
}

export function logout(store, input) {
  const now = input?.now;
  const log = input?.log;
  const correlationId = input?.correlationId;
  const record = sessionByToken(store, input?.token);
  if (!record || !csrfMatches(record, input?.csrfToken)) {
    writeLog(log, { action: "logout", result: "denied", correlationId });
    return { ok: false, error: record ? "csrf denied" : "login denied" };
  }
  if (record.revokedAt == null) record.revokedAt = finiteNow(now) ? now : record.expiresAt;
  writeLog(log, { action: "logout", result: "revoked", sessionPublicId: record.publicId, correlationId });
  return { ok: true, clearCookie: clearSessionCookieHeader(), sessionPublicId: record.publicId, ...tradingFlags() };
}

export function revokeSession(store, publicId, now, log, correlationId) {
  const safeId = typeof publicId === "string" && UUID_PATTERN.test(publicId) ? publicId : null;
  const record = safeId ? store.byPublicId.get(safeId) : null;
  if (!record) {
    writeLog(log, { action: "revoke", result: "denied", correlationId });
    return { ok: false, error: "login denied" };
  }
  if (record.revokedAt == null) record.revokedAt = finiteNow(now) ? now : record.expiresAt;
  writeLog(log, { action: "revoke", result: "revoked", sessionPublicId: record.publicId, correlationId });
  return { ok: true, sessionPublicId: record.publicId };
}

export function rotateSession(store, input) {
  const now = input?.now;
  const log = input?.log;
  const correlationId = input?.correlationId;
  if (!configured(input?.policy) || !finiteNow(now)) {
    writeLog(log, { action: "rotate", result: "unconfigured", correlationId });
    return { ok: false, error: "session expiry is not configured" };
  }
  const current = readSession(store, input?.token, now);
  const record = sessionByToken(store, input?.token);
  if (!current.ok || !record || !csrfMatches(record, input?.csrfToken)) {
    writeLog(log, {
      action: "rotate",
      result: current.error === "session expired" ? "expired" : "denied",
      sessionPublicId: record?.publicId,
      correlationId,
    });
    if (current.error === "session expired" || current.error === "session revoked") return current;
    return { ok: false, error: record ? "csrf denied" : "login denied" };
  }
  const issued = issueSession(store, record.subjectId, now, input.policy);
  record.revokedAt = now;
  record.csrfHash = null;
  writeLog(log, { action: "rotate", result: "rotated", sessionPublicId: issued.sessionPublicId, correlationId });
  return { ok: true, ...issued };
}

const AUDIT_ACTIONS = new Set(["reset", "resend", "reset-confirm", "otp-confirm"]);
const AUDIT_RESULTS = new Set(["ok", "denied", "expired", "replayed", "throttled", "unconfigured"]);
const ALERT_ACTIONS = new Set(["login", "reset", "resend", "read"]);
const COUNTER_SCOPES = new Set(["account", "ip", "subject"]);

function writeAudit(audit, event) {
  if (!Array.isArray(audit)) return;
  const action = AUDIT_ACTIONS.has(event.action) ? event.action : "reset";
  const result = AUDIT_RESULTS.has(event.result) ? event.result : "denied";
  const subjectId = typeof event.subjectId === "string" && UUID_PATTERN.test(event.subjectId) ? event.subjectId : null;
  const correlationId = typeof event.correlationId === "string" && UUID_PATTERN.test(event.correlationId)
    ? event.correlationId
    : null;
  audit.push({ action, result, subjectId, correlationId });
}

function positiveInt(value) {
  return Number.isInteger(value) && value >= 1;
}

function limitsReady(policy) {
  return Boolean(policy)
    && positiveInt(policy.accountLimit)
    && positiveInt(policy.ipLimit)
    && positiveInt(policy.windowMs);
}

function writeAlert(alerts, event) {
  if (!Array.isArray(alerts)) return;
  if (!ALERT_ACTIONS.has(event?.action) || event.result !== "throttled") return;
  const subjectId = typeof event.subjectId === "string" && UUID_PATTERN.test(event.subjectId)
    ? event.subjectId
    : null;
  const correlationId = typeof event.correlationId === "string" && UUID_PATTERN.test(event.correlationId)
    ? event.correlationId
    : null;
  alerts.push(Object.freeze({
    action: event.action,
    result: "throttled",
    subjectId,
    correlationId,
  }));
}

function recoveryReady(policy, ttlField) {
  return Boolean(policy)
    && positiveInt(policy[ttlField])
    && positiveInt(policy.accountLimit)
    && positiveInt(policy.ipLimit)
    && positiveInt(policy.windowMs);
}

function allowThrottle(store, key, now, limit, windowMs) {
  const row = store.throttle.get(key);
  if (!row || now >= row.windowStart + windowMs) {
    store.throttle.set(key, { windowStart: now, count: 1 });
    return true;
  }
  if (row.count >= limit) return false;
  row.count += 1;
  return true;
}

// The source names no read cap. The subject bucket uses accountLimit and the address uses ipLimit.
export function allowSensitiveRead(store, input) {
  const now = input?.now;
  const correlationId = input?.correlationId;
  if (!limitsReady(input?.policy) || !finiteNow(now)) {
    return { ok: false, error: "rate limit is not configured" };
  }
  const subjectId = input?.subjectId;
  const ip = input?.ip;
  if (
    typeof subjectId !== "string"
    || !UUID_PATTERN.test(subjectId)
    || typeof ip !== "string"
    || ip.length === 0
  ) {
    return { ok: false, error: "rate limit denied" };
  }
  const subjectAllowed = allowThrottle(
    store,
    `read:subject:${digest(subjectId)}`,
    now,
    input.policy.accountLimit,
    input.policy.windowMs,
  );
  const ipAllowed = allowThrottle(
    store,
    `read:ip:${digest(ip)}`,
    now,
    input.policy.ipLimit,
    input.policy.windowMs,
  );
  if (!subjectAllowed || !ipAllowed) {
    writeAlert(input?.alerts, { action: "read", result: "throttled", subjectId, correlationId });
    return { ok: false, error: "rate limit denied" };
  }
  return { ok: true };
}

export function rateLimitCounters(store) {
  if (!store?.throttle || typeof store.throttle.entries !== "function") return [];
  const rows = [];
  for (const [key, row] of store.throttle) {
    if (typeof key !== "string" || !row || typeof row !== "object") continue;
    const parts = key.split(":");
    if (parts.length !== 3) continue;
    const [action, scope] = parts;
    if (!ALERT_ACTIONS.has(action) || !COUNTER_SCOPES.has(scope)) continue;
    if (!Number.isInteger(row.count) || typeof row.windowStart !== "number" || !Number.isFinite(row.windowStart)) {
      continue;
    }
    rows.push({ action, scope, count: row.count, windowStart: row.windowStart });
  }
  return rows;
}

export function publicRateAlerts(alerts, subjectId) {
  if (!Array.isArray(alerts)) return [];
  const rows = [];
  for (const event of alerts) {
    if (!event || typeof event !== "object") continue;
    if (event.subjectId !== subjectId || event.result !== "throttled" || !ALERT_ACTIONS.has(event.action)) continue;
    const correlationId = typeof event.correlationId === "string" && UUID_PATTERN.test(event.correlationId)
      ? event.correlationId
      : null;
    rows.push({
      action: event.action,
      result: "throttled",
      subjectId,
      correlationId,
    });
  }
  return rows;
}

function deliver(delivery, item) {
  if (!Array.isArray(delivery)) return;
  delivery.push({
    kind: item.kind,
    token: item.token,
    expiresAt: item.expiresAt,
    subjectId: item.subjectId,
  });
}

function accountBySubject(store, subjectId) {
  for (const account of store.accounts.values()) {
    if (account.subjectId === subjectId) return account;
  }
  return null;
}

function replaceOpenTokens(store, subjectId, kind, now) {
  for (const record of store.recovery.values()) {
    if (record.subjectId === subjectId && record.kind === kind && record.usedAt == null) {
      record.usedAt = now;
    }
  }
}

function revokeSubjectSessions(store, subjectId, now) {
  for (const session of store.sessions.values()) {
    if (session.subjectId === subjectId && session.revokedAt == null) session.revokedAt = now;
  }
}

function setPassword(account, password) {
  account.salt = randomBytes(16);
  account.hash = scryptSync(password, account.salt, 32, SCRYPT);
}

function requestRecovery(store, input, kind) {
  const now = input?.now;
  const action = kind === "otp" ? "resend" : "reset";
  const ttlField = kind === "otp" ? "resendTtlMs" : "resetTtlMs";
  const correlationId = input?.correlationId;
  if (!recoveryReady(input?.policy, ttlField) || !finiteNow(now)) {
    writeAudit(input?.audit, { action, result: "unconfigured", correlationId });
    return { ok: false, error: "reset is not configured" };
  }
  if (!takeChallenge(store, input?.csrfToken, now)) {
    writeAudit(input?.audit, { action, result: "denied", correlationId });
    return { ok: false, error: "csrf denied" };
  }
  const loginId = input?.loginId;
  const ip = input?.ip;
  if (typeof loginId !== "string" || loginId.length === 0 || typeof ip !== "string" || ip.length === 0) {
    writeAudit(input?.audit, { action, result: "unconfigured", correlationId });
    return { ok: true, issued: false };
  }
  const accountKey = `${action}:account:${digest(loginId)}`;
  const ipKey = `${action}:ip:${digest(ip)}`;
  const accountAllowed = allowThrottle(store, accountKey, now, input.policy.accountLimit, input.policy.windowMs);
  const ipAllowed = allowThrottle(store, ipKey, now, input.policy.ipLimit, input.policy.windowMs);
  const account = store.accounts.get(loginId) ?? null;
  if (!accountAllowed || !ipAllowed) {
    writeAudit(input?.audit, { action, result: "throttled", subjectId: account?.subjectId, correlationId });
    writeAlert(input?.alerts, { action, result: "throttled", subjectId: account?.subjectId, correlationId });
    return { ok: true, issued: false };
  }
  if (!account) {
    writeAudit(input?.audit, { action, result: "denied", correlationId });
    return { ok: true, issued: false };
  }
  replaceOpenTokens(store, account.subjectId, kind, now);
  const token = newSecret();
  const expiresAt = now + input.policy[ttlField];
  store.recovery.set(digest(token), {
    kind,
    subjectId: account.subjectId,
    expiresAt,
    usedAt: null,
  });
  deliver(input?.delivery, { kind, token, expiresAt, subjectId: account.subjectId });
  writeAudit(input?.audit, { action, result: "ok", subjectId: account.subjectId, correlationId });
  return { ok: true, issued: true };
}

export function requestReset(store, input) {
  return requestRecovery(store, input, "reset");
}

export function requestResend(store, input) {
  return requestRecovery(store, input, "otp");
}

function consumeRecovery(store, input, kind, action) {
  const now = input?.now;
  const correlationId = input?.correlationId;
  const token = input?.token;
  if (typeof token !== "string" || token.length === 0) {
    writeAudit(input?.audit, { action, result: "denied", correlationId });
    return { ok: false, error: "reset denied" };
  }
  const record = store.recovery.get(digest(token));
  if (!record || record.kind !== kind) {
    writeAudit(input?.audit, { action, result: "denied", correlationId });
    return { ok: false, error: "reset denied" };
  }
  if (record.usedAt != null) {
    writeAudit(input?.audit, { action, result: "replayed", subjectId: record.subjectId, correlationId });
    return { ok: false, error: "replayed" };
  }
  if (!finiteNow(now) || now >= record.expiresAt) {
    writeAudit(input?.audit, { action, result: "expired", subjectId: record.subjectId, correlationId });
    return { ok: false, error: "expired" };
  }
  record.usedAt = now;
  writeAudit(input?.audit, { action, result: "ok", subjectId: record.subjectId, correlationId });
  return { ok: true, subjectId: record.subjectId };
}

export function confirmReset(store, input) {
  const correlationId = input?.correlationId;
  if (!takeChallenge(store, input?.csrfToken, input?.now)) {
    writeAudit(input?.audit, { action: "reset-confirm", result: "denied", correlationId });
    return { ok: false, error: "csrf denied" };
  }
  if (typeof input?.password !== "string" || input.password.length === 0) {
    writeAudit(input?.audit, { action: "reset-confirm", result: "denied", correlationId });
    return { ok: false, error: "reset denied" };
  }
  const consumed = consumeRecovery(store, input, "reset", "reset-confirm");
  if (!consumed.ok) return consumed;
  const account = accountBySubject(store, consumed.subjectId);
  if (!account) return { ok: false, error: "reset denied" };
  setPassword(account, input.password);
  if (finiteNow(input?.now)) revokeSubjectSessions(store, account.subjectId, input.now);
  return { ok: true, ...tradingFlags() };
}

export function confirmOtp(store, input) {
  if (!takeChallenge(store, input?.csrfToken, input?.now)) {
    writeAudit(input?.audit, { action: "otp-confirm", result: "denied", correlationId: input?.correlationId });
    return { ok: false, error: "csrf denied" };
  }
  const consumed = consumeRecovery(
    store,
    { ...input, token: input?.otp },
    "otp",
    "otp-confirm",
  );
  if (!consumed.ok) return consumed;
  return { ok: true, ...tradingFlags() };
}
