import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const forward = new URL("../data/migrations/0007_privileged_audit.sql", import.meta.url);
const rollback = new URL("../data/migrations/0007_privileged_audit_rollback.sql", import.meta.url);
const psql = process.env.PSQL || "psql";
const psqlEnv = { ...process.env, PGOPTIONS: "-c client_min_messages=warning" };

function run(sql) {
  return execFileSync(psql, ["-v", "ON_ERROR_STOP=1", "-X", "-q", "-t", "-A"], {
    cwd: root,
    encoding: "utf8",
    input: sql,
    env: psqlEnv,
    stdio: ["pipe", "pipe", "pipe"],
  }).trim();
}

function runFile(url) {
  execFileSync(psql, ["-v", "ON_ERROR_STOP=1", "-X", "-q", "-f", fileURLToPath(url)], {
    cwd: root,
    encoding: "utf8",
    env: psqlEnv,
    stdio: ["pipe", "pipe", "pipe"],
  });
}

function expectError(sql, pattern) {
  assert.throws(
    () => run(sql),
    (error) => pattern.test(`${error.stderr || ""}\n${error.stdout || ""}\n${error.message}`),
  );
}

test("privileged audit rows are searchable and append-only", () => {
  runFile(rollback);
  runFile(forward);
  const id = run(`
    INSERT INTO privileged_audit (actor, action, target, reason, recorded_at)
    VALUES (
      '22222222-2222-4222-8222-222222222222',
      'checklist.write',
      'item-1',
      'mfa provider is not configured',
      '2026-10-06T00:00:00Z'
    )
    RETURNING id;
  `);
  assert.equal(run(`
    SELECT action || ':' || target
    FROM privileged_audit
    WHERE actor = '22222222-2222-4222-8222-222222222222'
      AND recorded_at = '2026-10-06T00:00:00Z';
  `), "checklist.write:item-1");
  expectError(
    `UPDATE privileged_audit SET reason = 'changed' WHERE id = ${id};`,
    /audit records are append-only/,
  );
  expectError(`DELETE FROM privileged_audit WHERE id = ${id};`, /audit records are append-only/);
  expectError(`TRUNCATE privileged_audit;`, /audit records are append-only/);
  runFile(rollback);
  assert.equal(run(`SELECT to_regclass('public.privileged_audit') IS NULL;`), "t");
});
