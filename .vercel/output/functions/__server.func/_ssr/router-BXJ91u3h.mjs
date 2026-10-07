import { i as __toESM } from "../_runtime.mjs";
import { K as require_react, _ as createFileRoute, b as require_jsx_runtime, d as Scripts, f as HeadContent, g as lazyRouteComponent, h as Outlet, m as createRouter, v as createRootRoute, y as useRouter } from "../_libs/@tanstack/react-router+[...].mjs";
import { t as TriangleAlert } from "../_libs/lucide-react.mjs";
import { a as union, i as string, n as number, r as object, t as literal } from "../_libs/zod.mjs";
import { createHash, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
//#region node_modules/.nitro/vite/services/ssr/assets/router-BXJ91u3h.js
var import_react = /* @__PURE__ */ __toESM(require_react());
var import_jsx_runtime = require_jsx_runtime();
var __defProp = Object.defineProperty;
var __exportAll = (all, no_symbols) => {
	let target = {};
	for (var name in all) __defProp(target, name, {
		get: all[name],
		enumerable: true
	});
	if (!no_symbols) __defProp(target, Symbol.toStringTag, { value: "Module" });
	return target;
};
var FALLBACK_MESSAGE = "An unexpected error occurred. Try reloading the page.";
function errorMessage(error) {
	if (error instanceof Error && error.message) return error.message;
	if (typeof error === "string" && error) return error;
	return FALLBACK_MESSAGE;
}
function AppErrorComponent({ error }) {
	return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("main", {
		className: "flex min-h-screen flex-col items-center justify-center gap-3 px-6 text-center bg-zinc-50 text-zinc-900 dark:bg-zinc-950 dark:text-zinc-50",
		children: [
			/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", {
				className: "text-red-500",
				"aria-hidden": "true",
				children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(TriangleAlert, {
					className: "size-10",
					strokeWidth: 2
				})
			}),
			/* @__PURE__ */ (0, import_jsx_runtime.jsx)("h1", {
				className: "text-lg font-semibold",
				children: "Something went wrong"
			}),
			/* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
				className: "max-w-md text-sm break-words text-zinc-500 dark:text-zinc-400",
				children: errorMessage(error)
			})
		]
	});
}
/**
* App-wide client provider mounted once near the root (in `src/routes/__root.tsx`):
*
*   <AuthProvider><Outlet /></AuthProvider>
*
* Better Auth's React client (`@/lib/auth/client`) needs NO context provider —
* its `useSession()` works standalone — so this is a passthrough today. It's
* kept as the single, stable mount point for any future client-side providers
* (e.g. a toast or theme provider) without churning the root shell.
*/
function AuthProvider({ children }) {
	return /* @__PURE__ */ (0, import_jsx_runtime.jsx)(import_jsx_runtime.Fragment, { children });
}
var CONNECTOR_TOKEN_READY_EVENT = "grok:connector-token-ready";
function isGrokEmbedderOrigin(origin) {
	try {
		const url = new URL(origin);
		if (url.protocol !== "https:" && url.protocol !== "http:") return false;
		const host = url.hostname.toLowerCase();
		if (host === "grok.com" || host.endsWith(".grok.com")) return true;
		if (host === "localhost" || host === "127.0.0.1" || host === "[::1]") return true;
		return false;
	} catch {
		return false;
	}
}
function isSandboxPreviewGuestHost(hostname) {
	const host = hostname.toLowerCase();
	return host === "grok-sandbox.com" || host.endsWith(".grok-sandbox.com");
}
function isRemintPreviewPair(guestHost, parentHost) {
	const guest = guestHost.toLowerCase();
	const parent = parentHost.toLowerCase();
	const i = guest.indexOf(".preview.");
	if (i <= 0) return false;
	const label = guest.slice(0, i);
	const rest = guest.slice(i + 9);
	if (label.includes(".") || !rest.includes(".")) return false;
	return parent === rest || parent === `grok.${rest}`;
}
function resolveParentEmbedderOrigin(parentIsSelf, referrer, ancestorOrigin, guestHostname = "") {
	if (parentIsSelf) return null;
	for (const candidate of [referrer, ancestorOrigin ?? ""].filter(Boolean)) try {
		const url = new URL(candidate.includes("://") ? candidate : `https://${candidate}`);
		if (url.protocol !== "https:" && url.protocol !== "http:") continue;
		if (isGrokEmbedderOrigin(url.origin)) return url.origin;
		if (isSandboxPreviewGuestHost(guestHostname) || isRemintPreviewPair(guestHostname, url.hostname)) return url.origin;
	} catch {}
	return null;
}
/**
* Guest side of the grok-web ↔ sandbox preview postMessage bridge.
*
* Activates only when this page is framed by an allowlisted Grok embedder.
* Top-level runs (download/export, local `npm run dev`, deployed sites) noop.
*/
var PREVIEW_BRIDGE_CHANNEL = "grok-preview-bridge";
var EnvelopeSchema = object({
	channel: literal(PREVIEW_BRIDGE_CHANNEL),
	version: number().int().positive(),
	type: string().min(1)
});
var HelloSchema = EnvelopeSchema.extend({ type: literal("hello") });
var NavigateSchema = EnvelopeSchema.extend({
	type: literal("navigate"),
	path: string().min(1)
});
var HistorySchema = EnvelopeSchema.extend({
	type: literal("history"),
	delta: union([literal(-1), literal(1)])
});
var ConnectorTokenReadySchema = EnvelopeSchema.extend({ type: literal("connector-token-ready") });
function isSafeBridgePath(path) {
	if (!path.startsWith("/") || path.startsWith("//") || path.includes("\\")) return false;
	try {
		return new URL(path, "https://preview.invalid").origin === "https://preview.invalid";
	} catch {
		return false;
	}
}
/**
* Origin of the Grok embedder framing this page, or null when the page runs
* top-level (download/export, local `npm run dev`, deployed sites) or under a
* non-Grok parent. Client-only; null during SSR.
*/
function resolveCurrentEmbedderOrigin() {
	if (typeof window === "undefined") return null;
	const ancestorOrigin = typeof location.ancestorOrigins !== "undefined" && location.ancestorOrigins.length > 0 ? location.ancestorOrigins[0] : null;
	return resolveParentEmbedderOrigin(window.parent === window, document.referrer, ancestorOrigin, window.location.hostname);
}
/**
* Install host↔guest messaging. Returns a dispose function.
* Noops (returns a no-op dispose) when not embedded under a Grok parent.
*/
function installPreviewHostBridge(options = {}) {
	const parentOrigin = resolveCurrentEmbedderOrigin();
	if (parentOrigin === null) return () => {};
	const ROOT_STATE_KEY = "__grokPreviewBridgeRoot";
	const originalPushState = window.history.pushState.bind(window.history);
	const originalReplaceState = window.history.replaceState.bind(window.history);
	const isAtHistoryRoot = () => {
		const state = window.history.state;
		return Boolean(state && typeof state === "object" && state[ROOT_STATE_KEY] === true);
	};
	try {
		const current = window.history.state;
		if (!(current !== null && typeof current === "object" && Object.prototype.hasOwnProperty.call(current, ROOT_STATE_KEY))) {
			const isRoot = window.history.length <= 1;
			originalReplaceState(current && typeof current === "object" ? {
				...current,
				[ROOT_STATE_KEY]: isRoot
			} : { [ROOT_STATE_KEY]: isRoot }, "", window.location.href);
		}
	} catch {}
	const post = (message) => {
		window.parent.postMessage(message, parentOrigin);
	};
	const reportLocation = () => {
		post({
			channel: PREVIEW_BRIDGE_CHANNEL,
			version: 1,
			type: "location",
			path: window.location.pathname || "/",
			search: window.location.search,
			hash: window.location.hash
		});
	};
	const reportRoutes = () => {
		const paths = options.getRoutePaths?.() ?? [];
		post({
			channel: PREVIEW_BRIDGE_CHANNEL,
			version: 1,
			type: "routes",
			paths
		});
	};
	const defaultNavigate = (path) => {
		if (!isSafeBridgePath(path)) return;
		try {
			const url = new URL(path, window.location.origin);
			if (url.origin !== window.location.origin) return;
			const next = `${url.pathname}${url.search}${url.hash}`;
			window.history.pushState(window.history.state, "", next);
			window.dispatchEvent(new PopStateEvent("popstate", { state: window.history.state }));
		} catch {}
	};
	const navigate = (path) => {
		if (!isSafeBridgePath(path)) return;
		if (options.navigate) {
			options.navigate(path);
			return;
		}
		defaultNavigate(path);
	};
	const announce = () => {
		reportLocation();
		reportRoutes();
		post({
			channel: PREVIEW_BRIDGE_CHANNEL,
			version: 1,
			type: "ready"
		});
	};
	const onHello = (data) => {
		if (!HelloSchema.safeParse(data).success) return;
		announce();
	};
	const onNavigate = (data) => {
		const parsed = NavigateSchema.safeParse(data);
		if (!parsed.success) return;
		navigate(parsed.data.path);
		queueMicrotask(reportLocation);
	};
	const onHistory = (data) => {
		const parsed = HistorySchema.safeParse(data);
		if (!parsed.success) return;
		if (parsed.data.delta === -1 && isAtHistoryRoot()) return;
		window.history.go(parsed.data.delta);
	};
	const onConnectorTokenReady = (data) => {
		if (!ConnectorTokenReadySchema.safeParse(data).success) return;
		window.dispatchEvent(new Event(CONNECTOR_TOKEN_READY_EVENT));
	};
	const hostMessageHandlers = /* @__PURE__ */ new Map([
		["hello", onHello],
		["navigate", onNavigate],
		["history", onHistory],
		["connector-token-ready", onConnectorTokenReady]
	]);
	const onMessage = (event) => {
		if (event.source !== window.parent) return;
		if (event.origin !== parentOrigin) return;
		const envelope = EnvelopeSchema.safeParse(event.data);
		if (!envelope.success || envelope.data.version !== 1) return;
		hostMessageHandlers.get(envelope.data.type)?.(event.data);
	};
	const onPopState = () => {
		reportLocation();
	};
	const onHashChange = () => {
		reportLocation();
	};
	window.history.pushState = (data, unused, url) => {
		const next = data && typeof data === "object" ? {
			...data,
			[ROOT_STATE_KEY]: false
		} : data;
		originalPushState(next, unused, url);
		reportLocation();
	};
	window.history.replaceState = (data, unused, url) => {
		const next = isAtHistoryRoot() ? {
			...data && typeof data === "object" ? data : {},
			[ROOT_STATE_KEY]: true
		} : data;
		originalReplaceState(next, unused, url);
		reportLocation();
	};
	window.addEventListener("message", onMessage);
	window.addEventListener("popstate", onPopState);
	window.addEventListener("hashchange", onHashChange);
	announce();
	return () => {
		window.removeEventListener("message", onMessage);
		window.removeEventListener("popstate", onPopState);
		window.removeEventListener("hashchange", onHashChange);
		window.history.pushState = originalPushState;
		window.history.replaceState = originalReplaceState;
	};
}
/** Collect static path patterns from a TanStack route tree (best-effort). */
function collectRoutePathsFromTree(routeTree) {
	const paths = /* @__PURE__ */ new Set();
	const walk = (node) => {
		if (!node || typeof node !== "object") return;
		const record = node;
		const full = typeof record.fullPath === "string" ? record.fullPath : typeof record.path === "string" ? record.path : null;
		if (full !== null && full !== "") paths.add(full.startsWith("/") ? full : `/${full}`);
		else if (full === "") paths.add("/");
		const children = record.children;
		if (Array.isArray(children)) for (const child of children) walk(child);
		else if (children && typeof children === "object") for (const child of Object.values(children)) walk(child);
	};
	walk(routeTree);
	return [...paths];
}
/**
* Mount once in `__root.tsx` so the Grok preview chrome can drive navigation
* (and later receive registered routes). Noops when the app is not embedded.
*/
function PreviewHostBridge() {
	const router = useRouter();
	(0, import_react.useEffect)(() => {
		return installPreviewHostBridge({
			navigate: (path) => {
				router.history.push(path);
			},
			getRoutePaths: () => collectRoutePathsFromTree(router.routeTree)
		});
	}, [router]);
	return null;
}
var styles_default = "/assets/styles-BsCUYr1-.css";
var Route$8 = createRootRoute({
	head: () => ({
		meta: [
			{ charSet: "utf-8" },
			{
				name: "viewport",
				content: "width=device-width, initial-scale=1"
			},
			{ title: "Crypto Prediction Engine" },
			{
				name: "theme-color",
				content: "#08795c"
			}
		],
		links: [
			{
				rel: "icon",
				type: "image/svg+xml",
				href: "/favicon.svg"
			},
			{
				rel: "stylesheet",
				href: styles_default
			},
			{
				rel: "manifest",
				href: "/__grok/manifest.webmanifest"
			},
			{
				rel: "apple-touch-icon",
				href: "/__grok/icon-180.png"
			}
		]
	}),
	component: () => /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("html", {
		lang: "en",
		suppressHydrationWarning: true,
		children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("head", { children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(HeadContent, {}) }), /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("body", { children: [
			/* @__PURE__ */ (0, import_jsx_runtime.jsx)(PreviewHostBridge, {}),
			/* @__PURE__ */ (0, import_jsx_runtime.jsx)(AuthProvider, { children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Outlet, {}) }),
			/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Scripts, {})
		] })]
	})
});
var $$splitComponentImporter = () => import("./routes-T1hyOanx.mjs");
var Route$7 = createFileRoute("/")({ component: lazyRouteComponent($$splitComponentImporter, "component") });
var SHELL_SECTIONS = Object.freeze([
	"Dashboard",
	"Market",
	"DEX",
	"Wallets",
	"Predictions",
	"Paper",
	"Search",
	"Checklist",
	"Bugs",
	"Admin"
]);
var SECTION_SET$1 = new Set(SHELL_SECTIONS);
var STATUS_STATES = /* @__PURE__ */ new Set([
	"empty",
	"loading",
	"ready",
	"error"
]);
var COUNT_KEYS = Object.freeze([
	"PASS",
	"FAIL",
	"BLOCKED",
	"STALE"
]);
var VIEW_KEYS = Object.freeze([
	"section",
	"filters",
	"pagination",
	"status"
]);
var PAGINATION_KEYS = Object.freeze(["pageIndex", "pageSize"]);
var STATUS_KEYS = Object.freeze([
	"state",
	"counts",
	"error"
]);
function plainObject(value) {
	return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
function unknownKey(value, allowed) {
	for (const key of Object.keys(value)) if (!allowed.includes(key)) return true;
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
		STALE: counts.STALE
	};
}
function copyState(state) {
	return {
		section: state.section,
		filters: {},
		pagination: {
			pageIndex: state.pagination.pageIndex,
			pageSize: state.pagination.pageSize
		},
		status: {
			state: state.status.state,
			counts: copyCounts(state.status.counts),
			error: state.status.error
		}
	};
}
function emptyUserVisibleStatus() {
	return {
		state: "empty",
		counts: {
			PASS: 0,
			FAIL: 0,
			BLOCKED: 0,
			STALE: 0
		},
		error: null
	};
}
function parseUserVisibleStatus(input) {
	if (!plainObject(input) || unknownKey(input, STATUS_KEYS)) return {
		ok: false,
		error: "invalid status"
	};
	if (!STATUS_STATES.has(input.state)) return {
		ok: false,
		error: "invalid status"
	};
	if (!plainObject(input.counts) || unknownKey(input.counts, COUNT_KEYS)) return {
		ok: false,
		error: "invalid status"
	};
	const counts = {};
	for (const key of COUNT_KEYS) {
		if (!integerAtLeast(input.counts[key], 0)) return {
			ok: false,
			error: "invalid status"
		};
		counts[key] = input.counts[key];
	}
	if (input.state === "error") {
		if (typeof input.error !== "string" || input.error.trim().length === 0) return {
			ok: false,
			error: "invalid status"
		};
		return {
			ok: true,
			status: {
				state: "error",
				counts,
				error: input.error
			}
		};
	}
	if (input.error !== null) return {
		ok: false,
		error: "invalid status"
	};
	return {
		ok: true,
		status: {
			state: input.state,
			counts,
			error: null
		}
	};
}
function parseFilters(input) {
	if (!plainObject(input) || Object.keys(input).length > 0) return {
		ok: false,
		error: "invalid filters"
	};
	return {
		ok: true,
		filters: {}
	};
}
function parsePagination(input) {
	if (!plainObject(input) || unknownKey(input, PAGINATION_KEYS)) return {
		ok: false,
		error: "invalid pagination"
	};
	if (!integerAtLeast(input.pageIndex, 0)) return {
		ok: false,
		error: "invalid page"
	};
	if (!integerAtLeast(input.pageSize, 1)) return {
		ok: false,
		error: "invalid page size"
	};
	return {
		ok: true,
		pagination: {
			pageIndex: input.pageIndex,
			pageSize: input.pageSize
		}
	};
}
function parseClientViewState(input) {
	if (!plainObject(input) || unknownKey(input, VIEW_KEYS)) return {
		ok: false,
		error: "unknown field"
	};
	if (!SECTION_SET$1.has(input.section)) return {
		ok: false,
		error: "invalid section"
	};
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
			status: status.status
		}
	};
}
function initialClientViewState(input) {
	if (!plainObject(input) || unknownKey(input, ["pageSize", "status"])) return {
		ok: false,
		error: "unknown field"
	};
	return parseClientViewState({
		section: "Dashboard",
		filters: {},
		pagination: {
			pageIndex: 0,
			pageSize: input.pageSize
		},
		status: input.status
	});
}
function refreshClientViewState(input) {
	return initialClientViewState(input);
}
function selectSection(state, section) {
	if (!SECTION_SET$1.has(section)) return {
		ok: false,
		error: "invalid section"
	};
	const next = copyState(state);
	next.section = section;
	return {
		ok: true,
		state: next
	};
}
function setPageIndex(state, pageIndex) {
	if (!integerAtLeast(pageIndex, 0)) return {
		ok: false,
		error: "invalid page"
	};
	const next = copyState(state);
	next.pagination.pageIndex = pageIndex;
	return {
		ok: true,
		state: next
	};
}
var CORRELATION_HEADER = "x-correlation-id";
var SECTION_HEADER = "x-shell-section";
var UUID_PATTERN$1 = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
var SECTION_SET = new Set(SHELL_SECTIONS);
var ROUTES = /* @__PURE__ */ new Set([
	"/api/view-state",
	"/api/checklist-owner",
	"section-render"
]);
function resolveCorrelationId(header) {
	if (typeof header === "string" && UUID_PATTERN$1.test(header)) return header;
	return crypto.randomUUID();
}
function shellSectionName(header) {
	if (typeof header === "string" && SECTION_SET.has(header)) return header;
	return null;
}
function diagnosticEvent(input) {
	const source = input && typeof input === "object" ? input : {};
	const route = typeof source.route === "string" && ROUTES.has(source.route) ? source.route : null;
	const httpStatus = Number.isInteger(source.httpStatus) ? source.httpStatus : null;
	return {
		correlationId: resolveCorrelationId(source.correlationId),
		section: shellSectionName(source.section),
		route,
		httpStatus
	};
}
var PAGE_HEALTH_ENVIRONMENTS = Object.freeze([
	"local",
	"test",
	"staging"
]);
var SHA_PATTERN = /^[0-9a-f]{7,64}$/i;
var ENVIRONMENT_SET = new Set(PAGE_HEALTH_ENVIRONMENTS);
var ROUTE_SET = /* @__PURE__ */ new Set([
	"/api/view-state",
	"/api/checklist-owner",
	"/api/session",
	"/api/session/csrf",
	"/api/session/login",
	"/api/session/logout",
	"/api/session/rotate",
	"/api/session/limits",
	"/api/session/reset",
	"/api/session/resend",
	"/api/session/reset/confirm",
	"/api/session/otp",
	"section-render",
	"missing-page"
]);
function knownEnvironment(value) {
	return typeof value === "string" && ENVIRONMENT_SET.has(value) ? value : null;
}
function knownBuildSha(value) {
	return typeof value === "string" && SHA_PATTERN.test(value) ? value.toLowerCase() : null;
}
function knownViewId(value) {
	const section = shellSectionName(value);
	if (section) return section;
	if (value === "missing-page") return "missing-page";
	return null;
}
function knownStatus(value) {
	if (!Number.isInteger(value) || value < 100 || value > 599) return null;
	return value;
}
function pageHealthEvent(input) {
	const source = input && typeof input === "object" ? input : {};
	const routeViewId = typeof source.routeViewId === "string" && ROUTE_SET.has(source.routeViewId) ? source.routeViewId : null;
	let viewId = knownViewId(source.viewId);
	if (!viewId && routeViewId === "missing-page") viewId = "missing-page";
	const exception = source.exception == null || source.exception === false ? null : "js-exception";
	return Object.freeze({
		routeViewId,
		viewId,
		httpStatus: knownStatus(source.httpStatus),
		exception,
		requestId: resolveCorrelationId(source.requestId ?? source.correlationId),
		buildSha: knownBuildSha(source.buildSha),
		environment: knownEnvironment(source.environment)
	});
}
function recordPageHealth(input, sink) {
	const event = pageHealthEvent(input);
	if (Array.isArray(sink)) sink.push(event);
	return event;
}
var serverPageHealthEvents = [];
function recordServerFailure(input, sink = serverPageHealthEvents) {
	const source = input && typeof input === "object" ? input : {};
	return recordPageHealth({
		routeViewId: source.routeViewId,
		viewId: source.viewId,
		httpStatus: source.httpStatus,
		exception: source.exception,
		requestId: source.requestId ?? source.correlationId,
		buildSha: source.buildSha ?? null,
		environment: source.environment ?? knownEnvironment(process.env.APP_ENV)
	}, sink);
}
function respondViewState(request, body, status) {
	const correlationId = resolveCorrelationId(request.headers.get(CORRELATION_HEADER));
	if (status >= 400) recordServerFailure({
		routeViewId: "/api/view-state",
		viewId: request.headers.get(SECTION_HEADER),
		httpStatus: status,
		requestId: correlationId
	});
	return Response.json({
		...body,
		correlationId
	}, {
		status,
		headers: {
			[CORRELATION_HEADER]: correlationId,
			"cache-control": "no-store"
		}
	});
}
function getViewState(request) {
	const raw = new URL(request.url).searchParams.get("pageSize");
	const result = refreshClientViewState({
		pageSize: raw === null ? NaN : Number(raw),
		status: emptyUserVisibleStatus()
	});
	return respondViewState(request, result, result.ok ? 200 : 400);
}
async function postViewState(request) {
	let body;
	try {
		body = await request.json();
	} catch {
		return respondViewState(request, {
			ok: false,
			error: "invalid view state"
		}, 400);
	}
	const result = parseClientViewState(body);
	return respondViewState(request, result, result.ok ? 200 : 400);
}
var Route$6 = createFileRoute("/api/view-state")({ server: { handlers: {
	GET: ({ request }) => getViewState(request),
	POST: ({ request }) => postViewState(request)
} } });
var health = Object.freeze({
	status: "ok",
	liveTrading: "OFF",
	liveOrdersLocked: true
});
var SESSION_COOKIE_NAME = "__Host-session";
var CSRF_HEADER = "x-csrf-token";
var CLIENT_IP_HEADER = "x-client-ip";
var UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
var ACTIONS = /* @__PURE__ */ new Set([
	"login",
	"logout",
	"rotate",
	"revoke",
	"csrf"
]);
var RESULTS = /* @__PURE__ */ new Set([
	"ok",
	"denied",
	"revoked",
	"expired",
	"rotated",
	"unconfigured",
	"throttled"
]);
var SCRYPT = Object.freeze({
	N: 16384,
	r: 8,
	p: 1
});
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
	const sessionPublicId = typeof event.sessionPublicId === "string" && UUID_PATTERN.test(event.sessionPublicId) ? event.sessionPublicId : null;
	const correlationId = typeof event.correlationId === "string" && UUID_PATTERN.test(event.correlationId) ? event.correlationId : null;
	log.push({
		action,
		result,
		sessionPublicId,
		correlationId
	});
}
function tradingFlags() {
	return {
		liveTrading: health.liveTrading,
		liveOrdersLocked: health.liveOrdersLocked
	};
}
function createSessionStore() {
	return {
		accounts: /* @__PURE__ */ new Map(),
		challenges: /* @__PURE__ */ new Map(),
		sessions: /* @__PURE__ */ new Map(),
		byPublicId: /* @__PURE__ */ new Map(),
		recovery: /* @__PURE__ */ new Map(),
		throttle: /* @__PURE__ */ new Map()
	};
}
function createAccount(store, input) {
	const loginId = input?.loginId;
	const password = input?.password;
	if (typeof loginId !== "string" || loginId.length === 0) return {
		ok: false,
		error: "invalid login"
	};
	if (typeof password !== "string" || password.length === 0) return {
		ok: false,
		error: "invalid login"
	};
	if (store.accounts.has(loginId)) return {
		ok: false,
		error: "duplicate login"
	};
	const salt = randomBytes(16);
	const hash = scryptSync(password, salt, 32, SCRYPT);
	const subjectId = crypto.randomUUID();
	store.accounts.set(loginId, {
		loginId,
		salt,
		hash,
		subjectId
	});
	return {
		ok: true,
		subjectId
	};
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
function sessionCookieHeader(token, expiresAt) {
	return `${SESSION_COOKIE_NAME}=${token}; HttpOnly; Secure; SameSite=Strict; Path=/; Expires=${new Date(expiresAt).toUTCString()}`;
}
function clearSessionCookieHeader() {
	return `${SESSION_COOKIE_NAME}=; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=0`;
}
function readCookie(header, name) {
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
		revokedAt: null
	};
	store.sessions.set(record.tokenHash, record);
	store.byPublicId.set(publicId, record);
	return {
		token,
		csrfToken,
		sessionPublicId: publicId,
		expiresAt,
		setCookie: sessionCookieHeader(token, expiresAt),
		...tradingFlags()
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
function beginLogin(store, input) {
	const now = input?.now;
	const log = input?.log;
	const correlationId = input?.correlationId;
	if (!configured(input?.policy) || !finiteNow(now)) {
		writeLog(log, {
			action: "csrf",
			result: "unconfigured",
			correlationId
		});
		return {
			ok: false,
			error: "session expiry is not configured"
		};
	}
	const csrfToken = newSecret();
	store.challenges.set(digest(csrfToken), { expiresAt: now + input.policy.ttlMs });
	writeLog(log, {
		action: "csrf",
		result: "ok",
		correlationId
	});
	return {
		ok: true,
		csrfToken,
		expiresAt: now + input.policy.ttlMs
	};
}
function login(store, input) {
	const now = input?.now;
	const log = input?.log;
	const correlationId = input?.correlationId;
	if (!configured(input?.policy) || !finiteNow(now)) {
		writeLog(log, {
			action: "login",
			result: "unconfigured",
			correlationId
		});
		return {
			ok: false,
			error: "session expiry is not configured"
		};
	}
	if (!takeChallenge(store, input?.csrfToken, now)) {
		writeLog(log, {
			action: "login",
			result: "denied",
			correlationId
		});
		return {
			ok: false,
			error: "csrf denied"
		};
	}
	if (!limitsReady(input?.policy)) {
		writeLog(log, {
			action: "login",
			result: "unconfigured",
			correlationId
		});
		return {
			ok: false,
			error: "rate limit is not configured"
		};
	}
	const loginId = input?.loginId;
	const ip = input?.ip;
	if (typeof loginId !== "string" || loginId.length === 0 || typeof ip !== "string" || ip.length === 0) {
		writeLog(log, {
			action: "login",
			result: "denied",
			correlationId
		});
		return {
			ok: false,
			error: "login denied"
		};
	}
	const accountAllowed = allowThrottle(store, `login:account:${digest(loginId)}`, now, input.policy.accountLimit, input.policy.windowMs);
	const ipAllowed = allowThrottle(store, `login:ip:${digest(ip)}`, now, input.policy.ipLimit, input.policy.windowMs);
	const known = store.accounts.get(loginId) ?? null;
	if (!accountAllowed || !ipAllowed) {
		writeLog(log, {
			action: "login",
			result: "throttled",
			correlationId
		});
		writeAlert(input?.alerts, {
			action: "login",
			result: "throttled",
			subjectId: known?.subjectId,
			correlationId
		});
		return {
			ok: false,
			error: "login denied"
		};
	}
	const account = findAccount(store, loginId, input?.password);
	if (!account) {
		writeLog(log, {
			action: "login",
			result: "denied",
			correlationId
		});
		return {
			ok: false,
			error: "login denied"
		};
	}
	const existing = sessionByToken(store, input?.existingToken);
	const issued = issueSession(store, account.subjectId, now, input.policy);
	if (existing && existing.revokedAt == null) existing.revokedAt = now;
	writeLog(log, {
		action: "login",
		result: "ok",
		sessionPublicId: issued.sessionPublicId,
		correlationId
	});
	return {
		ok: true,
		...issued
	};
}
function readSession(store, token, now) {
	const record = sessionByToken(store, token);
	if (!record) return {
		ok: false,
		error: "login denied"
	};
	if (record.revokedAt != null) return {
		ok: false,
		error: "session revoked",
		sessionPublicId: record.publicId
	};
	if (!finiteNow(now) || now >= record.expiresAt) return {
		ok: false,
		error: "session expired",
		sessionPublicId: record.publicId
	};
	return {
		ok: true,
		sessionPublicId: record.publicId,
		subjectId: record.subjectId,
		expiresAt: record.expiresAt,
		...tradingFlags()
	};
}
function logout(store, input) {
	const now = input?.now;
	const log = input?.log;
	const correlationId = input?.correlationId;
	const record = sessionByToken(store, input?.token);
	if (!record || !csrfMatches(record, input?.csrfToken)) {
		writeLog(log, {
			action: "logout",
			result: "denied",
			correlationId
		});
		return {
			ok: false,
			error: record ? "csrf denied" : "login denied"
		};
	}
	if (record.revokedAt == null) record.revokedAt = finiteNow(now) ? now : record.expiresAt;
	writeLog(log, {
		action: "logout",
		result: "revoked",
		sessionPublicId: record.publicId,
		correlationId
	});
	return {
		ok: true,
		clearCookie: clearSessionCookieHeader(),
		sessionPublicId: record.publicId,
		...tradingFlags()
	};
}
var ALERT_ACTIONS = /* @__PURE__ */ new Set([
	"login",
	"reset",
	"resend",
	"read"
]);
function positiveInt(value) {
	return Number.isInteger(value) && value >= 1;
}
function limitsReady(policy) {
	return Boolean(policy) && positiveInt(policy.accountLimit) && positiveInt(policy.ipLimit) && positiveInt(policy.windowMs);
}
function writeAlert(alerts, event) {
	if (!Array.isArray(alerts)) return;
	if (!ALERT_ACTIONS.has(event?.action) || event.result !== "throttled") return;
	const subjectId = typeof event.subjectId === "string" && UUID_PATTERN.test(event.subjectId) ? event.subjectId : null;
	const correlationId = typeof event.correlationId === "string" && UUID_PATTERN.test(event.correlationId) ? event.correlationId : null;
	alerts.push(Object.freeze({
		action: event.action,
		result: "throttled",
		subjectId,
		correlationId
	}));
}
function allowThrottle(store, key, now, limit, windowMs) {
	const row = store.throttle.get(key);
	if (!row || now >= row.windowStart + windowMs) {
		store.throttle.set(key, {
			windowStart: now,
			count: 1
		});
		return true;
	}
	if (row.count >= limit) return false;
	row.count += 1;
	return true;
}
var DESK_ROLE_ACCESS = Object.freeze({
	User: Object.freeze({
		title: "User",
		summary: "Research, watchlist, and paper preview only.",
		sections: Object.freeze([
			"Dashboard",
			"Market",
			"DEX",
			"Wallets",
			"Predictions",
			"Paper",
			"Search",
			"Checklist"
		]),
		denied: Object.freeze(["Bugs", "Admin"])
	}),
	Admin: Object.freeze({
		title: "Admin",
		summary: "User access, plus bug review and the release checklist.",
		sections: Object.freeze([
			"Dashboard",
			"Market",
			"DEX",
			"Wallets",
			"Predictions",
			"Paper",
			"Search",
			"Checklist",
			"Bugs",
			"Admin"
		]),
		denied: Object.freeze([])
	})
});
function isDeskRole(role) {
	return role === "User" || role === "Admin";
}
function deskSections(role) {
	if (!isDeskRole(role)) return null;
	return DESK_ROLE_ACCESS[role].sections;
}
var DESK_ACCOUNTS = Object.freeze([Object.freeze({
	loginId: "user",
	password: "user-paper-1",
	role: "User"
}), Object.freeze({
	loginId: "admin",
	password: "admin-paper-1",
	role: "Admin"
})]);
var POLICY = Object.freeze({
	ttlMs: 288e5,
	accountLimit: 30,
	ipLimit: 120,
	windowMs: 9e5
});
var deskRuntime = {
	store: createSessionStore(),
	policy: POLICY,
	log: [],
	now: () => Date.now()
};
var actors = /* @__PURE__ */ new Map();
var csrfBySubject = /* @__PURE__ */ new Map();
for (const account of DESK_ACCOUNTS) {
	const created = createAccount(deskRuntime.store, {
		loginId: account.loginId,
		password: account.password
	});
	if (!created.ok) throw new Error(created.error);
	actors.set(created.subjectId, {
		loginId: account.loginId,
		role: account.role
	});
}
function actorFor(subjectId) {
	const actor = actors.get(subjectId);
	if (!actor || !isDeskRole(actor.role)) return null;
	return actor;
}
function deskCsrf() {
	return beginLogin(deskRuntime.store, {
		now: deskRuntime.now(),
		policy: deskRuntime.policy,
		log: deskRuntime.log
	});
}
function deskLogin(input) {
	const result = login(deskRuntime.store, {
		loginId: input?.loginId,
		password: input?.password,
		csrfToken: input?.csrfToken,
		existingToken: input?.existingToken,
		ip: typeof input?.ip === "string" && input.ip.length > 0 ? input.ip : "preview",
		now: deskRuntime.now(),
		policy: deskRuntime.policy,
		log: deskRuntime.log
	});
	if (!result.ok) return result;
	const session = readSession(deskRuntime.store, result.token, deskRuntime.now());
	const actor = session.ok ? actorFor(session.subjectId) : null;
	if (!actor) return {
		ok: false,
		error: "login denied"
	};
	csrfBySubject.set(session.subjectId, result.csrfToken);
	return {
		ok: true,
		role: actor.role,
		loginId: actor.loginId,
		csrfToken: result.csrfToken,
		sessionPublicId: result.sessionPublicId,
		expiresAt: result.expiresAt,
		setCookie: result.setCookie,
		token: result.token,
		liveTrading: result.liveTrading,
		liveOrdersLocked: result.liveOrdersLocked
	};
}
function deskRead(token) {
	const result = readSession(deskRuntime.store, token, deskRuntime.now());
	if (!result.ok) return result;
	const actor = actorFor(result.subjectId);
	if (!actor) return {
		ok: false,
		error: "login denied"
	};
	return {
		ok: true,
		role: actor.role,
		loginId: actor.loginId,
		csrfToken: csrfBySubject.get(result.subjectId) ?? null,
		sessionPublicId: result.sessionPublicId,
		expiresAt: result.expiresAt,
		liveTrading: result.liveTrading,
		liveOrdersLocked: result.liveOrdersLocked
	};
}
function deskLogout(input) {
	const current = readSession(deskRuntime.store, input?.token, deskRuntime.now());
	const result = logout(deskRuntime.store, {
		token: input?.token,
		csrfToken: input?.csrfToken,
		now: deskRuntime.now(),
		log: deskRuntime.log
	});
	if (result.ok && current.ok) csrfBySubject.delete(current.subjectId);
	return result;
}
var LOGIN_FIELDS = ["loginId", "password"];
function correlationIdFrom(request) {
	return resolveCorrelationId(request.headers.get(CORRELATION_HEADER));
}
function json(body, status, correlationId, setCookie) {
	if (Number.isInteger(status) && status >= 400) recordServerFailure({
		routeViewId: "/api/desk",
		httpStatus: status,
		requestId: correlationId
	});
	const headers = {
		[CORRELATION_HEADER]: correlationId,
		"cache-control": "no-store"
	};
	if (setCookie) headers["set-cookie"] = setCookie;
	return Response.json({
		...body,
		correlationId
	}, {
		status,
		headers
	});
}
function statusFor(result) {
	if (result.ok) return 200;
	if (result.error === "unknown field") return 400;
	if (result.error === "csrf denied") return 403;
	if (result.error === "session expiry is not configured" || result.error === "rate limit is not configured") return 503;
	return 401;
}
function publicDesk(result) {
	if (!result.ok) return {
		ok: false,
		error: result.error
	};
	const body = {
		ok: true,
		role: result.role,
		loginId: result.loginId
	};
	if (typeof result.csrfToken === "string") body.csrfToken = result.csrfToken;
	if (typeof result.sessionPublicId === "string") body.sessionPublicId = result.sessionPublicId;
	if (typeof result.expiresAt === "number") body.expiresAt = result.expiresAt;
	if (typeof result.liveTrading === "string") body.liveTrading = result.liveTrading;
	if (typeof result.liveOrdersLocked === "boolean") body.liveOrdersLocked = result.liveOrdersLocked;
	return body;
}
function cookieToken(request) {
	return readCookie(request.headers.get("cookie"), SESSION_COOKIE_NAME);
}
function clientIp(request) {
	const forwarded = request.headers.get("x-forwarded-for");
	if (typeof forwarded === "string" && forwarded.split(",")[0].trim().length > 0) return forwarded.split(",")[0].trim();
	const explicit = request.headers.get(CLIENT_IP_HEADER);
	if (typeof explicit === "string" && explicit.length > 0) return explicit;
	return "preview";
}
function getDeskCsrf(request) {
	const correlationId = correlationIdFrom(request);
	const result = deskCsrf();
	return json(result.ok ? {
		ok: true,
		csrfToken: result.csrfToken
	} : {
		ok: false,
		error: result.error
	}, statusFor(result), correlationId, null);
}
async function postDeskLogin(request) {
	const correlationId = correlationIdFrom(request);
	let body;
	try {
		body = await request.json();
	} catch {
		return json({
			ok: false,
			error: "login denied"
		}, 400, correlationId, null);
	}
	if (!body || typeof body !== "object" || Array.isArray(body)) return json({
		ok: false,
		error: "login denied"
	}, 400, correlationId, null);
	for (const key of Object.keys(body)) if (!LOGIN_FIELDS.includes(key)) return json({
		ok: false,
		error: "unknown field"
	}, 400, correlationId, null);
	const result = deskLogin({
		loginId: body.loginId,
		password: body.password,
		csrfToken: request.headers.get(CSRF_HEADER),
		existingToken: cookieToken(request),
		ip: clientIp(request)
	});
	return json(publicDesk(result), statusFor(result), correlationId, result.ok ? result.setCookie : null);
}
function getDeskSession(request) {
	const correlationId = correlationIdFrom(request);
	const result = deskRead(cookieToken(request));
	if (!result.ok) return json({ ok: false }, 200, correlationId, null);
	return json(publicDesk(result), 200, correlationId, null);
}
function postDeskLogout(request) {
	const correlationId = correlationIdFrom(request);
	const result = deskLogout({
		token: cookieToken(request),
		csrfToken: request.headers.get(CSRF_HEADER)
	});
	return json(result.ok ? {
		ok: true,
		liveTrading: result.liveTrading,
		liveOrdersLocked: result.liveOrdersLocked
	} : {
		ok: false,
		error: result.error
	}, statusFor(result), correlationId, result.ok ? result.clearCookie : null);
}
var Route$5 = createFileRoute("/api/desk/csrf")({ server: { handlers: { GET: ({ request }) => getDeskCsrf(request) } } });
var Route$4 = createFileRoute("/api/desk/login")({ server: { handlers: { POST: ({ request }) => postDeskLogin(request) } } });
var Route$3 = createFileRoute("/api/desk/logout")({ server: { handlers: { POST: ({ request }) => postDeskLogout(request) } } });
var Route$2 = createFileRoute("/api/desk/session")({ server: { handlers: { GET: ({ request }) => getDeskSession(request) } } });
var Route$1 = createFileRoute("/api/dex/search")({ server: { handlers: { GET: async ({ request }) => {
	const query = new URL(request.url).searchParams.get("q")?.trim() ?? "";
	if (query.length < 2 || query.length > 100) return Response.json({
		ok: false,
		error: "Search must be between 2 and 100 characters."
	}, {
		status: 400,
		headers: { "cache-control": "no-store" }
	});
	const controller = new AbortController();
	const timeout = setTimeout(() => controller.abort(), 8e3);
	try {
		const upstream = await fetch(`https://api.dexscreener.com/latest/dex/search?q=${encodeURIComponent(query)}`, {
			headers: { accept: "application/json" },
			signal: controller.signal
		});
		if (!upstream.ok) return Response.json({
			ok: false,
			error: `DEX data source returned HTTP ${upstream.status}.`
		}, {
			status: 502,
			headers: { "cache-control": "no-store" }
		});
		const payload = await upstream.json();
		const data = (payload && typeof payload === "object" && Array.isArray(payload.pairs) ? payload.pairs : []).slice(0, 30).flatMap((item) => {
			if (!item || typeof item !== "object") return [];
			const pair = item;
			const base = pair.baseToken;
			const quote = pair.quoteToken;
			const liquidity = pair.liquidity;
			const volume = pair.volume;
			if (typeof pair.pairAddress !== "string" || typeof pair.chainId !== "string") return [];
			return [{
				chain: pair.chainId,
				dex: typeof pair.dexId === "string" ? pair.dexId : "unknown",
				pairAddress: pair.pairAddress,
				base: typeof base?.symbol === "string" ? base.symbol : "?",
				quote: typeof quote?.symbol === "string" ? quote.symbol : "?",
				priceUsd: typeof pair.priceUsd === "string" ? pair.priceUsd : null,
				liquidityUsd: typeof liquidity?.usd === "number" ? liquidity.usd : null,
				volume24hUsd: typeof volume?.h24 === "number" ? volume.h24 : null,
				url: typeof pair.url === "string" && pair.url.startsWith("https://") ? pair.url : null
			}];
		});
		return Response.json({
			ok: true,
			source: "DexScreener public search",
			observedAt: (/* @__PURE__ */ new Date()).toISOString(),
			pairs: data
		}, { headers: { "cache-control": "no-store" } });
	} catch (error) {
		const timedOut = error instanceof Error && error.name === "AbortError";
		return Response.json({
			ok: false,
			error: timedOut ? "DEX search timed out." : "DEX search is unavailable."
		}, {
			status: 502,
			headers: { "cache-control": "no-store" }
		});
	} finally {
		clearTimeout(timeout);
	}
} } } });
var explorers = {
	ethereum: "https://eth.blockscout.com",
	base: "https://base.blockscout.com"
};
var Route = createFileRoute("/api/wallets/activity")({ server: { handlers: { GET: async ({ request }) => {
	const params = new URL(request.url).searchParams;
	const chain = params.get("chain") ?? "";
	const address = params.get("address") ?? "";
	if (!(chain in explorers) || !/^0x[a-fA-F0-9]{40}$/.test(address)) return Response.json({
		ok: false,
		error: "Choose Ethereum or Base and provide a valid EVM address."
	}, {
		status: 400,
		headers: { "cache-control": "no-store" }
	});
	const controller = new AbortController();
	const timeout = setTimeout(() => controller.abort(), 8e3);
	try {
		const upstreamUrl = new URL(`/api/v2/addresses/${address}/transactions`, explorers[chain]);
		upstreamUrl.searchParams.set("filter", "to-or-from");
		const upstream = await fetch(upstreamUrl, {
			headers: { accept: "application/json" },
			signal: controller.signal
		});
		if (!upstream.ok) return Response.json({
			ok: false,
			error: `Explorer returned HTTP ${upstream.status}.`
		}, {
			status: 502,
			headers: { "cache-control": "no-store" }
		});
		const payload = await upstream.json();
		const transactions = (payload && typeof payload === "object" && Array.isArray(payload.items) ? payload.items : []).slice(0, 50).flatMap((item) => {
			if (!item || typeof item !== "object") return [];
			const tx = item;
			if (typeof tx.hash !== "string") return [];
			const from = tx.from;
			const to = tx.to;
			return [{
				hash: tx.hash,
				from: typeof from?.hash === "string" ? from.hash : null,
				to: typeof to?.hash === "string" ? to.hash : null,
				timestamp: typeof tx.timestamp === "string" ? tx.timestamp : null,
				status: typeof tx.status === "string" ? tx.status : "unknown",
				method: typeof tx.method === "string" ? tx.method : null
			}];
		});
		return Response.json({
			ok: true,
			chain,
			address,
			source: "Blockscout public address activity",
			observedAt: (/* @__PURE__ */ new Date()).toISOString(),
			transactions
		}, { headers: { "cache-control": "no-store" } });
	} catch (error) {
		const timedOut = error instanceof Error && error.name === "AbortError";
		return Response.json({
			ok: false,
			error: timedOut ? "Wallet activity request timed out." : "Explorer data is unavailable."
		}, {
			status: 502,
			headers: { "cache-control": "no-store" }
		});
	} finally {
		clearTimeout(timeout);
	}
} } } });
var rootRouteChildren = {
	IndexRoute: Route$7.update({
		id: "/",
		path: "/",
		getParentRoute: () => Route$8
	}),
	ApiViewStateRoute: Route$6.update({
		id: "/api/view-state",
		path: "/api/view-state",
		getParentRoute: () => Route$8
	}),
	ApiDeskCsrfRoute: Route$5.update({
		id: "/api/desk/csrf",
		path: "/api/desk/csrf",
		getParentRoute: () => Route$8
	}),
	ApiDeskLoginRoute: Route$4.update({
		id: "/api/desk/login",
		path: "/api/desk/login",
		getParentRoute: () => Route$8
	}),
	ApiDeskLogoutRoute: Route$3.update({
		id: "/api/desk/logout",
		path: "/api/desk/logout",
		getParentRoute: () => Route$8
	}),
	ApiDeskSessionRoute: Route$2.update({
		id: "/api/desk/session",
		path: "/api/desk/session",
		getParentRoute: () => Route$8
	}),
	ApiDexSearchRoute: Route$1.update({
		id: "/api/dex/search",
		path: "/api/dex/search",
		getParentRoute: () => Route$8
	}),
	ApiWalletsActivityRoute: Route.update({
		id: "/api/wallets/activity",
		path: "/api/wallets/activity",
		getParentRoute: () => Route$8
	})
};
var routeTree = Route$8._addFileChildren(rootRouteChildren)._addFileTypes();
var router_exports = /* @__PURE__ */ __exportAll({ getRouter: () => getRouter });
function getRouter() {
	return createRouter({
		routeTree,
		defaultErrorComponent: AppErrorComponent
	});
}
//#endregion
export { recordPageHealth as a, diagnosticEvent as c, initialClientViewState as d, parseUserVisibleStatus as f, isDeskRole as i, resolveCorrelationId as l, setPageIndex as m, DESK_ROLE_ACCESS as n, CORRELATION_HEADER as o, selectSection as p, deskSections as r, SECTION_HEADER as s, router_exports as t, SHELL_SECTIONS as u };
