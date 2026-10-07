import assert from "node:assert/strict";
import test from "node:test";
import {
  diagnosticEvent,
  resolveCorrelationId,
  shellSectionName,
} from "../apps/web/request-correlation.mjs";

const secret = "super-secret-value";
const knownId = "11111111-1111-4111-8111-111111111111";

test("a UUID correlation id is echoed and any other value is replaced", () => {
  assert.equal(resolveCorrelationId(knownId), knownId);
  assert.equal(resolveCorrelationId(knownId.toUpperCase()), knownId.toUpperCase());
  for (const header of [null, undefined, "", secret, `${knownId} ${secret}`, "not-a-uuid"]) {
    const replaced = resolveCorrelationId(header);
    assert.notEqual(replaced, header);
    assert.equal(replaced.includes(secret), false);
    assert.match(replaced, /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
  }
});

test("a section name is one of the seven shell sections", () => {
  assert.equal(shellSectionName("Dashboard"), "Dashboard");
  assert.equal(shellSectionName("Market"), "Market");
  assert.equal(shellSectionName("dashboard"), null);
  assert.equal(shellSectionName(secret), null);
  assert.equal(shellSectionName(null), null);
});

test("a diagnostic event keeps only correlation, section, route, and status", () => {
  const event = diagnosticEvent({
    correlationId: secret,
    section: secret,
    route: secret,
    httpStatus: secret,
    message: secret,
    stack: secret,
    body: secret,
    authorization: secret,
  });
  assert.deepEqual(Object.keys(event).sort(), ["correlationId", "httpStatus", "route", "section"]);
  assert.equal(JSON.stringify(event).includes(secret), false);
  assert.equal(event.section, null);
  assert.equal(event.route, null);
  assert.equal(event.httpStatus, null);
  assert.match(event.correlationId, /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);

  const traced = diagnosticEvent({
    correlationId: knownId,
    section: "Checklist",
    route: "/api/view-state",
    httpStatus: 500,
  });
  assert.deepEqual(traced, {
    correlationId: knownId,
    section: "Checklist",
    route: "/api/view-state",
    httpStatus: 500,
  });
  assert.equal(
    diagnosticEvent({ correlationId: knownId, section: "Admin", route: "/api/checklist-owner", httpStatus: 403 }).route,
    "/api/checklist-owner",
  );
  assert.equal(
    diagnosticEvent({ correlationId: knownId, section: "Dashboard", route: "section-render", httpStatus: null }).route,
    "section-render",
  );
});
