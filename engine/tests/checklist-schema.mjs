import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const forward = new URL("../data/migrations/0001_checklist_entities.sql", import.meta.url);
const rollback = new URL("../data/migrations/0001_checklist_entities_rollback.sql", import.meta.url);
const psql = process.env.PSQL || "psql";

const psqlEnv = {
  ...process.env,
  PGOPTIONS: "-c client_min_messages=warning",
};

function run(sql) {
  return execFileSync(
    psql,
    ["-v", "ON_ERROR_STOP=1", "-X", "-q", "-t", "-A", "-v", "VERBOSITY=verbose"],
    { cwd: root, encoding: "utf8", input: sql, env: psqlEnv, stdio: ["pipe", "pipe", "pipe"] },
  ).trim();
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

test("checklist schema constraints, tenant keys, forward, and rollback", () => {
  runFile(rollback);
  runFile(forward);

  const seeded = run(`
    INSERT INTO tenant DEFAULT VALUES RETURNING id \\gset t1_
    INSERT INTO tenant DEFAULT VALUES RETURNING id \\gset t2_
    INSERT INTO project (tenant_id) VALUES (:t1_id) RETURNING id \\gset p1_
    INSERT INTO project (tenant_id) VALUES (:t1_id) RETURNING id \\gset p2_
    INSERT INTO checklist_template (
      tenant_id, area_platform, requirement, test_method, expected_value, version
    ) VALUES (
      :t1_id, 'web', 'schema', 'migration test', 'constraints hold', '1'
    ) RETURNING id \\gset tpl_
    INSERT INTO checklist_item (
      tenant_id, project_id, phase_id, template_id, title, scope, status, enabled
    ) VALUES (
      :t1_id, :p1_id, '02.A', :tpl_id, 'entities', 'web', 'NOT_STARTED', true
    ) RETURNING id \\gset item_
    INSERT INTO checklist_item (
      tenant_id, project_id, parent_id, phase_id, title, scope, status, enabled
    ) VALUES (
      :t1_id, :p1_id, :item_id, '02.A', 'child', 'web', 'NOT_STARTED', true
    ) RETURNING id \\gset child_
    INSERT INTO finding (
      tenant_id, checklist_item_id, dedupe_fingerprint, first_seen, last_seen,
      seen_count, status
    ) VALUES (
      :t1_id, :item_id, 'schema-gap', '2026-10-05T00:00:00Z', '2026-10-05T00:00:00Z',
      1, 'FAIL'
    ) RETURNING id \\gset finding_
    INSERT INTO check_run (
      tenant_id, checklist_item_id, build_sha, result
    ) VALUES (
      :t1_id, :item_id, 'test', 'FAIL'
    ) RETURNING id \\gset run_
    INSERT INTO evidence (tenant_id, check_run_id, finding_id, url) VALUES (
      :t1_id, :run_id, :finding_id, 'file://evidence'
    );
    INSERT INTO audit_record (tenant_id, actor, before_value, after_value, changed_at)
    VALUES (:t1_id, 'tester', NULL, 'created', '2026-10-05T00:00:00Z')
    RETURNING id \\gset audit_
    SELECT :t1_id::text || ',' || :t2_id::text || ',' || :p1_id::text || ',' ||
      :p2_id::text || ',' || :item_id::text || ',' || :audit_id::text;
  `);
  const [tenant1, tenant2, project1, project2, itemId, auditId] = seeded.split(",");
  assert.notEqual(tenant1, tenant2);

  expectError(
    `INSERT INTO project (tenant_id) VALUES (NULL);`,
    /null value in column "tenant_id"/,
  );
  expectError(
    `INSERT INTO checklist_item (
      tenant_id, project_id, phase_id, title, scope, status, enabled
    ) VALUES (${tenant2}, ${project1}, '02.A', 'cross', 'web', 'NOT_STARTED', true);`,
    /foreign key|checklist_item/,
  );
  expectError(
    `INSERT INTO checklist_item (
      tenant_id, project_id, parent_id, phase_id, title, scope, status, enabled
    ) VALUES (${tenant1}, ${project2}, ${itemId}, '02.A', 'wrong parent', 'web', 'NOT_STARTED', true);`,
    /foreign key|checklist_item/,
  );
  expectError(
    `UPDATE checklist_item
     SET status = 'NOT_APPLICABLE', not_applicable_reason = ' ', not_applicable_approver = 'admin'
     WHERE id = ${itemId};`,
    /checklist_item_not_applicable/,
  );
  expectError(
    `UPDATE checklist_item SET status = 'PASS' WHERE id = ${itemId};`,
    /checklist_item_pass_expiry/,
  );
  expectError(
    `INSERT INTO checklist_item (
      tenant_id, project_id, phase_id, title, scope, status, enabled
    ) VALUES (${tenant1}, ${project1}, '02.A', 'failed', 'web', 'FAIL', true);`,
    /FAIL or BLOCKED requires a linked finding/,
  );
  expectError(
    `INSERT INTO evidence (tenant_id, url) VALUES (${tenant1}, 'file://missing-parent');`,
    /evidence_has_parent/,
  );
  expectError(
    `INSERT INTO evidence (tenant_id, finding_id, url)
     SELECT ${tenant2}, id, 'file://cross' FROM finding WHERE tenant_id = ${tenant1};`,
    /foreign key|evidence/,
  );
  expectError(
    `UPDATE audit_record SET reason = 'changed' WHERE id = ${auditId};`,
    /audit records are append-only/,
  );
  expectError(
    `DELETE FROM audit_record WHERE id = ${auditId};`,
    /audit records are append-only/,
  );
  expectError(`TRUNCATE audit_record;`, /audit records are append-only/);

  run(`
    UPDATE checklist_item
    SET status = 'PASS', pass_expiry = '2026-10-06T00:00:00Z'
    WHERE id = ${itemId};
  `);
  run(`
    UPDATE checklist_item
    SET status = 'NOT_APPLICABLE',
        not_applicable_reason = 'out of scope',
        not_applicable_approver = 'approver'
    WHERE id = ${itemId};
  `);

  runFile(rollback);
  assert.equal(run(`SELECT to_regclass('public.checklist_item') IS NULL;`), "t");
  assert.equal(run(`SELECT to_regclass('public.audit_record') IS NULL;`), "t");
  assert.equal(run(`SELECT to_regclass('public.tenant') IS NULL;`), "t");

  runFile(forward);
  runFile(rollback);
  assert.equal(run(`SELECT to_regclass('public.project') IS NULL;`), "t");
});
