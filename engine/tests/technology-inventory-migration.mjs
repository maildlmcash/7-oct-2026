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

test("package presence cannot be stored as PASS, and stale usage cannot be stored as PASS", () => {
  for (const name of [
    "../data/migrations/0004_technology_inventory_rollback.sql",
    "../data/migrations/0003_checklist_template_versions_rollback.sql",
    "../data/migrations/0002_checklist_statuses_rollback.sql",
    "../data/migrations/0001_checklist_entities_rollback.sql",
    "../data/migrations/0001_checklist_entities.sql",
    "../data/migrations/0002_checklist_statuses.sql",
    "../data/migrations/0003_checklist_template_versions.sql",
    "../data/migrations/0004_technology_inventory.sql",
  ]) {
    runFile(name);
  }

  const seeded = run(`
    INSERT INTO tenant DEFAULT VALUES RETURNING id \\gset t1_
    INSERT INTO tenant DEFAULT VALUES RETURNING id \\gset t2_
    INSERT INTO checklist_template (
      tenant_id, area_platform, requirement, test_method, expected_value, owner, version
    ) VALUES (
      :t1_id, 'website', 'website requirement', 'inspect', 'present', 'admin-1', '1'
    ) RETURNING id \\gset template_
    INSERT INTO technology_inventory (
      tenant_id, template_id, required_technology, required_version,
      detected_usage_evidence, owner, limit_slo, current_measurement, last_checked_at,
      package_presence, usage_present, usage_kind, evidence_stale, status
    ) VALUES (
      :t1_id, :template_id, 'next', '16.3.8',
      NULL, 'admin-1', NULL, NULL, '2026-10-06T00:00:00Z',
      true, false, NULL, false, 'FAIL'
    );
    INSERT INTO technology_inventory (
      tenant_id, template_id, required_technology, required_version,
      detected_usage_evidence, owner, limit_slo, current_measurement, last_checked_at,
      package_presence, usage_present, usage_kind, evidence_stale, status
    ) VALUES (
      :t1_id, :template_id, 'next', '16.3.8',
      'next-server is running', 'admin-1', NULL, 'process listed next-server', '2026-10-06T00:00:00Z',
      true, true, 'runtime', false, 'PASS'
    );
    INSERT INTO technology_inventory (
      tenant_id, template_id, required_technology, required_version,
      detected_usage_evidence, last_checked_at,
      package_presence, usage_present, usage_kind, evidence_stale, status
    ) VALUES (
      :t1_id, :template_id, 'fastapi', 'UNKNOWN',
      'old process list', '2026-10-06T00:00:00Z',
      false, true, 'runtime', true, 'UNKNOWN/STALE'
    );
    SELECT string_agg(status, ',' ORDER BY id)
    FROM technology_inventory
    WHERE template_id = :template_id;
  `);
  assert.equal(seeded, "FAIL,PASS,UNKNOWN/STALE");

  expectError(`
    INSERT INTO technology_inventory (
      tenant_id, template_id, required_technology, required_version,
      detected_usage_evidence, package_presence, usage_present, usage_kind, evidence_stale, status
    )
    SELECT tenant_id, id, 'next', '16.3.8', 'apps/web/package.json', true, false, NULL, false, 'PASS'
    FROM checklist_template;
  `, /technology_inventory_pass_needs_fresh_usage/);

  expectError(`
    INSERT INTO technology_inventory (
      tenant_id, template_id, required_technology, required_version,
      detected_usage_evidence, package_presence, usage_present, usage_kind, evidence_stale, status
    )
    SELECT tenant_id, id, 'fastapi', 'UNKNOWN', 'old process list', false, true, 'runtime', true, 'PASS'
    FROM checklist_template;
  `, /technology_inventory_pass_needs_fresh_usage/);

  expectError(`
    INSERT INTO technology_inventory (
      tenant_id, template_id, required_technology, required_version,
      package_presence, usage_present, usage_kind, evidence_stale, status
    )
    SELECT tenant_id, id, 'next', '16.3.8', true, true, 'runtime', false, 'active'
    FROM checklist_template;
  `, /technology_inventory_status_known/);

  expectError(`
    INSERT INTO technology_inventory (
      tenant_id, template_id, required_technology, required_version,
      package_presence, usage_present, evidence_stale, status
    )
    SELECT other_tenant.id, checklist_template.id, 'next', '16.3.8', false, false, false, 'FAIL'
    FROM checklist_template
    JOIN tenant AS other_tenant ON other_tenant.id <> checklist_template.tenant_id
    LIMIT 1;
  `, /technology_inventory_template_id_tenant_id_fkey|violates foreign key/);

  runFile("../data/migrations/0004_technology_inventory_rollback.sql");
  assert.equal(run(`SELECT to_regclass('public.technology_inventory') IS NULL;`), "t");

  runFile("../data/migrations/0003_checklist_template_versions_rollback.sql");
  runFile("../data/migrations/0002_checklist_statuses_rollback.sql");
  runFile("../data/migrations/0001_checklist_entities_rollback.sql");
  assert.equal(run(`SELECT to_regclass('public.checklist_template') IS NULL;`), "t");
});
