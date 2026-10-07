import { i as __toESM } from "../_runtime.mjs";
import { K as require_react, b as require_jsx_runtime } from "../_libs/@tanstack/react-router+[...].mjs";
import { a as recordPageHealth, c as diagnosticEvent, d as initialClientViewState, f as parseUserVisibleStatus, i as isDeskRole, l as resolveCorrelationId, m as setPageIndex, n as DESK_ROLE_ACCESS, o as CORRELATION_HEADER, p as selectSection, r as deskSections, s as SECTION_HEADER, u as SHELL_SECTIONS } from "./router-BXJ91u3h.mjs";
//#region node_modules/.nitro/vite/services/ssr/assets/routes-T1hyOanx.js
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
			setState((s) => ({
				...s,
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
	if (!input || typeof input !== "object") return null;
	const event = input.data ?? input;
	if (typeof event.s !== "string") return null;
	if (event.e === "trade" && typeof event.p === "string" && typeof event.q === "string" && typeof event.T === "number") {
		const base = prior ?? {
			bid: "—",
			bidQty: "—",
			ask: "—",
			askQty: "—",
			trades: []
		};
		return {
			...base,
			trades: [{
				price: event.p,
				qty: event.q,
				buyerMaker: event.m === true,
				time: event.T
			}, ...base.trades].slice(0, 12)
		};
	}
	if (typeof event.b === "string" && typeof event.B === "string" && typeof event.a === "string" && typeof event.A === "string") return {
		...prior ?? {
			bid: "—",
			bidQty: "—",
			ask: "—",
			askQty: "—",
			trades: []
		},
		bid: event.b,
		bidQty: event.B,
		ask: event.a,
		askQty: event.A
	};
	return null;
}
function parseFuture(input) {
	if (!input || typeof input !== "object") return null;
	const event = input.data ?? input;
	if (typeof event.p !== "string" || typeof event.i !== "string" || typeof event.r !== "string" || typeof event.T !== "number") return null;
	return {
		mark: event.p,
		index: event.i,
		funding: event.r,
		nextFunding: event.T
	};
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
	const values = [...trades].reverse().map((t) => Number(t.price)).filter(Number.isFinite);
	if (values.length < 2) return /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
		className: "spark-empty",
		children: "Waiting for valid price events."
	});
	const low = Math.min(...values);
	const high = Math.max(...values);
	const range = high - low || Math.max(high * 1e-5, 1);
	const points = values.map((value, i) => `${i / (values.length - 1) * 520},${108 - (value - low) / range * 92}`).join(" ");
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
function MarketView() {
	const [symbolInput, setSymbolInput] = (0, import_react.useState)("BTCUSDT");
	const [symbol, setSymbol] = (0, import_react.useState)("BTCUSDT");
	const safeSymbol = /^[A-Z0-9]{5,20}$/.test(symbol) ? symbol.toLowerCase() : "btcusdt";
	const spotUrl = `wss://data-stream.binance.vision:443/stream?streams=${safeSymbol}@trade/${safeSymbol}@bookTicker`;
	const futuresUrl = `wss://fstream.binance.com/market/stream?streams=${safeSymbol}@markPrice@1s`;
	const spot = useSocketFeed(spotUrl, parseSpot);
	const future = useSocketFeed(futuresUrl, parseFuture);
	const spread = spot.value && spot.value.bid !== "—" && spot.value.ask !== "—" ? (Number(spot.value.ask) - Number(spot.value.bid)).toPrecision(7) : null;
	const buyQty = spot.value?.trades.filter((x) => !x.buyerMaker).reduce((s, x) => s + Number(x.qty), 0) ?? 0;
	const sellQty = spot.value?.trades.filter((x) => x.buyerMaker).reduce((s, x) => s + Number(x.qty), 0) ?? 0;
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
				onSubmit: (e) => {
					e.preventDefault();
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
						onChange: (e) => setSymbolInput(e.target.value),
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
						children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { children: "Recent trade imbalance (12 prints)" }), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("b", { children: buyQty + sellQty > 0 ? `${((buyQty - sellQty) / (buyQty + sellQty) * 100).toFixed(1)}%` : "—" })]
					}),
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)(PriceSparkline, { trades: spot.value?.trades ?? [] }),
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)("h4", { children: "Recent trades" }),
					spot.value?.trades.length ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
						className: "table-scroll",
						children: /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("table", { children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("thead", { children: /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("tr", { children: [
							/* @__PURE__ */ (0, import_jsx_runtime.jsx)("th", { children: "Time (UTC)" }),
							/* @__PURE__ */ (0, import_jsx_runtime.jsx)("th", { children: "Price" }),
							/* @__PURE__ */ (0, import_jsx_runtime.jsx)("th", { children: "Quantity" }),
							/* @__PURE__ */ (0, import_jsx_runtime.jsx)("th", { children: "Taker" })
						] }) }), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("tbody", { children: spot.value.trades.map((t, i) => /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("tr", { children: [
							/* @__PURE__ */ (0, import_jsx_runtime.jsx)("td", { children: new Date(t.time).toLocaleTimeString() }),
							/* @__PURE__ */ (0, import_jsx_runtime.jsx)("td", { children: t.price }),
							/* @__PURE__ */ (0, import_jsx_runtime.jsx)("td", { children: t.qty }),
							/* @__PURE__ */ (0, import_jsx_runtime.jsx)("td", { children: t.buyerMaker ? "Sell" : "Buy" })
						] }, `${t.time}-${i}`)) })] })
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
								children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("small", { children: "FUNDING RATE" }), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("strong", { children: future.value?.funding ?? "—" })]
							}),
							/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
								className: "metric",
								children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("small", { children: "NEXT FUNDING" }), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("strong", { children: future.value ? new Date(future.value.nextFunding).toLocaleTimeString() : "—" })]
							})
						]
					}),
					/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
						className: "notice notice-warn",
						children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("b", { children: "Live futures trading: LOCKED" }), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { children: "This panel reads public data only. No order placement or account stream is enabled." })]
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
						children: ["1 ", /* @__PURE__ */ (0, import_jsx_runtime.jsx)("small", { children: "/ 30 planned venue adapters" })]
					})]
				}),
				/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
					className: "coverage-list",
					children: [
						/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", {
							className: "coverage-ok",
							children: "● Binance Spot — public adapter implemented"
						}),
						/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", {
							className: "coverage-ok",
							children: "● Binance USDⓈ-M — public adapter implemented"
						}),
						/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", {
							className: "coverage-off",
							children: "○ 14 other CEX venues — unconfigured"
						}),
						/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", {
							className: "coverage-off",
							children: "○ 15 DEX venue adapters — not implemented"
						})
					]
				}),
				/* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
					className: "muted tiny",
					children: "The 15 CEX / 15 DEX targets are capacity goals, not current integrations. Two Binance market streams come from the same exchange venue. Use each feed status above to see actual live connection health."
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
			const res = await fetch(`/api/dex/search?q=${encodeURIComponent(query)}`, { cache: "no-store" });
			const data = await res.json();
			if (!res.ok || !data.ok) throw new Error(data.error ?? "Search failed.");
			setPairs(data.pairs);
			setStatus("ready");
		} catch (e) {
			setError(e instanceof Error ? e.message : "DEX search failed.");
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
							onChange: (e) => setQuery(e.target.value),
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
					] }) }), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("tbody", { children: pairs.map((p) => /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("tr", { children: [
						/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("td", { children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("b", { children: p.chain }), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("small", {
							className: "block",
							children: p.dex
						})] }),
						/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("td", { children: [
							p.base,
							"/",
							p.quote,
							/* @__PURE__ */ (0, import_jsx_runtime.jsx)("small", {
								className: "block mono",
								children: p.pairAddress
							})
						] }),
						/* @__PURE__ */ (0, import_jsx_runtime.jsx)("td", { children: p.priceUsd ?? "—" }),
						/* @__PURE__ */ (0, import_jsx_runtime.jsx)("td", { children: p.liquidityUsd?.toLocaleString() ?? "—" }),
						/* @__PURE__ */ (0, import_jsx_runtime.jsx)("td", { children: p.volume24hUsd?.toLocaleString() ?? "—" }),
						/* @__PURE__ */ (0, import_jsx_runtime.jsx)("td", { children: p.url ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("a", {
							href: p.url,
							target: "_blank",
							rel: "noreferrer",
							children: "Open ↗"
						}) : "—" })
					] }, `${p.chain}-${p.pairAddress}`)) })] })
				})
			]
		}),
		/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
			className: "notice notice-info",
			children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("b", { children: "Scope" }), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { children: "DEX search returns a bounded list of indexed pairs. It does not decode swaps, establish wallet ownership, or submit trades. DEX WebSocket adapters remain a separate integration task." })]
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
		if (!watchlist.some((x) => x.toLowerCase() === cleaned.toLowerCase()) && watchlist.length >= 15) {
			setError("The local watchlist is limited to 15 entries.");
			return;
		}
		setLoading(true);
		setError("");
		try {
			const list = [...watchlist.filter((x) => x.toLowerCase() !== cleaned.toLowerCase()), cleaned];
			setWatchlist(list);
			localStorage.setItem("cpe-wallet-watchlist", JSON.stringify(list));
			const res = await fetch(`/api/wallets/activity?chain=${chain}&address=${cleaned}`, { cache: "no-store" });
			const value = await res.json();
			if (!res.ok || !value.ok) throw new Error(value.error ?? "Explorer request failed.");
			setData(value);
		} catch (e) {
			setError(e instanceof Error ? e.message : "Wallet lookup failed.");
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
							onChange: (e) => setChain(e.target.value),
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
								onChange: (e) => setAddress(e.target.value),
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
					children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("b", { children: "Whale verification: NOT ESTABLISHED" }), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { children: "No preloaded wallets, labels, balances, or inactivity claims are fabricated. Add an address you have independently reviewed. Current adapter displays recent normal transactions only." })]
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
						children: [data.transactions.length, " recent explorer transactions. Inactivity threshold and whale eligibility still require a separate verified policy."]
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
						] }) }), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("tbody", { children: data.transactions.map((t) => /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("tr", { children: [
							/* @__PURE__ */ (0, import_jsx_runtime.jsx)("td", { children: t.timestamp ? new Date(t.timestamp).toLocaleString() : "—" }),
							/* @__PURE__ */ (0, import_jsx_runtime.jsx)("td", { children: t.method ?? "Transfer / contract call" }),
							/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("td", {
								className: "mono",
								children: [t.from?.slice(0, 8) ?? "—", "…"]
							}),
							/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("td", {
								className: "mono",
								children: [t.to?.slice(0, 8) ?? "—", "…"]
							}),
							/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("td", {
								className: "mono",
								children: [t.hash.slice(0, 12), "…"]
							}),
							/* @__PURE__ */ (0, import_jsx_runtime.jsx)("td", { children: t.status })
						] }, t.hash)) })] })
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
						onChange: (e) => setSide(e.target.value),
						children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("option", { children: "BUY" }), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("option", { children: "SELL" })]
					})] }),
					/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("label", { children: ["Quantity", /* @__PURE__ */ (0, import_jsx_runtime.jsx)("input", {
						inputMode: "decimal",
						value: qty,
						onChange: (e) => setQty(e.target.value)
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
function AdminView() {
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
				].map((item, i) => /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
					className: "check-row",
					children: [
						/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", {
							className: "check-index",
							children: String(i + 1).padStart(2, "0")
						}),
						/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { children: item }),
						/* @__PURE__ */ (0, import_jsx_runtime.jsx)("b", {
							className: i === 0 || i === 1 ? "status-implemented" : "status-blocked",
							children: i === 0 || i === 1 ? "SOURCE READY · VERIFY AT RUN" : "BLOCKED / NOT CONFIGURED"
						})
					]
				}, item))
			}),
			/* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
				className: "muted tiny",
				children: "Checklist labels are not deployment health attestations. Provider credentials belong server-side and are not editable or stored in this browser panel."
			})
		]
	})] });
}
function EngineWorkspace({ section, onNavigate }) {
	if (section === "Market") return /* @__PURE__ */ (0, import_jsx_runtime.jsx)(MarketView, {});
	if (section === "DEX" || section === "Search") return /* @__PURE__ */ (0, import_jsx_runtime.jsx)(DexView, {});
	if (section === "Wallets") return /* @__PURE__ */ (0, import_jsx_runtime.jsx)(WalletView, {});
	if (section === "Predictions") return /* @__PURE__ */ (0, import_jsx_runtime.jsx)(PredictionsView, {});
	if (section === "Paper") return /* @__PURE__ */ (0, import_jsx_runtime.jsx)(PaperView, {});
	if (section === "Admin" || section === "Checklist" || section === "Bugs") return /* @__PURE__ */ (0, import_jsx_runtime.jsx)(AdminView, {});
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
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)("h3", { children: "Two public market streams" }),
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { children: "Binance Spot and Binance USDⓈ-M Futures. Remaining exchange slots are unconfigured and not included in scoring." })
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
