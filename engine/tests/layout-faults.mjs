import assert from "node:assert/strict";
import test from "node:test";
import { health } from "../apps/web/health.mjs";
import {
  createLayoutEvidence,
  inspectLayout,
  openLayoutFindings,
  recordLayoutInspection,
  triageFalsePositive,
} from "../services/layout-faults.mjs";

// Pixel sizes match apps/web/tests/layout.spec.ts. They are fixtures, not source requirements.
const MOBILE = { name: "mobile", width: 375, height: 667 };
const DESKTOP = { name: "desktop", width: 1280, height: 800 };
const FIT = { scrollWidth: 375, clientWidth: 375 };
const password = "super-secret-value";

function sample(surface, overrides = {}) {
  return {
    surface,
    viewport: MOBILE,
    document: FIT,
    boxes: [],
    headings: ["Dashboard"],
    expectedHeadings: ["Dashboard"],
    links: [{ id: "section-home", href: "/", status: 200 }],
    ...overrides,
  };
}

test("known layout fixtures are detected with viewport and surface metadata", () => {
  const inspected = inspectLayout(sample("website", {
    document: { scrollWidth: 400, clientWidth: 375 },
    boxes: [
      { id: "nav", x: 0, y: 0, width: 40, height: 40, token: password },
      { id: "panel", x: 10, y: 10, width: 40, height: 40 },
      { id: "wide", x: 370, y: 0, width: 20, height: 20 },
    ],
    headings: [],
    links: [
      { id: "empty-link", href: "", token: password },
      { id: "missing-target", href: `/${password}`, status: 404 },
    ],
  }));
  assert.equal(inspected.ok, true);
  const faults = inspected.findings.map((finding) => finding.fault);
  assert.deepEqual(faults, ["overlap", "overflow", "missing-heading", "broken-link", "broken-link", "mobile-viewport"]);
  for (const finding of inspected.findings) {
    assert.equal(finding.surface, "website");
    assert.deepEqual(finding.viewport, MOBILE);
  }
  assert.deepEqual(inspected.findings[0].evidence, { boxId: "nav", otherBoxId: "panel" });
  assert.deepEqual(inspected.findings[1].evidence, { scrollWidth: 400, clientWidth: 375 });
  assert.deepEqual(inspected.findings[2].evidence, { heading: "Dashboard" });
  assert.deepEqual(inspected.findings[3].evidence, { linkId: "empty-link", reason: "missing-href", httpStatus: null });
  assert.deepEqual(inspected.findings[4].evidence, { linkId: "missing-target", reason: "http-error", httpStatus: 404 });
  assert.deepEqual(inspected.findings[5].evidence, { boxId: "wide", edge: "right" });
  assert.equal(JSON.stringify(inspected.findings).includes(password), false);
  assert.equal(health.liveTrading, "OFF");
  assert.equal(health.liveOrdersLocked, true);
});

test("iOS and Android runs stay distinct from each other and from website runs", () => {
  const overlap = {
    boxes: [
      { id: "nav", x: 0, y: 0, width: 40, height: 40 },
      { id: "panel", x: 10, y: 10, width: 40, height: 40 },
    ],
  };
  const website = inspectLayout(sample("website", overlap));
  const ios = inspectLayout(sample("mobile iOS", overlap));
  const android = inspectLayout(sample("mobile Android", overlap));
  assert.equal(website.findings[0].surface, "website");
  assert.equal(ios.findings[0].surface, "mobile iOS");
  assert.equal(android.findings[0].surface, "mobile Android");
  assert.equal(website.findings[0].viewport.name, "mobile");
  assert.notEqual(ios.findings[0].id, android.findings[0].id);
  assert.notEqual(ios.findings[0].id, website.findings[0].id);
  assert.equal(inspectLayout(sample("mobile", overlap)).error, "mobile lists must be separate");
  assert.equal(inspectLayout(sample("web", overlap)).error, "unknown layout surface");
});

test("a false positive is triaged without deleting raw evidence", () => {
  const log = createLayoutEvidence();
  const ios = inspectLayout(sample("mobile iOS", {
    boxes: [
      { id: "nav", x: 0, y: 0, width: 40, height: 40 },
      { id: "panel", x: 10, y: 10, width: 40, height: 40 },
    ],
  }));
  const android = inspectLayout(sample("mobile Android", {
    headings: [],
  }));
  assert.equal(recordLayoutInspection(log, ios).ok, true);
  assert.equal(recordLayoutInspection(log, android).ok, true);
  const raw = log.findings[0].evidence;
  const marked = triageFalsePositive(log, ios.findings[0].id, "fixture overlap is an accepted sample");
  assert.equal(marked.ok, true);
  assert.equal(log.findings.length, 2);
  assert.equal(log.findings[0].evidence, raw);
  assert.deepEqual(log.findings[0].evidence, { boxId: "nav", otherBoxId: "panel" });
  assert.deepEqual(openLayoutFindings(log).map((finding) => finding.surface), ["mobile Android"]);
  assert.equal(log.triage[0].disposition, "false-positive");
  assert.equal(triageFalsePositive(log, "missing", "no").error, "unknown finding");
  assert.equal(log.triage.length, 1);
  assert.equal(recordLayoutInspection(log, { ok: false, error: "mobile lists must be separate" }).error, "layout inspection is required");
});

test("a clean measurement and a non-mobile edge add no mobile fault", () => {
  const clean = inspectLayout(sample("website"));
  assert.equal(clean.ok, true);
  assert.deepEqual(clean.findings, []);
  const touching = inspectLayout(sample("website", {
    boxes: [
      { id: "left", x: 0, y: 0, width: 10, height: 10 },
      { id: "right", x: 10, y: 0, width: 10, height: 10 },
    ],
  }));
  assert.deepEqual(touching.findings, []);
  const desktop = inspectLayout(sample("mobile iOS", {
    viewport: DESKTOP,
    document: { scrollWidth: 1280, clientWidth: 1280 },
    boxes: [{ id: "wide", x: 1270, y: 0, width: 20, height: 20 }],
  }));
  assert.deepEqual(desktop.findings, []);
  assert.equal(inspectLayout(sample("website", { document: {} })).error, "overflow measurement is required");
  assert.equal(inspectLayout(sample("website", { viewport: { name: "phone", width: 375, height: 667 } })).error, "viewport metadata is required");
});
