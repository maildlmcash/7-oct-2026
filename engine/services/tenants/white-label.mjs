// Allowlisted subdomain themes for task 1.D.1.
// The request Host header is the only trusted host.
// A theme applies only when its Ed25519 signature matches the pinned public key.
// The private key is not in this repository.
// Trading, orders, wallet access, and exchange credentials stay off.

import { createPublicKey, verify } from "node:crypto";

export const PUBLIC_KEY_PEM = `-----BEGIN PUBLIC KEY-----
MCowBQYDK2VwAyEA3aKPwxnZRQKEUKfgatmc3M9vBMjt62zqh9J7BO4G+no=
-----END PUBLIC KEY-----`;

const COLOR = /^#[0-9a-f]{6}$/;
const HOST_NAME = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/;

export const THEME_FIELDS = Object.freeze([
  "color",
  "featureFlags",
  "helpLinks",
  "host",
  "logoText",
  "subdomain",
  "tenantId",
]);

const FLAG_FIELDS = Object.freeze(["help", "paperPreview"]);

function fail(error) {
  return { ok: false, error, pathname: "/app", theme: null };
}

function normalizeHost(value) {
  if (typeof value !== "string") return null;
  let host = value.trim().toLowerCase();
  if (host.endsWith(".")) host = host.slice(0, -1);
  const colon = host.lastIndexOf(":");
  if (colon !== -1) {
    const port = host.slice(colon + 1);
    if (!/^\d{1,5}$/.test(port)) return null;
    host = host.slice(0, colon);
  }
  if (!HOST_NAME.test(host)) return null;
  return host;
}

function sameHost(left, right) {
  const a = normalizeHost(left);
  const b = normalizeHost(right);
  return a !== null && a === b;
}

export function canonicalTheme(config) {
  const flags = config.featureFlags;
  const links = config.helpLinks.map((link) => ({ href: link.href, label: link.label }));
  links.sort((left, right) => left.label.localeCompare(right.label) || left.href.localeCompare(right.href));
  return JSON.stringify({
    color: config.color,
    featureFlags: { help: flags.help === true, paperPreview: flags.paperPreview === true },
    helpLinks: links,
    host: config.host,
    logoText: config.logoText,
    subdomain: config.subdomain,
    tenantId: config.tenantId,
  });
}

function publicKey() {
  return createPublicKey(PUBLIC_KEY_PEM);
}

export function themeSignatureMatches(config, signature) {
  if (typeof signature !== "string" || signature.length === 0) return false;
  try {
    const bytes = Buffer.from(signature, "base64");
    return verify(null, Buffer.from(canonicalTheme(config)), publicKey(), bytes);
  } catch {
    return false;
  }
}

function helpLink(link) {
  if (!link || typeof link.label !== "string" || link.label.trim() === "") return null;
  if (typeof link.href !== "string") return null;
  let url;
  try {
    url = new URL(link.href);
  } catch {
    return null;
  }
  if (url.protocol !== "https:") return null;
  if (url.username || url.password) return null;
  if (url.search || url.hash) return null;
  if (link.label.length > 40 || /bearer\s|private key|api_key|seed phrase/i.test(link.label)) return null;
  return { label: link.label.trim(), href: url.origin + url.pathname };
}

function flagsOf(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const keys = Object.keys(value);
  if (keys.some((key) => !FLAG_FIELDS.includes(key))) return null;
  if (typeof value.help !== "boolean" || value.paperPreview !== true) return null;
  return { help: value.help, paperPreview: true };
}

function themeFrom(config) {
  if (!config || typeof config !== "object" || Array.isArray(config)) return null;
  const keys = Object.keys(config);
  if (keys.some((key) => !THEME_FIELDS.includes(key)) || THEME_FIELDS.some((key) => !keys.includes(key))) return null;
  const host = normalizeHost(config.host);
  if (!host || host !== config.host) return null;
  if (typeof config.tenantId !== "string" || !/^tenant-[a-z]{3,20}$/.test(config.tenantId)) return null;
  if (typeof config.subdomain !== "string" || !/^[a-z]{3,20}$/.test(config.subdomain)) return null;
  if (typeof config.logoText !== "string" || config.logoText.trim().length < 3 || config.logoText.length > 24) return null;
  if (typeof config.color !== "string" || !COLOR.test(config.color)) return null;
  if (!Array.isArray(config.helpLinks) || config.helpLinks.length < 1 || config.helpLinks.length > 3) return null;
  const helpLinks = [];
  for (const link of config.helpLinks) {
    const safe = helpLink(link);
    if (!safe) return null;
    helpLinks.push(safe);
  }
  const featureFlags = flagsOf(config.featureFlags);
  if (!featureFlags) return null;
  return {
    tenantId: config.tenantId,
    host,
    subdomain: config.subdomain,
    logoText: config.logoText.trim(),
    color: config.color,
    helpLinks,
    featureFlags: {
      ...featureFlags,
      liveTrading: false,
      liveOrdersLocked: true,
      walletAccess: false,
      exchangeCredentials: false,
    },
  };
}

const ALPHA = {
  tenantId: "tenant-alpha",
  host: "alpha.preview.test",
  subdomain: "alpha",
  logoText: "Alpha desk",
  color: "#0f6e56",
  helpLinks: [{ label: "Help", href: "https://alpha.preview.test/help" }],
  featureFlags: { help: true, paperPreview: true },
};

const BETA = {
  tenantId: "tenant-beta",
  host: "beta.preview.test",
  subdomain: "beta",
  logoText: "Beta desk",
  color: "#1f4b99",
  helpLinks: [{ label: "Help", href: "https://beta.preview.test/help" }],
  featureFlags: { help: true, paperPreview: true },
};

const GAMMA = {
  tenantId: "tenant-gamma",
  host: "gamma.preview.test",
  subdomain: "gamma",
  logoText: "Gamma desk",
  color: "#8d4a12",
  helpLinks: [{ label: "Help", href: "https://gamma.preview.test/help" }],
  featureFlags: { help: false, paperPreview: true },
};

export const APPROVED_THEMES = Object.freeze([ALPHA, BETA, GAMMA]);

// Filled after the public key is pinned. A wrong signature applies no theme.
const SIGNATURES = Object.freeze({
  "alpha.preview.test": "fzX7rOYdRrveu5Z1oI8cHICXDsuE6VVT0Av8fbLvJ7EFYI7GwqYkRP6rnisyfw++tPiTL6qiUSl5GTeJONnWCQ==",
  "beta.preview.test": "iDSdN3mok0ABaKHNlrCio6VbI2gCwtBbxHyoj1/hWgnvhYNhhViRJeVVGJP7I3CZmrkR7n971zqXzWCJJYM1CQ==",
  "gamma.preview.test": "gB+eAKElO32/FO3NLFwkGm4m7nRj93tIn9n65oV40yoCPvwpGa+z0NeBqCVDsNm40tSHn4sXMzjVLalMU8+dCw==",
});

export function approvedRegistry() {
  return approvedRows();
}

function approvedRows() {
  return APPROVED_THEMES.map((config) => Object.freeze({
    host: config.host,
    tenantId: config.tenantId,
    subdomain: config.subdomain,
    config,
    signature: SIGNATURES[config.host],
  }));
}

function headerAgrees(trusted, presented) {
  if (presented == null || presented === "") return true;
  return sameHost(trusted, presented);
}

export function resolveTenantHost(input, registry = approvedRows()) {
  const source = input && typeof input === "object" ? input : {};
  const host = normalizeHost(source.host);
  if (!host) return fail("unknown host");
  if (!headerAgrees(host, source.forwardedHost) || !headerAgrees(host, source.originalHost)) {
    return fail("host spoofing rejected");
  }
  const row = registry.find((item) => item.host === host);
  if (!row) return fail("unknown host");
  const theme = themeFrom(row.config);
  if (!theme || !themeSignatureMatches(row.config, row.signature)) {
    return fail("tenant configuration is not signed");
  }
  if (theme.tenantId !== row.tenantId || theme.host !== row.host || theme.subdomain !== row.subdomain) {
    return fail("tenant mismatch");
  }
  if (typeof source.requestedTenantId === "string" && source.requestedTenantId !== row.tenantId) {
    return fail("tenant mismatch");
  }
  if (typeof source.userTenantId === "string" && source.userTenantId !== row.tenantId) {
    return fail("user-subdomain mismatch");
  }
  if (typeof source.userSubdomain === "string" && source.userSubdomain !== row.subdomain) {
    return fail("user-subdomain mismatch");
  }
  return {
    ok: true,
    error: null,
    pathname: "/app",
    theme: Object.freeze({
      ...theme,
      helpLinks: Object.freeze(theme.helpLinks.map((link) => Object.freeze({ ...link }))),
      featureFlags: Object.freeze(theme.featureFlags),
    }),
  };
}

export function approvedPreviews() {
  return APPROVED_THEMES.map((config) => resolveTenantHost({ host: config.host }));
}
