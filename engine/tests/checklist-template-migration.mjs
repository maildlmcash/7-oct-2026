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

test("template version rows and audit rows remain after a new version", () => {
  for (const name of [
    "../data/migrations/0003_checklist_template_versions_rollback.sql",
    "../data/migrations/0002_checklist_statuses_rollback.sql",
    "../data/migrations/0001_checklist_entities_rollback.sql",
    "../data/migrations/0001_checklist_entities.sql",
    "../data/migrations/0002_checklist_statuses.sql",
    "../data/migrations/0003_checklist_template_versions.sql",
  ]) {
    runFile(name);
  }

  const listed = run(`
    INSERT INTO tenant DEFAULT VALUES RETURNING id \\gset t_
    INSERT INTO project (tenant_id) VALUES (:t_id) RETURNING id \\gset p_
    INSERT INTO checklist_template (
      tenant_id, project_id, area_platform, requirement, test_method, expected_value, version
    ) VALUES (
      :t_id, :p_id, 'mobile iOS', 'ios requirement', 'inspect', 'present', '1'
    ) RETURNING id \\gset first_
    UPDATE checklist_template SET lineage_id = id WHERE id = :first_id;
    INSERT INTO checklist_template (
      tenant_id, project_id, lineage_id, area_platform, requirement, test_method, expected_value, version
    ) VALUES (
      :t_id, :p_id, :first_id, 'mobile iOS', 'ios requirement revised', 'inspect', 'present', '2'
    );
    INSERT INTO audit_record (tenant_id, actor, before_value, after_value, changed_at)
    VALUES (
      :t_id, 'admin-1', '{"version":"1"}', '{"version":"2"}', '2026-10-06T01:00:00Z'
    );
    SELECT string_agg(version, ',' ORDER BY id) || '|' ||
      (SELECT count(*) FROM audit_record WHERE before_value LIKE '%"version":"1"%')::text
    FROM checklist_template
    WHERE lineage_id = :first_id;
  `);
  assert.equal(listed, "1,2|1");

  run(`
    INSERT INTO checklist_template (
      tenant_id, project_id, area_platform, requirement, test_method, expected_value, version
    )
    SELECT tenant_id, id, 'mobile', 'combined', 'inspect', 'present', '1'
    FROM project;
  `);
  const mobileCount = run(`
    SELECT count(*) FROM checklist_template WHERE area_platform = 'mobile';
  `);
  assert.equal(mobileCount, "1");
  run(`DELETE FROM checklist_template WHERE area_platform = 'mobile';`);

  runFile("../data/migrations/0003_checklist_template_versions_rollback.sql");
  const columns = run(`
    SELECT count(*) FROM information_schema.columns
    WHERE table_name = 'checklist_template'
      AND column_name IN ('project_id', 'lineage_id', 'retired_at');
  `);
  assert.equal(columns, "0");

  runFile("../data/migrations/0002_checklist_statuses_rollback.sql");
  runFile("../data/migrations/0001_checklist_entities_rollback.sql");
  assert.equal(run(`SELECT to_regclass('public.checklist_template') IS NULL;`), "t");
});
