import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
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

function runFile(name) {
  execFileSync(psql, ["-v", "ON_ERROR_STOP=1", "-X", "-q", "-f", fileURLToPath(new URL(name, import.meta.url))], {
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

test("manual and scheduled runs require environment and build SHA, and evidence stays immutable", () => {
  for (const name of [
    "../data/migrations/0005_checklist_runs_rollback.sql",
    "../data/migrations/0004_technology_inventory_rollback.sql",
    "../data/migrations/0003_checklist_template_versions_rollback.sql",
    "../data/migrations/0002_checklist_statuses_rollback.sql",
    "../data/migrations/0001_checklist_entities_rollback.sql",
    "../data/migrations/0001_checklist_entities.sql",
    "../data/migrations/0002_checklist_statuses.sql",
    "../data/migrations/0003_checklist_template_versions.sql",
    "../data/migrations/0004_technology_inventory.sql",
    "../data/migrations/0005_checklist_runs.sql",
  ]) {
    runFile(name);
  }

  const seeded = run(`
    INSERT INTO tenant DEFAULT VALUES RETURNING id \\gset t_
    INSERT INTO project (tenant_id) VALUES (:t_id) RETURNING id \\gset p_
    INSERT INTO checklist_item (
      tenant_id, project_id, phase_id, title, scope, status, enabled
    ) VALUES (
      :t_id, :p_id, '02.C', 'run item', 'web', 'NOT_STARTED', true
    ) RETURNING id \\gset item_
    INSERT INTO check_run (
      tenant_id, checklist_item_id, environment, build_sha, started_at, ended_at,
      result, run_path, destructive_enabled, isolated_test_environment
    ) VALUES (
      :t_id, :item_id, 'local', 'abc123', '2026-10-06T00:00:00Z', '2026-10-06T00:05:00Z',
      'NOT_STARTED', 'manual', false, false
    ) RETURNING id \\gset manual_
    INSERT INTO check_run (
      tenant_id, checklist_item_id, environment, build_sha, started_at, ended_at,
      result, run_path, destructive_enabled, isolated_test_environment
    ) VALUES (
      :t_id, :item_id, 'local', 'abc123', '2026-10-06T00:00:00Z', '2026-10-06T00:05:00Z',
      'NOT_STARTED', 'scheduled', false, false
    );
    INSERT INTO check_run (
      tenant_id, checklist_item_id, environment, build_sha, started_at,
      result, run_path, destructive_enabled, isolated_test_environment
    ) VALUES (
      :t_id, :item_id, 'isolated-test', 'abc123', '2026-10-06T02:00:00Z',
      'NOT_STARTED', 'manual', true, true
    );
    INSERT INTO evidence (tenant_id, check_run_id, url)
    VALUES (:t_id, :manual_id, 'file://run-evidence');
    SELECT string_agg(run_path, ',' ORDER BY id) FROM check_run;
  `);
  assert.equal(seeded, "manual,scheduled,manual");

  expectError(`
    INSERT INTO check_run (
      tenant_id, checklist_item_id, environment, build_sha, started_at, result, run_path
    )
    SELECT tenant_id, id, 'local', 'abc123', '2026-10-06T00:00:00Z', 'NOT_STARTED', 'manual'
    FROM checklist_item;
  `, /check_run_request_once/);

  expectError(`
    INSERT INTO check_run (
      tenant_id, checklist_item_id, environment, build_sha, started_at, result, run_path
    )
    SELECT tenant_id, id, ' ', 'abc123', '2026-10-06T03:00:00Z', 'NOT_STARTED', 'scheduled'
    FROM checklist_item;
  `, /check_run_request_fields/);

  expectError(`
    INSERT INTO check_run (
      tenant_id, checklist_item_id, build_sha, started_at, result, run_path
    )
    SELECT tenant_id, id, 'abc123', '2026-10-06T03:00:00Z', 'NOT_STARTED', 'manual'
    FROM checklist_item;
  `, /check_run_request_fields/);

  expectError(`
    INSERT INTO check_run (
      tenant_id, checklist_item_id, environment, build_sha, started_at, result,
      run_path, destructive_enabled, isolated_test_environment
    )
    SELECT tenant_id, id, 'test', 'abc123', '2026-10-06T04:00:00Z', 'NOT_STARTED',
      'scheduled', true, false
    FROM checklist_item;
  `, /check_run_destructive_isolated/);

  expectError(`
    UPDATE evidence SET url = 'file://changed' WHERE check_run_id IS NOT NULL;
  `, /evidence references are immutable/);

  expectError(`
    DELETE FROM evidence WHERE check_run_id IS NOT NULL;
  `, /evidence references are immutable/);

  expectError(`
    UPDATE check_run SET evidence_url = 'file://changed' WHERE run_path = 'manual';
  `, /evidence references are immutable/);

  runFile("../data/migrations/0005_checklist_runs_rollback.sql");
  const columns = run(`
    SELECT count(*) FROM information_schema.columns
    WHERE table_name = 'check_run'
      AND column_name IN ('run_path', 'destructive_enabled', 'isolated_test_environment');
  `);
  assert.equal(columns, "0");

  runFile("../data/migrations/0004_technology_inventory_rollback.sql");
  runFile("../data/migrations/0003_checklist_template_versions_rollback.sql");
  runFile("../data/migrations/0002_checklist_statuses_rollback.sql");
  runFile("../data/migrations/0001_checklist_entities_rollback.sql");
  assert.equal(run(`SELECT to_regclass('public.check_run') IS NULL;`), "t");
});
