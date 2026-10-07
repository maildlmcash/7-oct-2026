import { CHECKLIST_AREAS } from "./checklist-templates.mjs";

// Website, mobile iOS, and mobile Android are the existing checklist areas for these runs.
// A combined "mobile" value stays rejected by the same rule as checklist templates.
export const LAYOUT_SURFACES = Object.freeze(
  CHECKLIST_AREAS.filter((area) => area === "website" || area === "mobile iOS" || area === "mobile Android"),
);
// The shell layout test already names these three viewport classes. Pixel sizes stay caller-supplied.
export const LAYOUT_VIEWPORT_NAMES = Object.freeze(["mobile", "tablet", "desktop"]);
export const LAYOUT_FAULT_NAMES = Object.freeze([
  "overlap",
  "overflow",
  "missing-heading",
  "broken-link",
  "mobile-viewport",
]);

const SURFACE_SET = new Set(LAYOUT_SURFACES);
const VIEWPORT_SET = new Set(LAYOUT_VIEWPORT_NAMES);
// Same 1px allowance as apps/web/tests/layout.spec.ts. The source names no pixel gap.
const EDGE = 1;

function knownViewport(value) {
  if (!value || typeof value !== "object") return null;
  if (!VIEWPORT_SET.has(value.name)) return null;
  if (!Number.isInteger(value.width) || value.width <= 0) return null;
  if (!Number.isInteger(value.height) || value.height <= 0) return null;
  return { name: value.name, width: value.width, height: value.height };
}

function knownDocument(value) {
  if (!value || typeof value !== "object") return null;
  const { scrollWidth, clientWidth } = value;
  if (!Number.isFinite(scrollWidth) || !Number.isFinite(clientWidth)) return null;
  if (scrollWidth < 0 || clientWidth < 0) return null;
  return { scrollWidth, clientWidth };
}

function knownBoxes(value) {
  if (!Array.isArray(value)) return { ok: false, error: "invalid layout box" };
  const boxes = [];
  for (const box of value) {
    if (!box || typeof box.id !== "string" || box.id.length === 0) {
      return { ok: false, error: "invalid layout box" };
    }
    const { x, y, width, height } = box;
    if (![x, y, width, height].every((item) => typeof item === "number" && Number.isFinite(item))) {
      return { ok: false, error: "invalid layout box" };
    }
    if (width <= 0 || height <= 0) continue;
    boxes.push({ id: box.id, x, y, width, height });
  }
  return { ok: true, boxes };
}

function knownStrings(value) {
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
    return { ok: false, error: "invalid heading" };
  }
  return { ok: true, values: value };
}

function knownLinks(value) {
  if (!Array.isArray(value)) return { ok: false, error: "invalid layout link" };
  const links = [];
  for (const link of value) {
    if (!link || typeof link.id !== "string" || link.id.length === 0) {
      return { ok: false, error: "invalid layout link" };
    }
    const href = typeof link.href === "string" ? link.href.trim() : "";
    const status = Number.isInteger(link.status) && link.status >= 400 && link.status <= 599 ? link.status : null;
    let reason = null;
    if (href.length === 0) reason = "missing-href";
    else if (status !== null) reason = "http-error";
    links.push({ id: link.id, reason, httpStatus: reason === "http-error" ? status : null });
  }
  return { ok: true, links };
}

function overlaps(a, b) {
  return (
    a.x + a.width > b.x + EDGE &&
    b.x + b.width > a.x + EDGE &&
    a.y + a.height > b.y + EDGE &&
    b.y + b.height > a.y + EDGE
  );
}

function outsideEdge(box, viewport) {
  if (box.x < -EDGE) return "left";
  if (box.y < -EDGE) return "top";
  if (box.x + box.width > viewport.width + EDGE) return "right";
  if (box.y + box.height > viewport.height + EDGE) return "bottom";
  return null;
}

export function inspectLayout(input) {
  const source = input && typeof input === "object" ? input : {};
  if (source.surface === "mobile") return { ok: false, error: "mobile lists must be separate" };
  if (!SURFACE_SET.has(source.surface)) return { ok: false, error: "unknown layout surface" };
  const viewport = knownViewport(source.viewport);
  if (!viewport) return { ok: false, error: "viewport metadata is required" };
  const measured = knownDocument(source.document);
  if (!measured) return { ok: false, error: "overflow measurement is required" };
  const boxes = knownBoxes(source.boxes ?? []);
  if (!boxes.ok) return boxes;
  const headings = knownStrings(source.headings ?? []);
  if (!headings.ok) return headings;
  const expected = knownStrings(source.expectedHeadings ?? []);
  if (!expected.ok) return expected;
  const links = knownLinks(source.links ?? []);
  if (!links.ok) return links;

  const view = Object.freeze({ name: viewport.name, width: viewport.width, height: viewport.height });
  const findings = [];
  const push = (fault, evidence) => {
    findings.push(Object.freeze({
      id: `${source.surface}:${viewport.name}:${fault}:${findings.length + 1}`,
      surface: source.surface,
      viewport: view,
      fault,
      evidence: Object.freeze(evidence),
    }));
  };

  for (let i = 0; i < boxes.boxes.length; i += 1) {
    for (let j = i + 1; j < boxes.boxes.length; j += 1) {
      if (!overlaps(boxes.boxes[i], boxes.boxes[j])) continue;
      push("overlap", { boxId: boxes.boxes[i].id, otherBoxId: boxes.boxes[j].id });
    }
  }
  if (measured.scrollWidth > measured.clientWidth) {
    push("overflow", { scrollWidth: measured.scrollWidth, clientWidth: measured.clientWidth });
  }
  for (const heading of expected.values) {
    if (!headings.values.includes(heading)) push("missing-heading", { heading });
  }
  for (const link of links.links) {
    if (!link.reason) continue;
    push("broken-link", { linkId: link.id, reason: link.reason, httpStatus: link.httpStatus });
  }
  if (viewport.name === "mobile") {
    for (const box of boxes.boxes) {
      const edge = outsideEdge(box, viewport);
      if (edge) push("mobile-viewport", { boxId: box.id, edge });
    }
  }

  return { ok: true, findings: Object.freeze(findings) };
}

export function createLayoutEvidence() {
  return { findings: [], triage: [] };
}

export function recordLayoutInspection(log, inspection) {
  if (!inspection || inspection.ok !== true || !Array.isArray(inspection.findings)) {
    return { ok: false, error: "layout inspection is required" };
  }
  const ids = new Set(log.findings.map((finding) => finding.id));
  for (const finding of inspection.findings) {
    if (ids.has(finding.id)) return { ok: false, error: "duplicate finding" };
    ids.add(finding.id);
  }
  for (const finding of inspection.findings) log.findings.push(finding);
  return { ok: true };
}

export function triageFalsePositive(log, findingId, reason) {
  if (typeof findingId !== "string" || !log.findings.some((finding) => finding.id === findingId)) {
    return { ok: false, error: "unknown finding" };
  }
  if (reason != null && typeof reason !== "string") return { ok: false, error: "triage reason must be text" };
  log.triage.push(Object.freeze({
    findingId,
    disposition: "false-positive",
    reason: typeof reason === "string" ? reason : null,
  }));
  return { ok: true };
}

export function openLayoutFindings(log) {
  const hidden = new Set(
    log.triage
      .filter((note) => note.disposition === "false-positive")
      .map((note) => note.findingId),
  );
  return log.findings.filter((finding) => !hidden.has(finding.id));
}
