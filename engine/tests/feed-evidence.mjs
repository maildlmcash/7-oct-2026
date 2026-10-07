import assert from "node:assert/strict";
import { test } from "node:test";
import { observationLabel } from "../apps/web/app/feed-evidence.mjs";

test("LIVE requires a source and an ISO last-seen time", () => {
  const seenAt = Date.parse("2026-10-07T12:00:00.000Z");
  const ready = observationLabel("live", "wss://example.test/stream", seenAt);
  assert.equal(ready.verified, true);
  assert.equal(ready.text, "LIVE · wss://example.test/stream · 2026-10-07T12:00:00.000Z");

  const missingTime = observationLabel("live", "wss://example.test/stream", null);
  assert.equal(missingTime.verified, false);
  assert.equal(missingTime.text.includes("LIVE"), false);

  const missingSource = observationLabel("live", "  ", seenAt);
  assert.equal(missingSource.verified, false);
  assert.equal(missingSource.text, "NOT VERIFIED");

  assert.equal(observationLabel("connecting", "wss://example.test/stream", null).text, "CONNECTING");
  assert.equal(observationLabel("error", "wss://example.test/stream", null).text, "ERROR");
  assert.equal(observationLabel("reconnecting", "wss://example.test/stream", seenAt).text, "RECONNECTING");
});
