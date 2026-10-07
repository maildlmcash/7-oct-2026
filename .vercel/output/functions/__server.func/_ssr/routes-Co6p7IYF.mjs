import { i as __toESM } from "../_runtime.mjs";
import { K as require_react, b as require_jsx_runtime } from "../_libs/@tanstack/react-router+[...].mjs";
import { a as recordPageHealth, c as diagnosticEvent, d as initialClientViewState, f as parseUserVisibleStatus, i as isDeskRole, l as resolveCorrelationId, m as setPageIndex, n as DESK_ROLE_ACCESS, o as CORRELATION_HEADER, p as selectSection, r as deskSections, s as SECTION_HEADER, u as SHELL_SECTIONS } from "./router-N7GIrcEW.mjs";
//#region node_modules/.nitro/vite/services/ssr/assets/routes-Co6p7IYF.js
var import_react = /* @__PURE__ */ __toESM(require_react());
var import_jsx_runtime = require_jsx_runtime();
var CHECKLIST_STATUSES = Object.freeze([
	"NOT_STARTED",
	"IN_PROGRESS",
	"PASS",
	"FAIL",
	"BLOCKED",
	"NOT_APPLICABLE"
]);
new Set(CHECKLIST_STATUSES);
var STATUS_VIEW_COUNTS = Object.freeze([
	"PASS",
	"FAIL",
	"BLOCKED",
	"STALE"
]);
var ADMIN_EDIT_ROLE = "Admin";
function sameTenant(actor, tenantId) {
	return Boolean(actor) && actor.tenantId === tenantId;
}
function canEditChecklist(actor, tenantId) {
	return sameTenant(actor, tenantId) && actor.role === ADMIN_EDIT_ROLE;
}
function emptyCounts() {
	return {
		PASS: 0,
		FAIL: 0,
		BLOCKED: 0,
		STALE: 0
	};
}
function emptyChecklistStatusView() {
	return {
		state: "empty",
		canEdit: false,
		counts: emptyCounts(),
		unresolvedPrerequisites: [],
		owners: [],
		evidenceLinks: [],
		error: null
	};
}
function escapeHtml(value) {
	return String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll("\"", "&quot;");
}
function renderChecklistStatusView(view) {
	if (view.state === "loading") return "<section data-checklist-status-view=\"loading\"><p>checklist status loading</p></section>";
	if (view.state === "error") return `<section data-checklist-status-view="error"><p>checklist status error</p><p>${escapeHtml(view.error)}</p></section>`;
	const counts = STATUS_VIEW_COUNTS.map((status) => `<span data-count-${status.toLowerCase()}>${status} ${view.counts[status]}</span>`).join("");
	const unresolved = view.unresolvedPrerequisites.length === 0 ? "<p>unresolved prerequisites none</p>" : `<ul data-unresolved-prerequisites>${view.unresolvedPrerequisites.map((item) => `<li>${escapeHtml(item.prerequisiteId)} ${escapeHtml(item.status)} ${escapeHtml(item.owner)}</li>`).join("")}</ul>`;
	const owners = view.owners.length === 0 ? "<p>owners none</p>" : `<ul data-owners>${view.owners.map((item) => `<li>${escapeHtml(item.recordId)} ${escapeHtml(item.owner)}</li>`).join("")}</ul>`;
	const links = view.evidenceLinks.length === 0 ? "<p>evidence links none</p>" : `<ul data-evidence-links>${view.evidenceLinks.map((item) => `<li><a href="${escapeHtml(item.url)}">${escapeHtml(item.url)}</a></li>`).join("")}</ul>`;
	const edit = view.state === "ready" && view.canEdit ? "<button type=\"button\">Edit checklist</button>" : "";
	const label = view.state === "empty" ? "<p>checklist status empty</p>" : "<p>checklist status ready</p>";
	return `<section data-checklist-status-view="${view.state}">${label}${counts}${unresolved}${owners}${links}${edit}</section>`;
}
Object.freeze([
	"Super Admin",
	"Admin",
	"Super Distributor",
	"Distributor",
	"Retailer",
	"Customer"
]);
var NO_GRANTS = Object.freeze([]);
Object.freeze({
	"Super Admin": NO_GRANTS,
	Admin: NO_GRANTS,
	"Super Distributor": NO_GRANTS,
	Distributor: NO_GRANTS,
	Retailer: NO_GRANTS,
	Customer: NO_GRANTS
});
function sameCustomer(actor, tenantId) {
	return Boolean(actor) && actor.role === "Customer" && actor.tenantId === tenantId;
}
function authorizeShell(actor, tenantId) {
	return {
		editChecklist: canEditChecklist(actor, tenantId),
		userChecklist: sameCustomer(actor, tenantId),
		market: sameCustomer(actor, tenantId)
	};
}
function renderSectionCapability(capabilities, section, checklistMarkup = "") {
	if (section === "Admin" && capabilities?.editChecklist === true) return "<section data-view=\"admin-controls\"><button type=\"button\">Edit checklist</button></section>";
	if (section === "Checklist" && capabilities?.userChecklist === true) return `<section data-view="user-checklist">${checklistMarkup}</section>`;
	if (section === "Market" && capabilities?.market === true) return "<section data-view=\"market\"><p>market view</p></section>";
	if (section === "Checklist") return checklistMarkup;
	return "";
}
function SectionNav({ label, items, onSelect }) {
	return /* @__PURE__ */ (0, import_jsx_runtime.jsx)("nav", {
		className: "layout-nav",
		"aria-label": label,
		children: items.map((item) => /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", {
			type: "button",
			"aria-pressed": item.pressed,
			onClick: () => onSelect(item.id),
			children: item.label
		}, item.id))
	});
}
function Heading({ id, children }) {
	return /* @__PURE__ */ (0, import_jsx_runtime.jsx)("h1", {
		id,
		className: "layout-heading",
		children
	});
}
function Panel({ labelledBy, children }) {
	return /* @__PURE__ */ (0, import_jsx_runtime.jsx)("section", {
		className: "layout-panel",
		"aria-labelledby": labelledBy,
		children
	});
}
function ErrorState({ children }) {
	return /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
		className: "layout-state",
		role: "alert",
		children
	});
}
function LanguageChoice({ label, options, value, onChange }) {
	const labelId = (0, import_react.useId)();
	return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
		className: "layout-language",
		role: "group",
		"aria-labelledby": labelId,
		children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", {
			id: labelId,
			children: label
		}), options.map((option) => /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", {
			type: "button",
			"aria-pressed": option.id === value,
			onClick: () => onChange(option.id),
			children: option.label
		}, option.id))]
	});
}
function LanguageSample({ label, lang, dir, parts }) {
	return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
		className: "layout-sample-block",
		children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", {
			className: "layout-sample-label",
			children: label
		}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
			className: "layout-sample",
			lang,
			dir,
			"data-language-sample": "",
			children: parts.map((part, index) => /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", {
				"data-sample-part": index === 0 ? "first" : "second",
				children: part
			}, `${index}-${part}`))
		})]
	});
}
var UNSIGNED = /^(?:0|[1-9]\d*)(?:\.\d+)?$/;
var DIGITS = /^(?:0|[1-9]\d*)$/;
var MODEL_HEALTH_VIEWS = Object.freeze([
	"calibration",
	"brier/log-loss",
	"drift",
	"feature freshness",
	"feed gaps",
	"model/data version"
]);
var CALIBRATION_KEYS = Object.freeze([
	"view",
	"observations",
	"edges",
	"minimumSampleSize"
]);
var HISTORY_KEYS = Object.freeze([
	"view",
	"bound",
	"from",
	"to",
	"points",
	"stale",
	"quality",
	"minimumSampleSize"
]);
var FRESHNESS_KEYS = Object.freeze([
	"view",
	"features",
	"minimumSampleSize"
]);
var GAP_KEYS = Object.freeze([
	"view",
	"gaps",
	"minimumSampleSize"
]);
var VERSION_KEYS = Object.freeze([
	"view",
	"modelVersion",
	"dataVersion",
	"featureVersion",
	"from",
	"to",
	"sampleSize",
	"minimumSampleSize"
]);
var OBSERVATION_KEYS = Object.freeze([
	"eventTime",
	"probability",
	"outcome"
]);
var BRIER_KEYS = Object.freeze([
	"eventTime",
	"brier",
	"logLoss"
]);
var DRIFT_KEYS = Object.freeze(["eventTime", "value"]);
var FEATURE_KEYS = Object.freeze([
	"name",
	"watermark",
	"observedAt",
	"threshold"
]);
var GAP_RECORD_KEYS = Object.freeze([
	"from",
	"to",
	"reason"
]);
var QUALITY_KEYS = Object.freeze(["healthy", "reason"]);
Object.freeze(["width"]);
var MODEL_HEALTH_LAYOUT = Object.freeze({
	columns: 1,
	stack: "column",
	maxWidth: "100%",
	wrap: true
});
function fail(error) {
	return Object.freeze({
		ok: false,
		blocked: "BLOCKED",
		error,
		direction: null,
		guaranteesDirection: false,
		status: "insufficient",
		sampleSize: null,
		observedWindow: null,
		bins: Object.freeze([]),
		points: Object.freeze([])
	});
}
function plainObject(value) {
	return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
function unknownKey(value, allowed) {
	for (const key of Object.keys(value)) if (!allowed.includes(key)) return true;
	return false;
}
function filled(value) {
	return typeof value === "string" && value.length > 0 && value === value.trim();
}
function positive(value) {
	return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}
function eventTimeValue(value) {
	if (typeof value === "number") return Number.isSafeInteger(value) && value >= 0;
	return typeof value === "string" && DIGITS.test(value);
}
function timeDigits(value) {
	return typeof value === "number" ? String(value) : value;
}
function compareTime(left, right) {
	const a = timeDigits(left);
	const b = timeDigits(right);
	if (a.length !== b.length) return a.length < b.length ? -1 : 1;
	if (a === b) return 0;
	return a < b ? -1 : 1;
}
function decimal(value) {
	return typeof value === "string" && UNSIGNED.test(value);
}
function parseDecimal(value) {
	if (!decimal(value)) return null;
	const [whole, frac = ""] = value.split(".");
	const digits = `${whole}${frac}`.replace(/^0+(?=\d)/, "");
	return {
		n: BigInt(digits),
		scale: frac.length
	};
}
function format(n, scale) {
	let digits = n.toString();
	if (scale > 0) {
		if (digits.length <= scale) digits = digits.padStart(scale + 1, "0");
		const cut = digits.length - scale;
		const frac = digits.slice(cut).replace(/0+$/, "");
		digits = frac.length > 0 ? `${digits.slice(0, cut)}.${frac}` : digits.slice(0, cut);
	}
	return digits === "0" ? "0" : digits;
}
function gcd(left, right) {
	let a = left < 0n ? -left : left;
	let b = right < 0n ? -right : right;
	while (b !== 0n) {
		const next = a % b;
		a = b;
		b = next;
	}
	return a;
}
function ratio(numerator, denominator) {
	if (denominator === 0n) return null;
	let num = numerator < 0n ? -numerator : numerator;
	let den = denominator < 0n ? -denominator : denominator;
	const divisor = gcd(num, den);
	num /= divisor;
	den /= divisor;
	let rest = den;
	let twos = 0n;
	let fives = 0n;
	while (rest % 2n === 0n) {
		rest /= 2n;
		twos += 1n;
	}
	while (rest % 5n === 0n) {
		rest /= 5n;
		fives += 1n;
	}
	if (rest !== 1n) return `${num.toString()}/${den.toString()}`;
	const scale = twos > fives ? twos : fives;
	return format(num * 2n ** (scale - twos) * 5n ** (scale - fives), Number(scale));
}
function compareDecimal(left, right) {
	const a = parseDecimal(left);
	const b = parseDecimal(right);
	if (!a || !b) return null;
	const scale = Math.max(a.scale, b.scale);
	const av = a.n * 10n ** BigInt(scale - a.scale);
	const bv = b.n * 10n ** BigInt(scale - b.scale);
	if (av < bv) return -1;
	if (av > bv) return 1;
	return 0;
}
function probability(value) {
	const parsed = parseDecimal(value);
	if (!parsed) return false;
	return parsed.n <= 10n ** BigInt(parsed.scale);
}
function minimumOf(value) {
	if (value === void 0 || value === null) return {
		ok: true,
		configured: false,
		value: null
	};
	if (!positive(value)) return { ok: false };
	return {
		ok: true,
		configured: true,
		value
	};
}
function qualityState(value) {
	if (value === void 0 || value === null) return {
		ok: true,
		stale: false,
		quality: null
	};
	if (value === "degraded") return {
		ok: true,
		stale: true,
		quality: Object.freeze({
			healthy: false,
			reason: "degraded"
		})
	};
	if (!plainObject(value) || unknownKey(value, QUALITY_KEYS)) return { ok: false };
	if (typeof value.healthy !== "boolean") return { ok: false };
	if (value.reason !== null && !filled(value.reason)) return { ok: false };
	return {
		ok: true,
		stale: value.healthy !== true || value.reason !== null,
		quality: Object.freeze({
			healthy: value.healthy,
			reason: value.reason
		})
	};
}
function windowOf(times) {
	if (times.length === 0) return null;
	let from = times[0];
	let to = times[0];
	for (const time of times) {
		if (compareTime(time, from) < 0) from = time;
		if (compareTime(time, to) > 0) to = time;
	}
	return Object.freeze({
		from,
		to
	});
}
function result(fields) {
	return Object.freeze({
		ok: true,
		blocked: null,
		error: null,
		view: fields.view,
		direction: null,
		guaranteesDirection: false,
		status: fields.status,
		note: fields.note ?? null,
		formula: fields.formula ?? null,
		sampleSize: fields.sampleSize ?? null,
		minimumSampleSize: fields.minimumSampleSize ?? null,
		observedWindow: fields.observedWindow ?? null,
		truncated: fields.truncated === true,
		bins: Object.freeze((fields.bins ?? []).map((bin) => Object.freeze(bin))),
		points: Object.freeze((fields.points ?? []).map((point) => Object.freeze(point))),
		records: Object.freeze((fields.records ?? []).map((record) => Object.freeze(record))),
		modelVersion: fields.modelVersion ?? null,
		dataVersion: fields.dataVersion ?? null,
		featureVersion: fields.featureVersion ?? null,
		palette: null,
		layout: MODEL_HEALTH_LAYOUT,
		quality: fields.quality ?? null
	});
}
function chartStatus(sampleSize, minimum, rowsInsufficient) {
	if (!minimum.configured || sampleSize === null || sampleSize < minimum.value || rowsInsufficient) return "insufficient";
	return "sufficient";
}
function meanOf(values) {
	if (values.length === 0) return null;
	let scale = 0;
	let n = 0n;
	for (const value of values) {
		const parsed = parseDecimal(value);
		const next = Math.max(scale, parsed.scale);
		n = n * 10n ** BigInt(next - scale) + parsed.n * 10n ** BigInt(next - parsed.scale);
		scale = next;
	}
	return ratio(n, BigInt(values.length) * 10n ** BigInt(scale));
}
function edgesOf(edges) {
	if (edges === void 0 || edges === null) return {
		ok: true,
		configured: false,
		edges: null
	};
	if (!Array.isArray(edges) || edges.length < 2) return { ok: false };
	for (let index = 0; index < edges.length; index += 1) {
		if (!probability(edges[index])) return { ok: false };
		if (index > 0 && compareDecimal(edges[index - 1], edges[index]) >= 0) return { ok: false };
	}
	if (compareDecimal(edges[0], "0") !== 0 || compareDecimal(edges[edges.length - 1], "1") !== 0) return { ok: false };
	return {
		ok: true,
		configured: true,
		edges
	};
}
function observationsOf(observations) {
	if (observations === void 0) return {
		ok: true,
		rows: []
	};
	if (!Array.isArray(observations)) return { ok: false };
	const rows = [];
	for (const row of observations) {
		if (!plainObject(row) || unknownKey(row, OBSERVATION_KEYS)) return { ok: false };
		if (!eventTimeValue(row.eventTime) || !probability(row.probability)) return { ok: false };
		if (row.outcome !== "0" && row.outcome !== "1") return { ok: false };
		rows.push(row);
	}
	return {
		ok: true,
		rows
	};
}
function binFor(probabilityValue, edges) {
	const last = edges.length - 2;
	for (let index = 0; index < last; index += 1) if (compareDecimal(probabilityValue, edges[index]) >= 0 && compareDecimal(probabilityValue, edges[index + 1]) < 0) return index;
	if (compareDecimal(probabilityValue, edges[last]) >= 0 && compareDecimal(probabilityValue, edges[last + 1]) <= 0) return last;
	return -1;
}
function calibration(input, minimum) {
	const observations = observationsOf(input.observations);
	if (!observations.ok) return fail("unsupported field");
	const edges = edgesOf(input.edges);
	if (!edges.ok) return fail("unsupported field");
	const observedWindow = windowOf(observations.rows.map((row) => row.eventTime));
	if (!edges.configured) return result({
		view: input.view,
		status: "insufficient",
		note: "bins are not configured",
		formula: "predicted probability buckets vs observed outcome",
		sampleSize: observations.rows.length,
		minimumSampleSize: minimum.value,
		observedWindow
	});
	const groups = edges.edges.slice(0, -1).map(() => []);
	for (const row of observations.rows) {
		const index = binFor(row.probability, edges.edges);
		if (index < 0) return fail("unsupported field");
		groups[index].push(row);
	}
	let rowsInsufficient = !minimum.configured || observations.rows.length < (minimum.value ?? 0);
	const bins = groups.map((group, index) => {
		const count = group.length;
		const lowSample = !minimum.configured || count < minimum.value;
		if (lowSample) rowsInsufficient = true;
		const outcomeCount = group.reduce((sum, row) => sum + (row.outcome === "1" ? 1 : 0), 0);
		return {
			low: edges.edges[index],
			high: edges.edges[index + 1],
			count,
			outcomeCount: lowSample ? null : outcomeCount,
			meanPredicted: lowSample ? null : meanOf(group.map((row) => row.probability)),
			observedRate: lowSample ? null : ratio(BigInt(outcomeCount), BigInt(count)),
			status: lowSample ? "insufficient" : "sufficient"
		};
	});
	return result({
		view: input.view,
		status: rowsInsufficient ? "insufficient" : "sufficient",
		note: minimum.configured ? null : "sample size is not configured",
		formula: "predicted probability buckets vs observed outcome",
		sampleSize: observations.rows.length,
		minimumSampleSize: minimum.value,
		observedWindow,
		bins
	});
}
function optionalDecimal(value) {
	if (value === void 0 || value === null) return {
		ok: true,
		value: null
	};
	if (!decimal(value)) return { ok: false };
	return {
		ok: true,
		value
	};
}
function historyPoints(view, points) {
	if (points === void 0) return {
		ok: true,
		rows: []
	};
	if (!Array.isArray(points)) return { ok: false };
	const rows = [];
	for (const point of points) {
		const keys = view === "drift" ? DRIFT_KEYS : BRIER_KEYS;
		if (!plainObject(point) || unknownKey(point, keys) || !eventTimeValue(point.eventTime)) return { ok: false };
		if (view === "drift") {
			const value = optionalDecimal(point.value);
			if (!value.ok) return { ok: false };
			rows.push({
				eventTime: point.eventTime,
				value: value.value
			});
		} else {
			const brier = optionalDecimal(point.brier);
			const logLoss = optionalDecimal(point.logLoss);
			if (!brier.ok || !logLoss.ok) return { ok: false };
			rows.push({
				eventTime: point.eventTime,
				brier: brier.value,
				logLoss: logLoss.value
			});
		}
	}
	return {
		ok: true,
		rows
	};
}
function history(input, minimum) {
	if (!positive(input.bound)) return fail("bound is required");
	if (input.stale !== void 0 && typeof input.stale !== "boolean") return fail("unsupported field");
	const quality = qualityState(input.quality);
	if (!quality.ok) return fail("unsupported field");
	const hasFrom = input.from !== void 0 && input.from !== null;
	if (hasFrom !== (input.to !== void 0 && input.to !== null)) return fail("unsupported field");
	if (hasFrom && (!eventTimeValue(input.from) || !eventTimeValue(input.to))) return fail("unsupported field");
	if (hasFrom && compareTime(input.from, input.to) > 0) return fail("unsupported field");
	const parsed = historyPoints(input.view, input.points);
	if (!parsed.ok) return fail("unsupported field");
	if (input.stale === true || quality.stale) {
		const reason = quality.quality && quality.quality.reason ? quality.quality.reason : "stale stream";
		return result({
			view: input.view,
			status: "insufficient",
			formula: "NOT IN SOURCE",
			sampleSize: 0,
			minimumSampleSize: minimum.value,
			note: minimum.configured ? null : "sample size is not configured",
			quality: Object.freeze({
				healthy: false,
				reason
			})
		});
	}
	const included = hasFrom ? parsed.rows.filter((row) => compareTime(row.eventTime, input.from) >= 0 && compareTime(row.eventTime, input.to) <= 0) : parsed.rows;
	const ordered = included.map((row, index) => ({
		row,
		index
	})).sort((left, right) => {
		const order = compareTime(left.row.eventTime, right.row.eventTime);
		return order === 0 ? left.index - right.index : order;
	});
	const plotted = ordered.slice(0, input.bound).map((item) => item.row);
	const sampleSize = included.length;
	return result({
		view: input.view,
		status: chartStatus(sampleSize, minimum, false),
		formula: "NOT IN SOURCE",
		sampleSize,
		minimumSampleSize: minimum.value,
		observedWindow: windowOf(included.map((row) => row.eventTime)),
		truncated: ordered.length > input.bound,
		points: plotted,
		note: minimum.configured ? null : "sample size is not configured"
	});
}
function ageBetween(later, earlier) {
	return BigInt(timeDigits(later)) - BigInt(timeDigits(earlier));
}
function freshness(input, minimum) {
	if (input.features === void 0) return result({
		view: input.view,
		status: "insufficient",
		note: "feature freshness is not measured",
		sampleSize: 0,
		minimumSampleSize: minimum.value
	});
	if (!Array.isArray(input.features)) return fail("unsupported field");
	const records = [];
	for (const feature of input.features) {
		if (!plainObject(feature) || unknownKey(feature, FEATURE_KEYS) || !filled(feature.name)) return fail("unsupported field");
		if (!eventTimeValue(feature.watermark) || !eventTimeValue(feature.observedAt)) return fail("unsupported field");
		if (feature.threshold !== void 0 && feature.threshold !== null && !eventTimeValue(feature.threshold)) return fail("unsupported field");
		const age = ageBetween(feature.observedAt, feature.watermark);
		const thresholdMissing = feature.threshold === void 0 || feature.threshold === null;
		let status = "insufficient";
		if (!thresholdMissing) {
			const limit = BigInt(timeDigits(feature.threshold));
			status = age < 0n || age > limit ? "stale" : "recorded";
		}
		records.push({
			name: feature.name,
			watermark: feature.watermark,
			observedAt: feature.observedAt,
			age: age.toString(),
			threshold: thresholdMissing ? null : feature.threshold,
			status
		});
	}
	const low = !minimum.configured || records.length < minimum.value || records.some((record) => record.status !== "recorded");
	return result({
		view: input.view,
		status: low ? "insufficient" : "sufficient",
		note: records.some((record) => record.threshold === null) ? "freshness threshold is not configured" : null,
		sampleSize: records.length,
		minimumSampleSize: minimum.value,
		observedWindow: windowOf(records.map((record) => record.observedAt)),
		records
	});
}
function gaps(input, minimum) {
	if (input.gaps === void 0) return result({
		view: input.view,
		status: "insufficient",
		note: "feed gaps are not measured",
		sampleSize: 0,
		minimumSampleSize: minimum.value
	});
	if (!Array.isArray(input.gaps)) return fail("unsupported field");
	const records = [];
	for (const gap of input.gaps) {
		if (!plainObject(gap) || unknownKey(gap, GAP_RECORD_KEYS)) return fail("unsupported field");
		if (!eventTimeValue(gap.from) || !eventTimeValue(gap.to) || !filled(gap.reason)) return fail("unsupported field");
		if (compareTime(gap.from, gap.to) > 0) return fail("unsupported field");
		records.push({
			from: gap.from,
			to: gap.to,
			reason: gap.reason
		});
	}
	return result({
		view: input.view,
		status: chartStatus(records.length, minimum, records.length === 0),
		note: records.length === 0 ? "gap records are empty" : minimum.configured ? null : "sample size is not configured",
		sampleSize: records.length,
		minimumSampleSize: minimum.value,
		observedWindow: records.length === 0 ? null : windowOf(records.flatMap((record) => [record.from, record.to])),
		records
	});
}
function versions(input, minimum) {
	if (input.modelVersion !== void 0 && !filled(input.modelVersion)) return fail("unsupported field");
	if (input.dataVersion !== void 0 && !filled(input.dataVersion)) return fail("unsupported field");
	if (input.featureVersion !== void 0 && input.featureVersion !== null && !filled(input.featureVersion)) return fail("unsupported field");
	const hasFrom = input.from !== void 0 && input.from !== null;
	if (hasFrom !== (input.to !== void 0 && input.to !== null)) return fail("unsupported field");
	if (hasFrom && (!eventTimeValue(input.from) || !eventTimeValue(input.to) || compareTime(input.from, input.to) > 0)) return fail("unsupported field");
	if (input.sampleSize !== void 0 && input.sampleSize !== null) {
		if (typeof input.sampleSize !== "number" || !Number.isSafeInteger(input.sampleSize) || input.sampleSize < 0) return fail("unsupported field");
	}
	const modelVersion = filled(input.modelVersion) ? input.modelVersion : null;
	const dataVersion = filled(input.dataVersion) ? input.dataVersion : null;
	let note = null;
	if (!modelVersion) note = "model version is not configured";
	else if (!dataVersion) note = "data version is not configured";
	else if (!minimum.configured || input.sampleSize === void 0 || input.sampleSize === null) note = "sample size is not configured";
	const sampleSize = typeof input.sampleSize === "number" ? input.sampleSize : null;
	const low = note !== null || sampleSize === null || !minimum.configured || sampleSize < minimum.value;
	return result({
		view: input.view,
		status: low ? "insufficient" : "sufficient",
		note,
		sampleSize,
		minimumSampleSize: minimum.value,
		observedWindow: hasFrom ? Object.freeze({
			from: input.from,
			to: input.to
		}) : null,
		modelVersion,
		dataVersion,
		featureVersion: filled(input.featureVersion) ? input.featureVersion : null
	});
}
function readModelHealthChart(input) {
	if (!plainObject(input) || input.view === void 0 || input.view === null || input.view === "") return fail(input && plainObject(input) && input.view !== void 0 ? "unsupported field" : "view is required");
	if (!MODEL_HEALTH_VIEWS.includes(input.view)) return fail("unsupported field");
	if (unknownKey(input, input.view === "calibration" ? CALIBRATION_KEYS : input.view === "feature freshness" ? FRESHNESS_KEYS : input.view === "feed gaps" ? GAP_KEYS : input.view === "model/data version" ? VERSION_KEYS : HISTORY_KEYS)) return fail("unsupported field");
	const minimum = minimumOf(input.minimumSampleSize);
	if (!minimum.ok) return fail("unsupported field");
	if (input.view === "calibration") return calibration(input, minimum);
	if (input.view === "feature freshness") return freshness(input, minimum);
	if (input.view === "feed gaps") return gaps(input, minimum);
	if (input.view === "model/data version") return versions(input, minimum);
	return history(input, minimum);
}
function cell(value) {
	return value == null ? "" : String(value);
}
function loadChart(view, bound) {
	if (view === "brier/log-loss" || view === "drift") return readModelHealthChart({
		view,
		bound
	});
	return readModelHealthChart({ view });
}
function ModelHealthCharts({ bound }) {
	const [view, setView] = (0, import_react.useState)(null);
	const layout = MODEL_HEALTH_LAYOUT;
	const loaded = view ? loadChart(view, bound) : null;
	return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
		className: "layout-charts",
		"data-loaded": loaded ? "true" : "false",
		"data-columns": layout.columns,
		"data-stack": layout.stack,
		"data-view": loaded ? loaded.view : void 0,
		"data-guarantees-direction": loaded ? "false" : void 0,
		children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
			className: "layout-chart-controls",
			role: "group",
			"aria-label": "Model health series",
			children: MODEL_HEALTH_VIEWS.map((name) => /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", {
				type: "button",
				"aria-pressed": view === name,
				onClick: () => setView(name),
				children: name
			}, name))
		}), loaded ? /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
			className: "layout-chart",
			children: [
				/* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { children: loaded.sampleSize == null ? "Sample size is not configured" : `Sample size ${loaded.sampleSize}` }),
				/* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { children: loaded.observedWindow ? `Observed window ${loaded.observedWindow.from} to ${loaded.observedWindow.to}` : "observed window is not set" }),
				loaded.status === "insufficient" ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { children: "insufficient" }) : null,
				loaded.formula ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { children: loaded.formula }) : null,
				loaded.note ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { children: loaded.note }) : null,
				loaded.modelVersion ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { children: `Model version ${loaded.modelVersion}` }) : null,
				loaded.dataVersion ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { children: `Data version ${loaded.dataVersion}` }) : null,
				loaded.featureVersion ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { children: `Feature version ${loaded.featureVersion}` }) : null,
				/* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { children: "This chart does not guarantee a direction." }),
				loaded.bins.length > 0 ? /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("table", { children: [
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)("caption", { children: "predicted probability buckets vs observed outcome" }),
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)("thead", { children: /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("tr", { children: [
						/* @__PURE__ */ (0, import_jsx_runtime.jsx)("th", {
							scope: "col",
							children: "low"
						}),
						/* @__PURE__ */ (0, import_jsx_runtime.jsx)("th", {
							scope: "col",
							children: "high"
						}),
						/* @__PURE__ */ (0, import_jsx_runtime.jsx)("th", {
							scope: "col",
							children: "count"
						}),
						/* @__PURE__ */ (0, import_jsx_runtime.jsx)("th", {
							scope: "col",
							children: "status"
						}),
						/* @__PURE__ */ (0, import_jsx_runtime.jsx)("th", {
							scope: "col",
							children: "observed rate"
						})
					] }) }),
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)("tbody", { children: loaded.bins.map((bin) => /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("tr", { children: [
						/* @__PURE__ */ (0, import_jsx_runtime.jsx)("td", { children: bin.low }),
						/* @__PURE__ */ (0, import_jsx_runtime.jsx)("td", { children: bin.high }),
						/* @__PURE__ */ (0, import_jsx_runtime.jsx)("td", { children: bin.count }),
						/* @__PURE__ */ (0, import_jsx_runtime.jsx)("td", { children: bin.status === "insufficient" ? "insufficient" : "" }),
						/* @__PURE__ */ (0, import_jsx_runtime.jsx)("td", { children: cell(bin.observedRate) })
					] }, `${bin.low}-${bin.high}`)) })
				] }) : null,
				loaded.points.length > 0 ? /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("table", { children: [
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)("caption", { children: "source value" }),
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)("thead", { children: /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("tr", { children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("th", {
						scope: "col",
						children: "event time"
					}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("th", {
						scope: "col",
						children: "value"
					})] }) }),
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)("tbody", { children: loaded.points.map((point, index) => /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("tr", { children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("td", { children: cell(point.eventTime) }), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("td", { children: cell(point.brier ?? point.value) })] }, `${cell(point.eventTime)}-${index}`)) })
				] }) : null,
				loaded.records.length > 0 ? /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("table", { children: [
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)("caption", { children: "model health records" }),
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)("thead", { children: /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("tr", { children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("th", {
						scope: "col",
						children: "record"
					}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("th", {
						scope: "col",
						children: "status"
					})] }) }),
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)("tbody", { children: loaded.records.map((record, index) => /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("tr", { children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("td", { children: cell(record.name ?? record.reason) }), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("td", { children: cell(record.status ?? record.reason) })] }, `${cell(record.name ?? record.reason)}-${index}`)) })
				] }) : null
			]
		}) : null]
	});
}
function rememberDiagnostic(event) {
	if (typeof window === "undefined") return;
	const target = window;
	const events = target.__shellDiagnostics ?? [];
	events.push(event);
	target.__shellDiagnostics = events;
}
function rememberPageHealth(input) {
	const event = recordPageHealth({
		routeViewId: input.routeViewId,
		viewId: input.viewId,
		httpStatus: input.httpStatus,
		exception: input.exception === true ? true : null,
		requestId: input.requestId,
		environment: input.environment
	});
	if (typeof window === "undefined") return;
	const target = window;
	const events = target.__pageHealthEvents ?? [];
	events.push(event);
	target.__pageHealthEvents = events;
}
function InjectedSectionFailure({ section }) {
	if (typeof window !== "undefined" && window.__injectSectionError === section) throw new Error("injected section render failure");
	return null;
}
var SectionErrorBoundary = class extends import_react.Component {
	constructor(..._args) {
		super(..._args);
		this.state = { correlationId: null };
		this.recorded = null;
	}
	static getDerivedStateFromError() {
		return { correlationId: crypto.randomUUID() };
	}
	componentDidMount() {
		this.record();
	}
	componentDidUpdate() {
		this.record();
	}
	record() {
		const correlationId = this.state.correlationId;
		if (!correlationId || this.recorded === correlationId) return;
		this.recorded = correlationId;
		rememberDiagnostic(diagnosticEvent({
			correlationId,
			section: this.props.section,
			route: "section-render",
			httpStatus: null
		}));
		rememberPageHealth({
			routeViewId: "section-render",
			viewId: this.props.section,
			httpStatus: null,
			exception: true,
			requestId: correlationId,
			environment: this.props.environment
		});
	}
	render() {
		if (this.state.correlationId) return /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
			"data-correlation-id": this.state.correlationId,
			children: /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(ErrorState, { children: ["Section render failed ", this.state.correlationId] })
		});
		return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(import_jsx_runtime.Fragment, { children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)(InjectedSectionFailure, { section: this.props.section }), this.props.children] });
	}
};
function SectionRequest({ section, pageSize, environment = null, children }) {
	const [failure, setFailure] = (0, import_react.useState)(null);
	(0, import_react.useEffect)(() => {
		const clientId = crypto.randomUUID();
		const controller = new AbortController();
		let active = true;
		async function load() {
			try {
				const response = await fetch(`/api/view-state?pageSize=${pageSize}`, {
					cache: "no-store",
					headers: {
						[CORRELATION_HEADER]: clientId,
						[SECTION_HEADER]: section
					},
					signal: controller.signal
				});
				if (!active) return;
				const correlationId = resolveCorrelationId(response.headers.get("x-correlation-id") ?? clientId);
				if (!response.ok) {
					const event = diagnosticEvent({
						correlationId,
						section,
						route: "/api/view-state",
						httpStatus: response.status
					});
					rememberDiagnostic(event);
					rememberPageHealth({
						routeViewId: "/api/view-state",
						viewId: section,
						httpStatus: response.status,
						requestId: correlationId,
						environment
					});
					setFailure(event);
					return;
				}
				let ok = false;
				try {
					const body = await response.json();
					ok = Boolean(body) && typeof body === "object" && body.ok === true;
				} catch {
					ok = false;
				}
				if (!active) return;
				if (!ok) {
					const event = diagnosticEvent({
						correlationId,
						section,
						route: "/api/view-state",
						httpStatus: response.status
					});
					rememberDiagnostic(event);
					setFailure(event);
					return;
				}
				setFailure(null);
			} catch {
				if (!active || controller.signal.aborted) return;
				const event = diagnosticEvent({
					correlationId: clientId,
					section,
					route: "/api/view-state",
					httpStatus: null
				});
				rememberDiagnostic(event);
				rememberPageHealth({
					routeViewId: "/api/view-state",
					viewId: section,
					httpStatus: null,
					exception: true,
					requestId: clientId,
					environment
				});
				setFailure(event);
			}
		}
		setFailure(null);
		load();
		return () => {
			active = false;
			controller.abort();
		};
	}, [
		environment,
		pageSize,
		section
	]);
	return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(import_jsx_runtime.Fragment, { children: [failure ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
		"data-correlation-id": failure.correlationId,
		children: /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(ErrorState, { children: ["Section request failed ", failure.correlationId] })
	}) : null, children] });
}
var DOORS = [{
	role: "User",
	loginId: "user",
	password: "user-paper-1",
	action: "User login"
}, {
	role: "Admin",
	loginId: "admin",
	password: "admin-paper-1",
	action: "Admin login"
}];
function isSession(body) {
	return Boolean(body?.ok && isDeskRole(body.role) && typeof body.loginId === "string" && typeof body.csrfToken === "string");
}
function DeskAuth({ session, onSession }) {
	const [pending, setPending] = (0, import_react.useState)(null);
	const [error, setError] = (0, import_react.useState)(null);
	const onSessionRef = (0, import_react.useRef)(onSession);
	onSessionRef.current = onSession;
	(0, import_react.useEffect)(() => {
		let cancel = false;
		fetch("/api/desk/session", {
			credentials: "include",
			cache: "no-store"
		}).then((response) => response.json()).then((body) => {
			if (!cancel && isSession(body)) onSessionRef.current({
				role: body.role,
				loginId: body.loginId,
				csrfToken: body.csrfToken
			});
		}).catch(() => {});
		return () => {
			cancel = true;
		};
	}, []);
	async function signIn(door) {
		setPending(door.role);
		setError(null);
		try {
			const csrf = await (await fetch("/api/desk/csrf", { cache: "no-store" })).json();
			if (!csrf?.ok || typeof csrf.csrfToken !== "string") {
				setError("Sign-in is unavailable.");
				return;
			}
			const body = await (await fetch("/api/desk/login", {
				method: "POST",
				credentials: "include",
				headers: {
					"content-type": "application/json",
					"x-csrf-token": csrf.csrfToken
				},
				body: JSON.stringify({
					loginId: door.loginId,
					password: door.password
				})
			})).json();
			if (!isSession(body) || body.role !== door.role) {
				setError(body?.error === "login denied" ? "Login denied for this role." : "Login denied.");
				return;
			}
			onSession({
				role: body.role,
				loginId: body.loginId,
				csrfToken: body.csrfToken
			});
		} catch {
			setError("Login denied.");
		} finally {
			setPending(null);
		}
	}
	async function signOut() {
		if (!session) return;
		setPending(session.role);
		setError(null);
		try {
			await fetch("/api/desk/logout", {
				method: "POST",
				credentials: "include",
				headers: { "x-csrf-token": session.csrfToken }
			});
		} catch {}
		onSession(null);
		setPending(null);
	}
	const active = session ? DESK_ROLE_ACCESS[session.role] : null;
	return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("section", {
		className: "desk-auth",
		"aria-label": "Role login",
		children: [
			/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
				className: "desk-auth-head",
				children: [/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { children: [
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", {
						className: "eyebrow",
						children: "TWO ROLES · PAPER DESK"
					}),
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)("h2", { children: "User role and Admin role" }),
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { children: "दोनों रोल अलग हैं। User रिसर्च देखता है। Admin वही देखता है और checklist एडिट भी कर सकता है। Live orders locked रहते हैं।" })
				] }), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", {
					className: session?.role === "Admin" ? "pill pill-live" : "pill pill-warn",
					children: session ? `${session.role} role` : "Signed out"
				})]
			}),
			active && session ? /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("article", {
				className: "card role-card",
				children: [
					/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", {
						className: "eyebrow",
						children: [active.title, " ROLE"]
					}),
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)("h3", { children: session.loginId }),
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { children: active.summary }),
					/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("p", {
						className: "role-list",
						children: [
							/* @__PURE__ */ (0, import_jsx_runtime.jsx)("b", { children: "Open" }),
							" ",
							active.sections.join(" · ")
						]
					}),
					active.denied.length > 0 ? /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("p", {
						className: "role-list",
						children: [
							/* @__PURE__ */ (0, import_jsx_runtime.jsx)("b", { children: "Closed" }),
							" ",
							active.denied.join(" · ")
						]
					}) : /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("p", {
						className: "role-list",
						children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("b", { children: "Closed" }), " none"]
					}),
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", {
						type: "button",
						className: "button button-dark",
						onClick: signOut,
						disabled: pending !== null,
						children: "Sign out"
					})
				]
			}) : /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
				className: "role-split",
				children: DOORS.map((door) => {
					const access = DESK_ROLE_ACCESS[door.role];
					return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("article", {
						className: "card role-card",
						children: [
							/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", {
								className: "eyebrow",
								children: [access.title, " ROLE"]
							}),
							/* @__PURE__ */ (0, import_jsx_runtime.jsx)("h3", { children: access.title }),
							/* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { children: access.summary }),
							/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("p", {
								className: "role-list",
								children: [
									/* @__PURE__ */ (0, import_jsx_runtime.jsx)("b", { children: "Open" }),
									" ",
									access.sections.join(" · ")
								]
							}),
							/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("p", {
								className: "role-list",
								children: [
									/* @__PURE__ */ (0, import_jsx_runtime.jsx)("b", { children: "Closed" }),
									" ",
									access.denied.length > 0 ? access.denied.join(" · ") : "none"
								]
							}),
							/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("p", {
								className: "muted tiny",
								children: [
									door.loginId,
									" / ",
									door.password
								]
							}),
							/* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", {
								type: "button",
								className: door.role === "Admin" ? "button button-dark" : "button button-accent",
								onClick: () => void signIn(door),
								disabled: pending !== null,
								children: pending === door.role ? "Signing in…" : door.action
							})
						]
					}, door.role);
				})
			}),
			error ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
				className: "notice notice-error",
				children: error
			}) : null
		]
	});
}
Object.freeze({
	venueDocsUrl: "https://developers.binance.com/en/docs",
	streamsUrl: "https://github.com/binance/binance-spot-api-docs/blob/master/web-socket-streams.md",
	restUrl: "https://github.com/binance/binance-spot-api-docs/blob/master/rest-api.md",
	marketDataOnlyUrl: "https://github.com/binance/binance-spot-api-docs/blob/master/faqs/market_data_only.md",
	changelogUrl: "https://github.com/binance/binance-spot-api-docs/blob/master/CHANGELOG.md",
	version: "2026-09-18",
	checkedAt: "2026-10-06"
});
var SPOT_STREAM_LIFECYCLE = Object.freeze({
	connectionValid: "24 hours",
	connectionValidMs: 864e5,
	serverPing: "20 seconds",
	serverPingMs: 2e4,
	pongDeadline: "1 minute",
	pongDeadlineMs: 6e4,
	incomingControlPerSecond: 5,
	maxStreams: 1024,
	connectionAttempts: "300 connections per attempt every 5 minutes per IP"
});
var SPOT_REST_ORIGIN = "https://data-api.binance.vision";
var SPOT_STREAM_ORIGIN = "wss://data-stream.binance.vision:443";
Object.freeze({
	trades: "/api/v3/trades",
	bookTicker: "/api/v3/ticker/bookTicker",
	exchangeInfo: "/api/v3/exchangeInfo",
	depth: "/api/v3/depth"
});
var CEX_RANK_NOTE = "Order is a connection plan from CoinGecko 2025 CEX spot share, then established public-API venues. Not a live volume feed.";
var CEX_VENUES = Object.freeze([
	Object.freeze({
		rank: 1,
		name: "Binance",
		spot: "connected",
		futures: "connected"
	}),
	Object.freeze({
		rank: 2,
		name: "Bybit",
		spot: "not-connected",
		futures: "not-connected"
	}),
	Object.freeze({
		rank: 3,
		name: "OKX",
		spot: "not-connected",
		futures: "not-connected"
	}),
	Object.freeze({
		rank: 4,
		name: "Coinbase Exchange",
		spot: "not-connected",
		futures: "not-offered"
	}),
	Object.freeze({
		rank: 5,
		name: "Kraken",
		spot: "not-connected",
		futures: "not-connected"
	}),
	Object.freeze({
		rank: 6,
		name: "KuCoin",
		spot: "not-connected",
		futures: "not-connected"
	}),
	Object.freeze({
		rank: 7,
		name: "Gate",
		spot: "not-connected",
		futures: "not-connected"
	}),
	Object.freeze({
		rank: 8,
		name: "Bitget",
		spot: "not-connected",
		futures: "not-connected"
	}),
	Object.freeze({
		rank: 9,
		name: "MEXC",
		spot: "not-connected",
		futures: "not-connected"
	}),
	Object.freeze({
		rank: 10,
		name: "HTX",
		spot: "not-connected",
		futures: "not-connected"
	}),
	Object.freeze({
		rank: 11,
		name: "Crypto.com Exchange",
		spot: "not-connected",
		futures: "not-connected"
	}),
	Object.freeze({
		rank: 12,
		name: "Upbit",
		spot: "not-connected",
		futures: "not-offered"
	}),
	Object.freeze({
		rank: 13,
		name: "Bitfinex",
		spot: "not-connected",
		futures: "not-connected"
	}),
	Object.freeze({
		rank: 14,
		name: "Bitstamp",
		spot: "not-connected",
		futures: "not-offered"
	}),
	Object.freeze({
		rank: 15,
		name: "Gemini",
		spot: "not-connected",
		futures: "not-offered"
	})
]);
var BINANCE_FUTURES_STREAM_LIMITS = Object.freeze({
	docsUrl: "https://developers.binance.com/en/docs/products/derivatives-trading-usds-futures/websocket-market-streams/Connect",
	markDocsUrl: "https://developers.binance.com/en/docs/catalog/core-trading-derivatives-trading-usd-s-m-futures/api/ws-streams/market",
	checkedAt: "2026-10-07",
	origin: "wss://fstream.binance.com/market",
	connectionValid: "24 hours",
	serverPing: "3 minutes",
	pongDeadline: "10 minutes",
	incomingMessagesPerSecond: 10,
	maxStreams: 1024,
	updateSpeed: "1s on @markPrice@1s, otherwise 3s",
	condition: "markPrice is served on /market. No order or private stream is opened."
});
var BINANCE_SPOT_SOCKET = Object.freeze({
	origin: SPOT_STREAM_ORIGIN,
	restOrigin: SPOT_REST_ORIGIN,
	streams: Object.freeze(["{symbol}@trade", "{symbol}@bookTicker"]),
	limits: SPOT_STREAM_LIFECYCLE,
	conditions: Object.freeze([
		"Public market-data host only. No API key and no order route.",
		"Symbol must match A-Z and 0-9. Any other stream name is rejected.",
		"A connection lasts 24 hours, then it must reconnect and resubscribe.",
		"Server ping is every 20 seconds. A pong is required within 1 minute.",
		"At most 5 incoming control messages per second.",
		"At most 1024 streams on one connection.",
		"At most 300 connection attempts every 5 minutes per IP.",
		"An invalid frame is ignored. It is never stored as zero.",
		"The page calls the feed stale after 10 seconds without a frame.",
		"Reconnect waits from 1 second and doubles, capped at 15 seconds.",
		"The page keeps the last 12 trades. Older prints are dropped on screen only."
	])
});
var BINANCE_FUTURES_SOCKET = Object.freeze({
	origin: BINANCE_FUTURES_STREAM_LIMITS.origin,
	streams: Object.freeze(["{symbol}@markPrice@1s"]),
	limits: BINANCE_FUTURES_STREAM_LIMITS,
	conditions: Object.freeze([
		"Public market stream only. No API key and no order route.",
		"The stream is pinned to /market. The old /ws markPrice path is not used.",
		"A connection lasts 24 hours, then it must reconnect.",
		"Server ping is every 3 minutes. A pong is required within 10 minutes.",
		"At most 10 incoming messages per second.",
		"At most 1024 streams on one connection.",
		"Update speed for this socket is 1 second.",
		"Estimated settle price P is only useful in the last hour before settlement.",
		"An invalid frame is ignored. It is never stored as zero.",
		"The page calls the feed stale after 10 seconds without a frame."
	])
});
var BINANCE_SPOT_FIELDS = Object.freeze([
	Object.freeze({
		stream: "bookTicker",
		field: "s",
		meaning: "Symbol",
		limit: "Must match the subscribed symbol",
		used: "Market · book header",
		wasHidden: true
	}),
	Object.freeze({
		stream: "bookTicker",
		field: "b",
		meaning: "Best bid price",
		limit: "Decimal string",
		used: "Market · best bid",
		wasHidden: false
	}),
	Object.freeze({
		stream: "bookTicker",
		field: "B",
		meaning: "Best bid quantity",
		limit: "Decimal string",
		used: "Market · best bid size",
		wasHidden: false
	}),
	Object.freeze({
		stream: "bookTicker",
		field: "a",
		meaning: "Best ask price",
		limit: "Decimal string",
		used: "Market · best ask",
		wasHidden: false
	}),
	Object.freeze({
		stream: "bookTicker",
		field: "A",
		meaning: "Best ask quantity",
		limit: "Decimal string",
		used: "Market · best ask size",
		wasHidden: false
	}),
	Object.freeze({
		stream: "bookTicker",
		field: "u",
		meaning: "Order book update id",
		limit: "Whole number",
		used: "Market · book update id",
		wasHidden: true
	}),
	Object.freeze({
		stream: "trade",
		field: "e",
		meaning: "Event name",
		limit: "Must be trade",
		used: "Parser gate only",
		wasHidden: false
	}),
	Object.freeze({
		stream: "trade",
		field: "E",
		meaning: "Event time",
		limit: "Unix milliseconds",
		used: "Market · trade event time",
		wasHidden: true
	}),
	Object.freeze({
		stream: "trade",
		field: "s",
		meaning: "Symbol",
		limit: "Must match the subscribed symbol",
		used: "Market · trade symbol",
		wasHidden: true
	}),
	Object.freeze({
		stream: "trade",
		field: "t",
		meaning: "Trade id",
		limit: "Whole number",
		used: "Market · trade id",
		wasHidden: true
	}),
	Object.freeze({
		stream: "trade",
		field: "p",
		meaning: "Price",
		limit: "Decimal string",
		used: "Market · price, sparkline",
		wasHidden: false
	}),
	Object.freeze({
		stream: "trade",
		field: "q",
		meaning: "Quantity",
		limit: "Decimal string",
		used: "Market · quantity and 12-print imbalance",
		wasHidden: false
	}),
	Object.freeze({
		stream: "trade",
		field: "T",
		meaning: "Trade time",
		limit: "Unix milliseconds",
		used: "Market · trade clock",
		wasHidden: false
	}),
	Object.freeze({
		stream: "trade",
		field: "m",
		meaning: "Buyer is the maker",
		limit: "Boolean. true means the taker sold",
		used: "Market · taker side",
		wasHidden: false
	}),
	Object.freeze({
		stream: "trade",
		field: "M",
		meaning: "Best-match flag",
		limit: "Boolean. Docs say ignore for strategy",
		used: "Market · best-match column",
		wasHidden: true
	})
]);
var BINANCE_FUTURES_FIELDS = Object.freeze([
	Object.freeze({
		stream: "markPrice@1s",
		field: "e",
		meaning: "Event name",
		limit: "markPriceUpdate",
		used: "Market · event name",
		wasHidden: true
	}),
	Object.freeze({
		stream: "markPrice@1s",
		field: "E",
		meaning: "Event time",
		limit: "Unix milliseconds",
		used: "Market · event time",
		wasHidden: true
	}),
	Object.freeze({
		stream: "markPrice@1s",
		field: "s",
		meaning: "Symbol",
		limit: "Must match the subscribed symbol",
		used: "Market · futures symbol",
		wasHidden: true
	}),
	Object.freeze({
		stream: "markPrice@1s",
		field: "p",
		meaning: "Mark price",
		limit: "Decimal string",
		used: "Market · mark price",
		wasHidden: false
	}),
	Object.freeze({
		stream: "markPrice@1s",
		field: "i",
		meaning: "Index price",
		limit: "Decimal string. Not a kline close",
		used: "Market · index price",
		wasHidden: false
	}),
	Object.freeze({
		stream: "markPrice@1s",
		field: "P",
		meaning: "Estimated settle price",
		limit: "Useful only in the last hour before settlement",
		used: "Market · settle estimate",
		wasHidden: true
	}),
	Object.freeze({
		stream: "markPrice@1s",
		field: "r",
		meaning: "Funding rate",
		limit: "Decimal string",
		used: "Market · funding rate",
		wasHidden: false
	}),
	Object.freeze({
		stream: "markPrice@1s",
		field: "ap",
		meaning: "Mark price moving average",
		limit: "Decimal string",
		used: "Market · mark average",
		wasHidden: true
	}),
	Object.freeze({
		stream: "markPrice@1s",
		field: "T",
		meaning: "Next funding time",
		limit: "Unix milliseconds",
		used: "Market · next funding",
		wasHidden: false
	})
]);
var EMPTY_SPOT = {
	symbol: "",
	bid: "—",
	bidQty: "—",
	ask: "—",
	askQty: "—",
	bookUpdateId: null,
	trades: []
};
function asRecord(input) {
	if (!input || typeof input !== "object") return null;
	const event = input.data ?? input;
	if (!event || typeof event !== "object") return null;
	return event;
}
function useSocketFeed(url, parse) {
	const [state, setState] = (0, import_react.useState)({
		status: "connecting",
		value: null,
		seenAt: null
	});
	const [now, setNow] = (0, import_react.useState)(Date.now());
	(0, import_react.useEffect)(() => {
		const timer = setInterval(() => setNow(Date.now()), 1e3);
		return () => clearInterval(timer);
	}, []);
	(0, import_react.useEffect)(() => {
		let stopped = false;
		let socket = null;
		let timer = null;
		let attempts = 0;
		const connect = () => {
			if (stopped) return;
			setState((current) => ({
				...current,
				status: attempts ? "reconnecting" : "connecting"
			}));
			socket = new WebSocket(url);
			socket.onopen = () => {
				attempts = 0;
			};
			socket.onmessage = (message) => {
				try {
					const decoded = JSON.parse(String(message.data));
					setState((prior) => {
						const next = parse(decoded, prior.value);
						return next === null ? prior : {
							status: "live",
							value: next,
							seenAt: Date.now()
						};
					});
				} catch {}
			};
			socket.onerror = () => socket?.close();
			socket.onclose = () => {
				if (stopped) return;
				attempts += 1;
				timer = setTimeout(connect, Math.min(1e3 * 2 ** Math.min(attempts, 4), 15e3));
			};
		};
		setState({
			status: "connecting",
			value: null,
			seenAt: null
		});
		connect();
		return () => {
			stopped = true;
			if (timer) clearTimeout(timer);
			socket?.close();
		};
	}, [url, parse]);
	const fresh = state.seenAt !== null && now - state.seenAt < 1e4;
	return {
		...state,
		status: state.status === "live" && !fresh ? "reconnecting" : state.status,
		ageSeconds: state.seenAt ? Math.max(0, Math.floor((now - state.seenAt) / 1e3)) : null
	};
}
function parseSpot(input, prior) {
	const event = asRecord(input);
	if (!event || typeof event.s !== "string") return null;
	if (event.e === "trade" && typeof event.p === "string" && typeof event.q === "string" && typeof event.T === "number") {
		const base = prior ?? EMPTY_SPOT;
		const trade = {
			symbol: event.s,
			price: event.p,
			qty: event.q,
			buyerMaker: event.m === true,
			time: event.T,
			eventTime: typeof event.E === "number" ? event.E : null,
			tradeId: typeof event.t === "number" ? event.t : null,
			bestMatch: typeof event.M === "boolean" ? event.M : null
		};
		return {
			...base,
			symbol: event.s,
			trades: [trade, ...base.trades].slice(0, 12)
		};
	}
	if (typeof event.b === "string" && typeof event.B === "string" && typeof event.a === "string" && typeof event.A === "string") {
		const base = prior ?? EMPTY_SPOT;
		return {
			...base,
			symbol: event.s,
			bid: event.b,
			bidQty: event.B,
			ask: event.a,
			askQty: event.A,
			bookUpdateId: typeof event.u === "number" ? event.u : base.bookUpdateId
		};
	}
	return null;
}
function parseFuture(input, _prior) {
	const event = asRecord(input);
	if (!event || typeof event.p !== "string" || typeof event.i !== "string" || typeof event.r !== "string" || typeof event.T !== "number") return null;
	return {
		event: typeof event.e === "string" ? event.e : null,
		eventTime: typeof event.E === "number" ? event.E : null,
		symbol: typeof event.s === "string" ? event.s : null,
		mark: event.p,
		index: event.i,
		funding: event.r,
		nextFunding: event.T,
		settle: typeof event.P === "string" ? event.P : null,
		markAverage: typeof event.ap === "string" ? event.ap : null
	};
}
function statusLabel(status) {
	if (status === "connected") return "Connected";
	if (status === "not-offered") return "Not in this book";
	return "Not connected";
}
function FieldTable({ rows }) {
	return /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
		className: "table-scroll",
		children: /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("table", { children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("thead", { children: /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("tr", { children: [
			/* @__PURE__ */ (0, import_jsx_runtime.jsx)("th", { children: "Socket" }),
			/* @__PURE__ */ (0, import_jsx_runtime.jsx)("th", { children: "Field" }),
			/* @__PURE__ */ (0, import_jsx_runtime.jsx)("th", { children: "Meaning" }),
			/* @__PURE__ */ (0, import_jsx_runtime.jsx)("th", { children: "Limit / condition" }),
			/* @__PURE__ */ (0, import_jsx_runtime.jsx)("th", { children: "Where it is used" }),
			/* @__PURE__ */ (0, import_jsx_runtime.jsx)("th", { children: "Was hidden" })
		] }) }), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("tbody", { children: rows.map((row) => /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("tr", { children: [
			/* @__PURE__ */ (0, import_jsx_runtime.jsx)("td", { children: row.stream }),
			/* @__PURE__ */ (0, import_jsx_runtime.jsx)("td", {
				className: "mono",
				children: row.field
			}),
			/* @__PURE__ */ (0, import_jsx_runtime.jsx)("td", { children: row.meaning }),
			/* @__PURE__ */ (0, import_jsx_runtime.jsx)("td", { children: row.limit }),
			/* @__PURE__ */ (0, import_jsx_runtime.jsx)("td", { children: row.used }),
			/* @__PURE__ */ (0, import_jsx_runtime.jsx)("td", { children: row.wasHidden ? "Yes · now on Market" : "No" })
		] }, `${row.stream}-${row.field}`)) })] })
	});
}
function SpotLive() {
	const feed = useSocketFeed("wss://data-stream.binance.vision:443/stream?streams=btcusdt@trade/btcusdt@bookTicker", parseSpot);
	const last = feed.value?.trades[0];
	return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
		className: "cex-live",
		children: [
			/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("p", {
				className: "muted tiny",
				children: [BINANCE_SPOT_SOCKET.origin, "/stream?streams=btcusdt@trade/btcusdt@bookTicker"]
			}),
			/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
				className: "stat-line",
				children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { children: "Status" }), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("b", { children: feed.status })]
			}),
			/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
				className: "stat-line",
				children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { children: "Symbol / book update" }), /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("b", { children: [
					feed.value?.symbol || "—",
					" · ",
					feed.value?.bookUpdateId ?? "—"
				] })]
			}),
			/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
				className: "stat-line",
				children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { children: "Bid / ask" }), /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("b", { children: [
					feed.value?.bid ?? "—",
					" × ",
					feed.value?.bidQty ?? "—",
					" / ",
					feed.value?.ask ?? "—",
					" × ",
					feed.value?.askQty ?? "—"
				] })]
			}),
			/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
				className: "stat-line",
				children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { children: "Last trade id / price / qty" }), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("b", { children: last ? `${last.tradeId ?? "—"} · ${last.price} · ${last.qty}` : "—" })]
			}),
			/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
				className: "stat-line",
				children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { children: "Event time / best match" }), /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("b", { children: [
					last?.eventTime ? new Date(last.eventTime).toLocaleTimeString() : "—",
					" · ",
					last?.bestMatch === null || last?.bestMatch === void 0 ? "—" : last.bestMatch ? "Yes" : "No"
				] })]
			})
		]
	});
}
function FuturesLive() {
	const feed = useSocketFeed("wss://fstream.binance.com/market/stream?streams=btcusdt@markPrice@1s", parseFuture);
	const value = feed.value;
	return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
		className: "cex-live",
		children: [
			/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("p", {
				className: "muted tiny",
				children: [BINANCE_FUTURES_SOCKET.origin, "/stream?streams=btcusdt@markPrice@1s"]
			}),
			/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
				className: "stat-line",
				children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { children: "Status" }), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("b", { children: feed.status })]
			}),
			/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
				className: "stat-line",
				children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { children: "Event / symbol" }), /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("b", { children: [
					value?.event ?? "—",
					" · ",
					value?.symbol ?? "—"
				] })]
			}),
			/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
				className: "stat-line",
				children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { children: "Mark / index / average" }), /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("b", { children: [
					value?.mark ?? "—",
					" · ",
					value?.index ?? "—",
					" · ",
					value?.markAverage ?? "—"
				] })]
			}),
			/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
				className: "stat-line",
				children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { children: "Funding / next / settle" }), /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("b", { children: [
					value?.funding ?? "—",
					" · ",
					value ? new Date(value.nextFunding).toLocaleTimeString() : "—",
					" · ",
					value?.settle ?? "—"
				] })]
			})
		]
	});
}
function CexDesk() {
	const [book, setBook] = (0, import_react.useState)("spot");
	const fields = book === "spot" ? BINANCE_SPOT_FIELDS : BINANCE_FUTURES_FIELDS;
	const socket = book === "spot" ? BINANCE_SPOT_SOCKET : BINANCE_FUTURES_SOCKET;
	const limits = socket.limits;
	return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("section", {
		className: "cex-desk",
		"aria-label": "Centralized exchanges",
		children: [
			/* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
				className: "section-intro",
				children: /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { children: [
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", {
						className: "eyebrow",
						children: "ADMIN · CENTRALIZED EXCHANGES"
					}),
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)("h2", { children: "Top 15 CEX · API connection plan" }),
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { children: "Spot और Futures अलग हैं। सिर्फ Binance का public socket खुला है। बाकी 14 एक्सचेंज लिस्ट में हैं, कनेक्ट नहीं। Live orders locked रहते हैं।" })
				] })
			}),
			/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
				className: "cex-books",
				role: "group",
				"aria-label": "Market book",
				children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", {
					type: "button",
					className: "button button-accent",
					"aria-pressed": book === "spot",
					onClick: () => setBook("spot"),
					children: "Spot"
				}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", {
					type: "button",
					className: "button button-dark",
					"aria-pressed": book === "futures",
					onClick: () => setBook("futures"),
					children: "Futures"
				})]
			}),
			/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("article", {
				className: "card",
				children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
					className: "muted tiny",
					children: CEX_RANK_NOTE
				}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
					className: "table-scroll",
					children: /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("table", { children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("thead", { children: /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("tr", { children: [
						/* @__PURE__ */ (0, import_jsx_runtime.jsx)("th", { children: "#" }),
						/* @__PURE__ */ (0, import_jsx_runtime.jsx)("th", { children: "Exchange" }),
						/* @__PURE__ */ (0, import_jsx_runtime.jsx)("th", { children: book === "spot" ? "Spot API" : "Futures API" }),
						/* @__PURE__ */ (0, import_jsx_runtime.jsx)("th", { children: "Orders" })
					] }) }), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("tbody", { children: CEX_VENUES.map((venue) => {
						const state = book === "spot" ? venue.spot : venue.futures;
						return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("tr", { children: [
							/* @__PURE__ */ (0, import_jsx_runtime.jsx)("td", { children: venue.rank }),
							/* @__PURE__ */ (0, import_jsx_runtime.jsx)("td", { children: venue.name }),
							/* @__PURE__ */ (0, import_jsx_runtime.jsx)("td", {
								className: state === "connected" ? "status-implemented" : "status-blocked",
								children: statusLabel(state)
							}),
							/* @__PURE__ */ (0, import_jsx_runtime.jsx)("td", { children: "Locked" })
						] }, venue.name);
					}) })] })
				})]
			}),
			/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("article", {
				className: "card",
				children: [
					/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("header", {
						className: "card-head",
						children: [/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { children: [/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", {
							className: "eyebrow",
							children: ["BINANCE · ", book === "spot" ? "SPOT" : "USDⓈ-M FUTURES"]
						}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("h3", { children: "Socket, limits, and every field" })] }), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", {
							className: "pill pill-live",
							children: "BTCUSDT"
						})]
					}),
					book === "spot" ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)(SpotLive, {}) : /* @__PURE__ */ (0, import_jsx_runtime.jsx)(FuturesLive, {}),
					/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("ul", {
						className: "cex-limits",
						children: [
							"connectionValid" in limits ? /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("li", { children: ["Connection life: ", limits.connectionValid] }) : null,
							"serverPing" in limits ? /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("li", { children: [
								"Server ping: ",
								limits.serverPing,
								". Pong deadline: ",
								limits.pongDeadline
							] }) : null,
							"incomingControlPerSecond" in limits ? /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("li", { children: [
								"Incoming control limit: ",
								limits.incomingControlPerSecond,
								" per second"
							] }) : null,
							"incomingMessagesPerSecond" in limits ? /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("li", { children: [
								"Incoming message limit: ",
								limits.incomingMessagesPerSecond,
								" per second"
							] }) : null,
							/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("li", { children: ["Max streams on one connection: ", limits.maxStreams] }),
							"connectionAttempts" in limits ? /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("li", { children: ["Connection attempts: ", limits.connectionAttempts] }) : null,
							"updateSpeed" in limits ? /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("li", { children: ["Update speed: ", limits.updateSpeed] }) : null,
							"condition" in limits ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("li", { children: limits.condition }) : null
						]
					}),
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)("ul", {
						className: "cex-limits",
						children: socket.conditions.map((condition) => /* @__PURE__ */ (0, import_jsx_runtime.jsx)("li", { children: condition }, condition))
					}),
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)(FieldTable, { rows: fields })
				]
			})
		]
	});
}
function StatusPill({ status, age }) {
	return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", {
		className: `pill ${status === "live" ? "pill-live" : "pill-warn"}`,
		children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("i", {}), status === "live" ? `LIVE · ${age ?? 0}s` : status.toUpperCase()]
	});
}
function PriceSparkline({ trades }) {
	if (trades.length < 2) return /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
		className: "spark-empty",
		children: "Price trace appears after live trade events arrive."
	});
	const values = [...trades].reverse().map((trade) => Number(trade.price)).filter(Number.isFinite);
	if (values.length < 2) return /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
		className: "spark-empty",
		children: "Waiting for valid price events."
	});
	const low = Math.min(...values);
	const high = Math.max(...values);
	const range = high - low || Math.max(high * 1e-5, 1);
	const points = values.map((value, index) => `${index / (values.length - 1) * 520},${108 - (value - low) / range * 92}`).join(" ");
	return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
		className: "sparkline-wrap",
		children: [
			/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
				className: "sparkline-head",
				children: [/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", { children: [
					"Recent trade price · ",
					values.length,
					" events"
				] }), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("small", { children: values.at(-1) })]
			}),
			/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("svg", {
				className: "sparkline",
				viewBox: "0 0 520 120",
				role: "img",
				"aria-label": "Recent trade price trace from live exchange events",
				preserveAspectRatio: "none",
				children: [
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)("defs", { children: /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("linearGradient", {
						id: "price-fill",
						x1: "0",
						x2: "0",
						y1: "0",
						y2: "1",
						children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("stop", {
							offset: "0%",
							stopColor: "#08805d",
							stopOpacity: ".22"
						}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("stop", {
							offset: "100%",
							stopColor: "#08805d",
							stopOpacity: "0"
						})]
					}) }),
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)("polygon", {
						points: `0,120 ${points} 520,120`,
						fill: "url(#price-fill)"
					}),
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)("polyline", {
						points,
						fill: "none",
						stroke: "#08795c",
						strokeWidth: "3",
						strokeLinecap: "round",
						strokeLinejoin: "round",
						vectorEffect: "non-scaling-stroke"
					})
				]
			}),
			/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
				className: "sparkline-labels",
				children: [
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { children: low }),
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { children: "Live event sequence · not a forecast" }),
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { children: high })
				]
			})
		]
	});
}
function clock(value) {
	return typeof value === "number" ? new Date(value).toLocaleTimeString() : "—";
}
function MarketView() {
	const [symbolInput, setSymbolInput] = (0, import_react.useState)("BTCUSDT");
	const [symbol, setSymbol] = (0, import_react.useState)("BTCUSDT");
	const safeSymbol = /^[A-Z0-9]{5,20}$/.test(symbol) ? symbol.toLowerCase() : "btcusdt";
	const spotUrl = `wss://data-stream.binance.vision:443/stream?streams=${safeSymbol}@trade/${safeSymbol}@bookTicker`;
	const futuresUrl = `wss://fstream.binance.com/market/stream?streams=${safeSymbol}@markPrice@1s`;
	const spot = useSocketFeed(spotUrl, parseSpot);
	const future = useSocketFeed(futuresUrl, parseFuture);
	const spread = spot.value && spot.value.bid !== "—" && spot.value.ask !== "—" ? (Number(spot.value.ask) - Number(spot.value.bid)).toPrecision(7) : null;
	const buyQty = spot.value?.trades.filter((trade) => !trade.buyerMaker).reduce((sum, trade) => sum + Number(trade.qty), 0) ?? 0;
	const sellQty = spot.value?.trades.filter((trade) => trade.buyerMaker).reduce((sum, trade) => sum + Number(trade.qty), 0) ?? 0;
	return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(import_jsx_runtime.Fragment, { children: [
		/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
			className: "section-intro",
			children: [/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { children: [
				/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", {
					className: "eyebrow",
					children: "PUBLIC MARKET DATA · READ ONLY"
				}),
				/* @__PURE__ */ (0, import_jsx_runtime.jsx)("h2", { children: "Live market monitor" }),
				/* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { children: "Browser connects directly to public Binance market streams. No keys and no order permissions." })
			] }), /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("form", {
				className: "symbol-form",
				onSubmit: (event) => {
					event.preventDefault();
					const next = symbolInput.trim().toUpperCase();
					if (/^[A-Z0-9]{5,20}$/.test(next)) setSymbol(next);
				},
				children: [
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)("label", {
						htmlFor: "symbol",
						children: "Symbol"
					}),
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)("input", {
						id: "symbol",
						value: symbolInput,
						onChange: (event) => setSymbolInput(event.target.value),
						maxLength: 20
					}),
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", {
						className: "button button-dark",
						children: "Apply"
					})
				]
			})]
		}),
		/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
			className: "grid grid-2",
			children: [/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("article", {
				className: "card market-card",
				children: [
					/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("header", {
						className: "card-head",
						children: [/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", {
							className: "eyebrow",
							children: "BINANCE SPOT"
						}), /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("h3", { children: [symbol, " · Top of book"] })] }), /* @__PURE__ */ (0, import_jsx_runtime.jsx)(StatusPill, {
							status: spot.status,
							age: spot.ageSeconds
						})]
					}),
					/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
						className: "quote-grid",
						children: [/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { children: [
							/* @__PURE__ */ (0, import_jsx_runtime.jsx)("small", { children: "BEST BID" }),
							/* @__PURE__ */ (0, import_jsx_runtime.jsx)("b", {
								className: "positive",
								children: spot.value?.bid ?? "—"
							}),
							/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("small", { children: [
								spot.value?.bidQty ?? "—",
								" ",
								symbol.slice(0, -4)
							] })
						] }), /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { children: [
							/* @__PURE__ */ (0, import_jsx_runtime.jsx)("small", { children: "BEST ASK" }),
							/* @__PURE__ */ (0, import_jsx_runtime.jsx)("b", {
								className: "negative",
								children: spot.value?.ask ?? "—"
							}),
							/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("small", { children: [
								spot.value?.askQty ?? "—",
								" ",
								symbol.slice(0, -4)
							] })
						] })]
					}),
					/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
						className: "stat-line",
						children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { children: "Spread" }), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("b", { children: spread ?? "—" })]
					}),
					/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
						className: "stat-line",
						children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { children: "Book update id" }), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("b", { children: spot.value?.bookUpdateId ?? "—" })]
					}),
					/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
						className: "stat-line",
						children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { children: "Recent trade imbalance (12 prints)" }), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("b", { children: buyQty + sellQty > 0 ? `${((buyQty - sellQty) / (buyQty + sellQty) * 100).toFixed(1)}%` : "—" })]
					}),
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)(PriceSparkline, { trades: spot.value?.trades ?? [] }),
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)("h4", { children: "Recent trades" }),
					spot.value?.trades.length ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
						className: "table-scroll",
						children: /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("table", { children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("thead", { children: /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("tr", { children: [
							/* @__PURE__ */ (0, import_jsx_runtime.jsx)("th", { children: "Trade id" }),
							/* @__PURE__ */ (0, import_jsx_runtime.jsx)("th", { children: "Time (UTC)" }),
							/* @__PURE__ */ (0, import_jsx_runtime.jsx)("th", { children: "Event time" }),
							/* @__PURE__ */ (0, import_jsx_runtime.jsx)("th", { children: "Price" }),
							/* @__PURE__ */ (0, import_jsx_runtime.jsx)("th", { children: "Quantity" }),
							/* @__PURE__ */ (0, import_jsx_runtime.jsx)("th", { children: "Taker" }),
							/* @__PURE__ */ (0, import_jsx_runtime.jsx)("th", { children: "Best match" })
						] }) }), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("tbody", { children: spot.value.trades.map((trade, index) => /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("tr", { children: [
							/* @__PURE__ */ (0, import_jsx_runtime.jsx)("td", { children: trade.tradeId ?? "—" }),
							/* @__PURE__ */ (0, import_jsx_runtime.jsx)("td", { children: clock(trade.time) }),
							/* @__PURE__ */ (0, import_jsx_runtime.jsx)("td", { children: clock(trade.eventTime) }),
							/* @__PURE__ */ (0, import_jsx_runtime.jsx)("td", { children: trade.price }),
							/* @__PURE__ */ (0, import_jsx_runtime.jsx)("td", { children: trade.qty }),
							/* @__PURE__ */ (0, import_jsx_runtime.jsx)("td", { children: trade.buyerMaker ? "Sell" : "Buy" }),
							/* @__PURE__ */ (0, import_jsx_runtime.jsx)("td", { children: trade.bestMatch === null ? "—" : trade.bestMatch ? "Yes" : "No" })
						] }, `${trade.tradeId ?? trade.time}-${index}`)) })] })
					}) : /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
						className: "muted",
						children: "Waiting for actual exchange events. Empty values stay unknown."
					})
				]
			}), /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("article", {
				className: "card",
				children: [
					/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("header", {
						className: "card-head",
						children: [/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", {
							className: "eyebrow",
							children: "BINANCE USDⓈ-M FUTURES"
						}), /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("h3", { children: [symbol, " · Mark & funding"] })] }), /* @__PURE__ */ (0, import_jsx_runtime.jsx)(StatusPill, {
							status: future.status,
							age: future.ageSeconds
						})]
					}),
					/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
						className: "metric-grid",
						children: [
							/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
								className: "metric",
								children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("small", { children: "MARK PRICE" }), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("strong", { children: future.value?.mark ?? "—" })]
							}),
							/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
								className: "metric",
								children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("small", { children: "INDEX PRICE" }), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("strong", { children: future.value?.index ?? "—" })]
							}),
							/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
								className: "metric",
								children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("small", { children: "MARK AVERAGE" }), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("strong", { children: future.value?.markAverage ?? "—" })]
							}),
							/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
								className: "metric",
								children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("small", { children: "SETTLE ESTIMATE" }), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("strong", { children: future.value?.settle ?? "—" })]
							}),
							/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
								className: "metric",
								children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("small", { children: "FUNDING RATE" }), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("strong", { children: future.value?.funding ?? "—" })]
							}),
							/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
								className: "metric",
								children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("small", { children: "NEXT FUNDING" }), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("strong", { children: future.value ? clock(future.value.nextFunding) : "—" })]
							})
						]
					}),
					/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
						className: "stat-line",
						children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { children: "Event" }), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("b", { children: future.value?.event ?? "—" })]
					}),
					/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
						className: "stat-line",
						children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { children: "Event time" }), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("b", { children: clock(future.value?.eventTime) })]
					}),
					/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
						className: "stat-line",
						children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { children: "Symbol on the frame" }), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("b", { children: future.value?.symbol ?? "—" })]
					}),
					/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
						className: "notice notice-warn",
						children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("b", { children: "Live futures trading: LOCKED" }), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { children: "Settle estimate is only useful in the last hour before settlement. This panel reads public data only." })]
					})
				]
			})]
		}),
		/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("article", {
			className: "card",
			children: [
				/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("header", {
					className: "card-head",
					children: [/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", {
						className: "eyebrow",
						children: "CONNECTOR COVERAGE"
					}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("h3", { children: "Exchange adapter status" })] }), /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", {
						className: "coverage-number",
						children: ["1 ", /* @__PURE__ */ (0, import_jsx_runtime.jsx)("small", { children: "/ 15 CEX connection slots" })]
					})]
				}),
				/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
					className: "coverage-list",
					children: [
						/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", {
							className: "coverage-ok",
							children: "● Binance Spot — public adapter live"
						}),
						/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", {
							className: "coverage-ok",
							children: "● Binance USDⓈ-M — public adapter live"
						}),
						/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", {
							className: "coverage-off",
							children: "○ 14 other CEX venues — listed in Admin, not connected"
						})
					]
				}),
				/* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
					className: "muted tiny",
					children: "The Admin role holds the 15-exchange list, socket limits, and field map. Live orders stay locked."
				})
			]
		})
	] });
}
function DexView() {
	const [query, setQuery] = (0, import_react.useState)("WETH USDC");
	const [pairs, setPairs] = (0, import_react.useState)([]);
	const [status, setStatus] = (0, import_react.useState)("idle");
	const [error, setError] = (0, import_react.useState)("");
	async function search(event) {
		event.preventDefault();
		setStatus("loading");
		setError("");
		try {
			const response = await fetch(`/api/dex/search?q=${encodeURIComponent(query)}`, { cache: "no-store" });
			const data = await response.json();
			if (!response.ok || !data.ok) throw new Error(data.error ?? "Search failed.");
			setPairs(data.pairs);
			setStatus("ready");
		} catch (caught) {
			setError(caught instanceof Error ? caught.message : "DEX search failed.");
			setStatus("error");
		}
	}
	return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(import_jsx_runtime.Fragment, { children: [
		/* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
			className: "section-intro",
			children: /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { children: [
				/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", {
					className: "eyebrow",
					children: "DEX DISCOVERY · PUBLIC SEARCH"
				}),
				/* @__PURE__ */ (0, import_jsx_runtime.jsx)("h2", { children: "Pool and pair search" }),
				/* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { children: "Search index data supplied by DexScreener. This is not an on-chain event socket or a token safety verdict." })
			] })
		}),
		/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("article", {
			className: "card",
			children: [
				/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("form", {
					className: "search-form",
					onSubmit: search,
					children: [
						/* @__PURE__ */ (0, import_jsx_runtime.jsx)("label", {
							className: "sr-only",
							htmlFor: "dex-query",
							children: "Token or pair search"
						}),
						/* @__PURE__ */ (0, import_jsx_runtime.jsx)("input", {
							id: "dex-query",
							value: query,
							onChange: (event) => setQuery(event.target.value),
							placeholder: "Token name, symbol or address",
							minLength: 2,
							maxLength: 100
						}),
						/* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", {
							className: "button button-accent",
							disabled: status === "loading",
							children: status === "loading" ? "Searching…" : "Search pools"
						})
					]
				}),
				error && /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
					className: "notice notice-error",
					children: error
				}),
				status === "ready" && pairs.length === 0 && /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
					className: "muted",
					children: "No indexed pools found for this query."
				}),
				pairs.length > 0 && /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
					className: "table-scroll",
					children: /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("table", { children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("thead", { children: /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("tr", { children: [
						/* @__PURE__ */ (0, import_jsx_runtime.jsx)("th", { children: "Chain / DEX" }),
						/* @__PURE__ */ (0, import_jsx_runtime.jsx)("th", { children: "Pair" }),
						/* @__PURE__ */ (0, import_jsx_runtime.jsx)("th", { children: "Price USD" }),
						/* @__PURE__ */ (0, import_jsx_runtime.jsx)("th", { children: "Liquidity USD" }),
						/* @__PURE__ */ (0, import_jsx_runtime.jsx)("th", { children: "24h volume USD" }),
						/* @__PURE__ */ (0, import_jsx_runtime.jsx)("th", { children: "Source" })
					] }) }), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("tbody", { children: pairs.map((pair) => /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("tr", { children: [
						/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("td", { children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("b", { children: pair.chain }), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("small", {
							className: "block",
							children: pair.dex
						})] }),
						/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("td", { children: [
							pair.base,
							"/",
							pair.quote,
							/* @__PURE__ */ (0, import_jsx_runtime.jsx)("small", {
								className: "block mono",
								children: pair.pairAddress
							})
						] }),
						/* @__PURE__ */ (0, import_jsx_runtime.jsx)("td", { children: pair.priceUsd ?? "—" }),
						/* @__PURE__ */ (0, import_jsx_runtime.jsx)("td", { children: pair.liquidityUsd?.toLocaleString() ?? "—" }),
						/* @__PURE__ */ (0, import_jsx_runtime.jsx)("td", { children: pair.volume24hUsd?.toLocaleString() ?? "—" }),
						/* @__PURE__ */ (0, import_jsx_runtime.jsx)("td", { children: pair.url ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("a", {
							href: pair.url,
							target: "_blank",
							rel: "noreferrer",
							children: "Open ↗"
						}) : "—" })
					] }, `${pair.chain}-${pair.pairAddress}`)) })] })
				})
			]
		}),
		/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
			className: "notice notice-info",
			children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("b", { children: "Scope" }), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { children: "DEX search returns a bounded list of indexed pairs. It does not decode swaps, establish wallet ownership, or submit trades." })]
		})
	] });
}
function WalletView() {
	const [chain, setChain] = (0, import_react.useState)("ethereum");
	const [address, setAddress] = (0, import_react.useState)("");
	const [watchlist, setWatchlist] = (0, import_react.useState)([]);
	const [data, setData] = (0, import_react.useState)(null);
	const [error, setError] = (0, import_react.useState)("");
	const [loading, setLoading] = (0, import_react.useState)(false);
	(0, import_react.useEffect)(() => {
		try {
			const saved = JSON.parse(localStorage.getItem("cpe-wallet-watchlist") ?? "[]");
			setWatchlist(Array.isArray(saved) ? saved.filter((item) => typeof item === "string" && /^0x[a-fA-F0-9]{40}$/.test(item)).slice(0, 15) : []);
		} catch {
			setWatchlist([]);
		}
	}, []);
	async function inspect(event) {
		event.preventDefault();
		const cleaned = address.trim();
		if (!/^0x[a-fA-F0-9]{40}$/.test(cleaned)) {
			setError("Enter a valid EVM address.");
			return;
		}
		if (!watchlist.some((item) => item.toLowerCase() === cleaned.toLowerCase()) && watchlist.length >= 15) {
			setError("The local watchlist is limited to 15 entries.");
			return;
		}
		setLoading(true);
		setError("");
		try {
			const list = [...watchlist.filter((item) => item.toLowerCase() !== cleaned.toLowerCase()), cleaned];
			setWatchlist(list);
			localStorage.setItem("cpe-wallet-watchlist", JSON.stringify(list));
			const response = await fetch(`/api/wallets/activity?chain=${chain}&address=${cleaned}`, { cache: "no-store" });
			const value = await response.json();
			if (!response.ok || !value.ok) throw new Error(value.error ?? "Explorer request failed.");
			setData(value);
		} catch (caught) {
			setError(caught instanceof Error ? caught.message : "Wallet lookup failed.");
			setData(null);
		} finally {
			setLoading(false);
		}
	}
	return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(import_jsx_runtime.Fragment, { children: [
		/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
			className: "section-intro",
			children: [/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { children: [
				/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", {
					className: "eyebrow",
					children: "WALLET ACTIVITY · MANUAL REVIEW"
				}),
				/* @__PURE__ */ (0, import_jsx_runtime.jsx)("h2", { children: "Address watchlist" }),
				/* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { children: "Activity explorer only. An address is not automatically called a whale, and a transfer is not classified as a buy or sell." })
			] }), /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
				className: "watch-count",
				children: [watchlist.length, /* @__PURE__ */ (0, import_jsx_runtime.jsx)("small", { children: " / 15 watch slots" })]
			})]
		}),
		/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("article", {
			className: "card",
			children: [
				/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("form", {
					className: "wallet-form",
					onSubmit: inspect,
					children: [
						/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("label", { children: ["Chain", /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("select", {
							value: chain,
							onChange: (event) => setChain(event.target.value),
							children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("option", {
								value: "ethereum",
								children: "Ethereum"
							}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("option", {
								value: "base",
								children: "Base"
							})]
						})] }),
						/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("label", {
							className: "wallet-address",
							children: ["Address", /* @__PURE__ */ (0, import_jsx_runtime.jsx)("input", {
								value: address,
								onChange: (event) => setAddress(event.target.value),
								placeholder: "0x… (reviewed address)",
								spellCheck: false
							})]
						}),
						/* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", {
							className: "button button-accent",
							disabled: loading,
							children: loading ? "Checking…" : "Inspect activity"
						})
					]
				}),
				error && /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
					className: "notice notice-error",
					children: error
				}),
				/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
					className: "notice notice-warn",
					children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("b", { children: "Whale verification: NOT ESTABLISHED" }), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { children: "No preloaded wallets, labels, balances, or inactivity claims are fabricated. Add an address you have independently reviewed." })]
				}),
				data && /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(import_jsx_runtime.Fragment, { children: [
					/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
						className: "stat-line",
						children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { children: "Source · observed at" }), /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("b", { children: [
							data.source,
							" · ",
							(/* @__PURE__ */ new Date()).toLocaleString()
						] })]
					}),
					/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("p", {
						className: "muted tiny",
						children: [data.transactions.length, " recent explorer transactions."]
					}),
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
						className: "table-scroll",
						children: /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("table", { children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("thead", { children: /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("tr", { children: [
							/* @__PURE__ */ (0, import_jsx_runtime.jsx)("th", { children: "Time" }),
							/* @__PURE__ */ (0, import_jsx_runtime.jsx)("th", { children: "Method" }),
							/* @__PURE__ */ (0, import_jsx_runtime.jsx)("th", { children: "From" }),
							/* @__PURE__ */ (0, import_jsx_runtime.jsx)("th", { children: "To" }),
							/* @__PURE__ */ (0, import_jsx_runtime.jsx)("th", { children: "Transaction" }),
							/* @__PURE__ */ (0, import_jsx_runtime.jsx)("th", { children: "Status" })
						] }) }), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("tbody", { children: data.transactions.map((tx) => /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("tr", { children: [
							/* @__PURE__ */ (0, import_jsx_runtime.jsx)("td", { children: tx.timestamp ? new Date(tx.timestamp).toLocaleString() : "—" }),
							/* @__PURE__ */ (0, import_jsx_runtime.jsx)("td", { children: tx.method ?? "Transfer / contract call" }),
							/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("td", {
								className: "mono",
								children: [tx.from?.slice(0, 8) ?? "—", "…"]
							}),
							/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("td", {
								className: "mono",
								children: [tx.to?.slice(0, 8) ?? "—", "…"]
							}),
							/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("td", {
								className: "mono",
								children: [tx.hash.slice(0, 12), "…"]
							}),
							/* @__PURE__ */ (0, import_jsx_runtime.jsx)("td", { children: tx.status })
						] }, tx.hash)) })] })
					})
				] })
			]
		}),
		/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("article", {
			className: "card",
			children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("h3", { children: "Saved on this device" }), watchlist.length === 0 ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
				className: "muted",
				children: "No addresses added. Nothing is being tracked yet."
			}) : /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
				className: "watchlist",
				children: watchlist.map((item) => /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("button", {
					className: "watch-entry",
					onClick: () => setAddress(item),
					children: [
						item.slice(0, 10),
						"…",
						item.slice(-6),
						" ",
						/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { children: "UNVERIFIED" })
					]
				}, item))
			})]
		})
	] });
}
function PredictionsView() {
	return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(import_jsx_runtime.Fragment, { children: [
		/* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
			className: "section-intro",
			children: /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { children: [
				/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", {
					className: "eyebrow",
					children: "MODEL STATUS"
				}),
				/* @__PURE__ */ (0, import_jsx_runtime.jsx)("h2", { children: "Prediction and score" }),
				/* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { children: "No market probability is displayed until its required inputs and calibration evidence are available." })
			] })
		}),
		/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("article", {
			className: "card prediction-blocked",
			children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
				className: "blocked-icon",
				children: "!"
			}), /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { children: [
				/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", {
					className: "pill pill-warn",
					children: "BLOCKED · NO SCORE"
				}),
				/* @__PURE__ */ (0, import_jsx_runtime.jsx)("h3", { children: "Prediction engine is not eligible to publish a score" }),
				/* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { children: "Current connected venue count is 1 CEX. Cross-venue breadth, verified DEX flow, and verified active-wallet flow are missing. Missing inputs are not treated as zero." }),
				/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("ul", { children: [
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)("li", { children: "Connect and validate independent CEX feeds" }),
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)("li", { children: "Build DEX swap event adapters and transaction decoding" }),
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)("li", { children: "Verify wallet ownership, activity windows, and inclusion criteria" }),
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)("li", { children: "Run time-split backtests and calibration before publishing probability" })
				] })
			] })]
		}),
		/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("article", {
			className: "card",
			children: [
				/* @__PURE__ */ (0, import_jsx_runtime.jsx)("h3", { children: "Score and execution gates" }),
				/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
					className: "gate-row",
					children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { children: "Prediction score" }), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("b", {
						className: "status-blocked",
						children: "Unavailable"
					})]
				}),
				/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
					className: "gate-row",
					children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { children: "Spot automatic execution" }), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("b", {
						className: "status-blocked",
						children: "LOCKED · Paper only"
					})]
				}),
				/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
					className: "gate-row",
					children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { children: "Futures automatic execution" }), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("b", {
						className: "status-blocked",
						children: "LOCKED · Paper only"
					})]
				}),
				/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
					className: "gate-row",
					children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { children: "Model calibration" }), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("b", {
						className: "status-blocked",
						children: "No verified observation set"
					})]
				})
			]
		})
	] });
}
function PaperView() {
	const [side, setSide] = (0, import_react.useState)("BUY");
	const [qty, setQty] = (0, import_react.useState)("0.001");
	return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(import_jsx_runtime.Fragment, { children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
		className: "section-intro",
		children: /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { children: [
			/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", {
				className: "eyebrow",
				children: "SIMULATION ONLY"
			}),
			/* @__PURE__ */ (0, import_jsx_runtime.jsx)("h2", { children: "Paper order preview" }),
			/* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { children: "Preview-only widget. It does not persist, route, simulate fills, or transmit orders." })
		] })
	}), /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("article", {
		className: "card paper-card",
		children: [
			/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
				className: "wallet-form",
				children: [
					/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("label", { children: ["Symbol", /* @__PURE__ */ (0, import_jsx_runtime.jsx)("input", {
						value: "BTCUSDT",
						readOnly: true
					})] }),
					/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("label", { children: ["Side", /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("select", {
						value: side,
						onChange: (event) => setSide(event.target.value),
						children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("option", { children: "BUY" }), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("option", { children: "SELL" })]
					})] }),
					/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("label", { children: ["Quantity", /* @__PURE__ */ (0, import_jsx_runtime.jsx)("input", {
						inputMode: "decimal",
						value: qty,
						onChange: (event) => setQty(event.target.value)
					})] })
				]
			}),
			/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
				className: "notice notice-warn",
				children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("b", { children: "Paper mode is preview-only" }), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { children: "A durable paper ledger, fee/slippage model, and fill reconciliation have not been connected to this panel." })]
			}),
			/* @__PURE__ */ (0, import_jsx_runtime.jsx)("pre", { children: JSON.stringify({
				mode: "PAPER_PREVIEW_ONLY",
				symbol: "BTCUSDT",
				side,
				quantity: qty,
				liveTrading: "OFF",
				liveOrdersLocked: true
			}, null, 2) })
		]
	})] });
}
function ReleaseChecklist() {
	return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(import_jsx_runtime.Fragment, { children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
		className: "section-intro",
		children: /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { children: [
			/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", {
				className: "eyebrow",
				children: "ADMIN · RELEASE CHECKLIST"
			}),
			/* @__PURE__ */ (0, import_jsx_runtime.jsx)("h2", { children: "System readiness" }),
			/* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { children: "Live readings below describe this source build; infrastructure checks require the deployment environment and database." })
		] })
	}), /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("article", {
		className: "card",
		children: [
			/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
				className: "notice notice-info",
				children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("b", { children: "Safety configuration" }), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { children: "LIVE_TRADING=OFF · LIVE_ORDERS_LOCKED=true · public market connectors only." })]
			}),
			/* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
				className: "checklist",
				children: [
					"UI build and responsive layout",
					"Market feed freshness + reconnect",
					"DEX source availability",
					"Wallet source provenance + freshness",
					"Model calibration evidence",
					"Live order lock",
					"Database migrations",
					"iOS release",
					"Android release"
				].map((item, index) => /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
					className: "check-row",
					children: [
						/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", {
							className: "check-index",
							children: String(index + 1).padStart(2, "0")
						}),
						/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { children: item }),
						/* @__PURE__ */ (0, import_jsx_runtime.jsx)("b", {
							className: index === 0 || index === 1 ? "status-implemented" : "status-blocked",
							children: index === 0 || index === 1 ? "SOURCE READY · VERIFY AT RUN" : "BLOCKED / NOT CONFIGURED"
						})
					]
				}, item))
			}),
			/* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
				className: "muted tiny",
				children: "Checklist labels are not deployment health attestations. Provider credentials belong server-side and are not stored in this browser panel."
			})
		]
	})] });
}
function AdminView() {
	return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(import_jsx_runtime.Fragment, { children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)(CexDesk, {}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)(ReleaseChecklist, {})] });
}
function EngineWorkspace({ section, onNavigate }) {
	if (section === "Market") return /* @__PURE__ */ (0, import_jsx_runtime.jsx)(MarketView, {});
	if (section === "DEX" || section === "Search") return /* @__PURE__ */ (0, import_jsx_runtime.jsx)(DexView, {});
	if (section === "Wallets") return /* @__PURE__ */ (0, import_jsx_runtime.jsx)(WalletView, {});
	if (section === "Predictions") return /* @__PURE__ */ (0, import_jsx_runtime.jsx)(PredictionsView, {});
	if (section === "Paper") return /* @__PURE__ */ (0, import_jsx_runtime.jsx)(PaperView, {});
	if (section === "Admin") return /* @__PURE__ */ (0, import_jsx_runtime.jsx)(AdminView, {});
	if (section === "Checklist" || section === "Bugs") return /* @__PURE__ */ (0, import_jsx_runtime.jsx)(ReleaseChecklist, {});
	return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(import_jsx_runtime.Fragment, { children: [
		/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
			className: "section-intro",
			children: [/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { children: [
				/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", {
					className: "eyebrow",
					children: "CRYPTO RESEARCH WORKSPACE"
				}),
				/* @__PURE__ */ (0, import_jsx_runtime.jsx)("h2", { children: "Read-only market intelligence" }),
				/* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { children: "Exchange streams, DEX discovery, reviewed address activity, guarded predictions, and paper-only execution." })
			] }), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", {
				className: "pill pill-warn",
				children: "LIVE ORDERS LOCKED"
			})]
		}),
		/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
			className: "grid grid-3",
			children: [
				/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("button", {
					className: "shortcut-card",
					onClick: () => onNavigate("Market"),
					children: [
						/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", {
							className: "shortcut-icon",
							children: "↗"
						}),
						/* @__PURE__ */ (0, import_jsx_runtime.jsx)("b", { children: "Live market feeds" }),
						/* @__PURE__ */ (0, import_jsx_runtime.jsx)("small", { children: "Spot book, trades and futures funding" })
					]
				}),
				/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("button", {
					className: "shortcut-card",
					onClick: () => onNavigate("DEX"),
					children: [
						/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", {
							className: "shortcut-icon",
							children: "◇"
						}),
						/* @__PURE__ */ (0, import_jsx_runtime.jsx)("b", { children: "DEX pair search" }),
						/* @__PURE__ */ (0, import_jsx_runtime.jsx)("small", { children: "Public indexed pairs and liquidity" })
					]
				}),
				/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("button", {
					className: "shortcut-card",
					onClick: () => onNavigate("Wallets"),
					children: [
						/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", {
							className: "shortcut-icon",
							children: "◉"
						}),
						/* @__PURE__ */ (0, import_jsx_runtime.jsx)("b", { children: "Wallet activity" }),
						/* @__PURE__ */ (0, import_jsx_runtime.jsx)("small", { children: "Manual watchlist; unverified until reviewed" })
					]
				})
			]
		}),
		/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
			className: "grid grid-2",
			children: [/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("article", {
				className: "card",
				children: [
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", {
						className: "eyebrow",
						children: "CURRENT CONNECTIONS"
					}),
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)("h3", { children: "One connected exchange" }),
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { children: "Binance Spot and Binance USDⓈ-M are live. The other 14 centralized exchanges are listed for a later public adapter. They are not scored." })
				]
			}), /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("article", {
				className: "card",
				children: [
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", {
						className: "eyebrow",
						children: "PREDICTION STATUS"
					}),
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)("h3", { children: "Score is safely blocked" }),
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { children: "Inputs required for a defensible probability are missing. No synthetic prediction or automatic order can be generated." })
				]
			})]
		})
	] });
}
var SHELL_LANGUAGES = [
	{
		id: "en",
		label: "English",
		lang: "en",
		dir: "ltr",
		parts: ["English", "sample"]
	},
	{
		id: "hi",
		label: "Hindi",
		lang: "hi",
		dir: "ltr",
		parts: ["हिंदी", "अक्षर"]
	},
	{
		id: "ur",
		label: "Urdu",
		lang: "ur",
		dir: "rtl",
		parts: ["اردو", "نمونہ"]
	}
];
function Shell({ checklistMarkup, capabilities, status, environment = null }) {
	const [view, setView] = (0, import_react.useState)(() => {
		const initial = initialClientViewState({
			pageSize: 1,
			status
		});
		if (!initial.ok) throw new Error(initial.error);
		return initial.state;
	});
	const [session, setSession] = (0, import_react.useState)(null);
	const [languageId, setLanguageId] = (0, import_react.useState)("en");
	const language = SHELL_LANGUAGES.find((item) => item.id === languageId) ?? SHELL_LANGUAGES[0];
	const section = view.section;
	const signedRole = session && isDeskRole(session.role) ? session.role : null;
	const allowedSections = signedRole ? deskSections(signedRole) : null;
	const sectionMarkup = renderSectionCapability(signedRole === "Admin" ? {
		editChecklist: true,
		userChecklist: false,
		market: false
	} : signedRole === "User" ? {
		editChecklist: false,
		userChecklist: true,
		market: false
	} : capabilities, section, checklistMarkup);
	const visibleSections = allowedSections ? SHELL_SECTIONS.filter((name) => allowedSections.includes(name)) : SHELL_SECTIONS;
	const adminLocked = (section === "Admin" || section === "Bugs") && signedRole !== "Admin";
	function chooseSection(id) {
		if (id === view.section) return;
		const selected = selectSection(view, id);
		if (!selected.ok) return;
		const paged = setPageIndex(selected.state, 0);
		if (paged.ok) setView(paged.state);
	}
	function applySession(next) {
		setSession(next);
		if (next?.role === "User" && (view.section === "Admin" || view.section === "Bugs")) chooseSection("Dashboard");
		if (next?.role === "Admin") chooseSection("Admin");
	}
	(0, import_react.useEffect)(() => {
		document.documentElement.lang = language.lang;
		document.documentElement.dir = language.dir;
	}, [language.lang, language.dir]);
	return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("main", {
		className: "layout-shell",
		children: [
			/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
				className: "app-masthead",
				children: [
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
						className: "layout-mark",
						children: "crypto-prediction-engine"
					}),
					/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", {
						className: "safety-banner",
						children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("i", {}), "LIVE ORDERS LOCKED"]
					}),
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", {
						className: signedRole === "Admin" ? "pill pill-live" : "pill",
						children: signedRole ? `${signedRole} role` : "Signed out"
					})
				]
			}),
			/* @__PURE__ */ (0, import_jsx_runtime.jsx)(LanguageChoice, {
				label: "Language",
				options: SHELL_LANGUAGES,
				value: language.id,
				onChange: (id) => {
					const match = SHELL_LANGUAGES.find((item) => item.id === id);
					if (match) setLanguageId(match.id);
				}
			}),
			/* @__PURE__ */ (0, import_jsx_runtime.jsx)(LanguageSample, {
				label: "Language sample",
				lang: language.lang,
				dir: language.dir,
				parts: language.parts
			}),
			/* @__PURE__ */ (0, import_jsx_runtime.jsx)(SectionNav, {
				label: "Sections",
				items: visibleSections.map((name) => ({
					id: name,
					label: name,
					pressed: section === name
				})),
				onSelect: chooseSection
			}),
			/* @__PURE__ */ (0, import_jsx_runtime.jsx)(DeskAuth, {
				session,
				onSession: applySession
			}),
			/* @__PURE__ */ (0, import_jsx_runtime.jsxs)(Panel, {
				labelledBy: "section-title",
				children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Heading, {
					id: "section-title",
					children: section
				}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)(SectionErrorBoundary, {
					section,
					environment,
					children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(SectionRequest, {
						section,
						pageSize: 100,
						environment,
						children: adminLocked ? /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("article", {
							className: "card desk-lock",
							children: [
								/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", {
									className: "pill pill-warn",
									children: "ADMIN ONLY"
								}),
								/* @__PURE__ */ (0, import_jsx_runtime.jsx)("h2", { children: "Admin login required" }),
								/* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { children: "यह सेक्शन सिर्फ Admin रोल के लिए है। User रोल इसे नहीं खोल सकता। Live orders locked रहते हैं।" })
							]
						}) : /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(import_jsx_runtime.Fragment, { children: [
							sectionMarkup ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { dangerouslySetInnerHTML: { __html: sectionMarkup } }) : null,
							/* @__PURE__ */ (0, import_jsx_runtime.jsx)(EngineWorkspace, {
								section,
								onNavigate: chooseSection
							}),
							section === "Predictions" ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)(ModelHealthCharts, { bound: 100 }) : null
						] })
					})
				}, section)]
			})
		]
	});
}
function Home() {
	const checklistView = emptyChecklistStatusView();
	const status = parseUserVisibleStatus({
		state: checklistView.state,
		counts: checklistView.counts,
		error: checklistView.error
	});
	if (!status.ok) throw new Error(status.error);
	return /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Shell, {
		checklistMarkup: renderChecklistStatusView(checklistView),
		capabilities: authorizeShell(null, null),
		status: status.status,
		environment: null
	});
}
//#endregion
export { Home as component };
