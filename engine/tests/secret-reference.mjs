import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { test } from "node:test";
import { resolve } from "node:path";
import {
  AUDIT_FIELDS,
  DEPLOYMENT,
  KEY_PERMISSION_CHECKS,
  PERMISSION_SCOPES,
  describeSecretPath,
  listReferences,
  readReference,
  retrieveMaterial,
  revokeReference,
  rotateReference,
  submitSecretMaterial,
} from "../services/secrets/secret-reference.mjs";

const evidenceDir = resolve(import.meta.dirname, "../docs/architecture/evidence/1-d-2");
const SECRET = "super-secret-value";

function leaked(value) {
  return JSON.stringify(value).includes(SECRET);
}

test("secret material is masked, not retrievable, and kept out of logs", async () => {
  const source = await readFile(new URL("../services/secrets/secret-reference.mjs", import.meta.url), "utf8");
  const threat = await readFile(resolve(import.meta.dirname, "../docs/security/secret-reference-threat-model.md"), "utf8");
  const checklist = await readFile(resolve(import.meta.dirname, "../docs/security/key-permission-checklist.md"), "utf8");
  assert.equal(source.includes(SECRET), false);
  assert.equal(source.includes("BEGIN PRIVATE KEY"), false);
  assert.equal(threat.includes(SECRET), false);
  assert.equal(checklist.includes(SECRET), false);
  assert.match(threat, /not retrievable/);
  assert.match(threat, /BLOCKED/);
  assert.match(threat, /UNAVAILABLE/);
  for (const item of KEY_PERMISSION_CHECKS) assert.equal(checklist.includes(item.text), true);
  assert.equal(checklist.includes("withdrawal"), true);
  assert.equal(checklist.includes("BLOCKED"), true);
  assert.equal(checklist.includes("UNAVAILABLE"), true);

  assert.equal(DEPLOYMENT.mode, "PAPER");
  assert.equal(DEPLOYMENT.liveTrading, "OFF");
  assert.equal(DEPLOYMENT.liveOrdersLocked, true);
  assert.equal(DEPLOYMENT.secretWrite, "not enabled");
  const trade = PERMISSION_SCOPES.find((item) => item.scope === "trade");
  const withdrawal = PERMISSION_SCOPES.find((item) => item.scope === "withdrawal");
  assert.equal(trade.state, "UNAVAILABLE");
  assert.equal(withdrawal.state, "BLOCKED");

  const log = [];
  const telemetry = [];
  const submitted = submitSecretMaterial({
    actor: { role: "Admin", tenantId: "desk", password: SECRET, api_secret: SECRET },
    referenceId: "paper-market-read",
    material: SECRET,
    note: `bearer ${SECRET}`,
    log,
    telemetry,
  });
  assert.equal(submitted.ok, false);
  assert.equal(submitted.error, "secret write is not enabled");
  assert.equal(submitted.reference.material, "masked");
  assert.equal(submitted.reference.stored, false);
  assert.equal(leaked(submitted), false);
  assert.equal(leaked(log), false);
  assert.equal(leaked(telemetry), false);
  assert.deepEqual(Object.keys(log[0]), [...AUDIT_FIELDS]);
  assert.deepEqual(Object.keys(telemetry[0]).sort(), ["action", "decision", "reason", "source", "target"]);
  assert.equal(telemetry[0].source, "secret-reference");

  const asId = submitSecretMaterial({
    actor: { role: "Admin", tenantId: "desk" },
    referenceId: SECRET,
    material: SECRET,
    log,
    telemetry,
  });
  assert.equal(asId.ok, false);
  assert.equal(asId.reference, null);
  assert.equal(log.at(-1).target, "none");
  assert.equal(leaked(log), false);
  assert.equal(leaked(telemetry), false);

  const customer = submitSecretMaterial({
    actor: { role: "Customer", tenantId: "desk", material: SECRET },
    referenceId: "paper-desk-session",
    material: SECRET,
    log,
    telemetry,
  });
  assert.equal(customer.error, "role scope denied");
  assert.equal(leaked(log), false);

  const elevated = submitSecretMaterial({
    actor: { role: "Super Admin", tenantId: "desk" },
    material: SECRET,
    log,
    telemetry,
  });
  assert.equal(elevated.error, "role scope denied");

  const read = readReference("paper-market-read");
  assert.equal(read.reference.material, "masked");
  assert.equal(read.reference.kmsKey, "not configured");
  assert.equal(leaked(read), false);
  const retrieved = retrieveMaterial(SECRET);
  assert.equal(retrieved.ok, false);
  assert.equal(retrieved.error, "secret material is not retrievable");
  assert.equal(retrieved.material, null);
  assert.equal(leaked(retrieved), false);
  assert.equal(leaked(listReferences()), false);

  const rotated = rotateReference({
    actor: { role: "Admin", tenantId: "desk" },
    referenceId: "paper-market-read",
    material: SECRET,
    log,
    telemetry,
  });
  assert.equal(rotated.error, "rotation is not enabled");
  assert.equal(rotated.reference, null);
  assert.equal(leaked(log), false);
  assert.equal(leaked(telemetry), false);

  const revoked = revokeReference({
    actor: { role: "Admin", tenantId: "desk" },
    referenceId: "paper-market-read",
    material: SECRET,
    log,
    telemetry,
  });
  assert.equal(revoked.ok, true);
  assert.equal(revoked.reference.revocation, "revoked");
  assert.equal(revoked.reference.material, "masked");
  assert.equal(revoked.reference.stored, false);
  assert.equal(leaked(revoked), false);
  assert.equal(leaked(log), false);
  assert.equal(leaked(telemetry), false);
  assert.equal(readReference("paper-market-read").reference.revocation, "revoked");

  const path = describeSecretPath();
  assert.equal(path.kmsKey, "not configured");
  assert.equal(path.write, "not enabled");
  assert.equal(path.read, "not retrievable");
  assert.equal(path.rotation, "not enabled");
  assert.equal(path.revocation, "metadata only");
  assert.deepEqual([...path.audit], ["actor", "action", "target", "decision", "reason"]);

  const evidence = {
    task: "1.D.2",
    date: "2026-10-07",
    truth: "MOCK",
    deployment: DEPLOYMENT.mode,
    write: "not enabled",
    material: "masked",
    retrievable: false,
    logFields: [...AUDIT_FIELDS],
    telemetryFields: Object.keys(telemetry[0]).sort(),
    logContainsMaterial: false,
    telemetryContainsMaterial: false,
    readContainsMaterial: false,
    scopes: PERMISSION_SCOPES,
    checks: KEY_PERMISSION_CHECKS.map((item) => ({ text: item.text, state: item.state })),
    threatModel: "docs/security/secret-reference-threat-model.md",
    checklist: "docs/security/key-permission-checklist.md",
  };
  const body = JSON.stringify(evidence);
  assert.equal(body.includes(SECRET), false);
  await mkdir(evidenceDir, { recursive: true });
  await writeFile(resolve(evidenceDir, "redaction-tests.json"), `${JSON.stringify(evidence, null, 2)}\n`);
});
