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

test("status constraint and dependency gate survive forward and rollback", () => {
  runFile("../data/migrations/0002_checklist_statuses_rollback.sql");
  runFile("../data/migrations/0001_checklist_entities_rollback.sql");
  runFile("../data/migrations/0001_checklist_entities.sql");
  runFile("../data/migrations/0002_checklist_statuses.sql");

  const seeded = run(`
    INSERT INTO tenant DEFAULT VALUES RETURNING id \\gset t1_
    INSERT INTO tenant DEFAULT VALUES RETURNING id \\gset t2_
    INSERT INTO project (tenant_id) VALUES (:t1_id) RETURNING id \\gset p1_
    INSERT INTO project (tenant_id) VALUES (:t2_id) RETURNING id \\gset p2_
    INSERT INTO checklist_item (
      tenant_id, project_id, phase_id, title, scope, status, enabled
    ) VALUES (
      :t1_id, :p1_id, '02.A', 'prerequisite', 'web', 'NOT_STARTED', true
    ) RETURNING id \\gset pre_
    INSERT INTO checklist_item (
      tenant_id, project_id, phase_id, title, scope, status, enabled
    ) VALUES (
      :t1_id, :p1_id, '02.A', 'dependent', 'web', 'NOT_STARTED', true
    ) RETURNING id \\gset dep_
    INSERT INTO checklist_item (
      tenant_id, project_id, phase_id, title, scope, status, enabled
    ) VALUES (
      :t2_id, :p2_id, '02.A', 'other tenant', 'web', 'NOT_STARTED', true
    ) RETURNING id \\gset other_
    INSERT INTO checklist_dependency (tenant_id, item_id, prerequisite_id)
    VALUES (:t1_id, :dep_id, :pre_id);
    SELECT :dep_id::text || ',' || :pre_id::text || ',' || :other_id::text || ',' || :t2_id::text;
  `);
  const [dependentId, prerequisiteId, otherId, tenant2] = seeded.split(",");

  expectError(
    `UPDATE checklist_item SET status = 'READY' WHERE id = ${dependentId};`,
    /checklist_item_status_known/,
  );
  expectError(
    `UPDATE checklist_item
     SET status = 'PASS', pass_expiry = '2026-10-06T00:00:00Z'
     WHERE id = ${dependentId};`,
    /checklist_item_pass_approver/,
  );
  expectError(
    `INSERT INTO checklist_dependency (tenant_id, item_id, prerequisite_id)
     VALUES (${tenant2}, ${otherId}, ${prerequisiteId});`,
    /foreign key|checklist_dependency/,
  );
  expectError(
    `INSERT INTO checklist_dependency (tenant_id, item_id, prerequisite_id)
     VALUES ((SELECT tenant_id FROM checklist_item WHERE id = ${dependentId}), ${dependentId}, ${dependentId});`,
    /check constraint|checklist_dependency/,
  );

  run(`
    UPDATE checklist_item
    SET status = 'PASS',
        pass_expiry = '2026-10-06T00:00:00Z',
        pass_approver = 'approver'
    WHERE id = ${prerequisiteId};
  `);

  runFile("../data/migrations/0002_checklist_statuses_rollback.sql");
  assert.equal(run(`SELECT to_regclass('public.checklist_dependency') IS NULL;`), "t");
  run(`UPDATE checklist_item SET status = 'READY' WHERE id = ${dependentId};`);

  runFile("../data/migrations/0001_checklist_entities_rollback.sql");
  runFile("../data/migrations/0001_checklist_entities.sql");
  runFile("../data/migrations/0002_checklist_statuses.sql");
  runFile("../data/migrations/0002_checklist_statuses_rollback.sql");
  runFile("../data/migrations/0001_checklist_entities_rollback.sql");
  assert.equal(run(`SELECT to_regclass('public.checklist_item') IS NULL;`), "t");
});
