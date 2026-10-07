import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const forward = new URL("../data/migrations/0006_role_definitions.sql", import.meta.url);
const rollback = new URL("../data/migrations/0006_role_definitions_rollback.sql", import.meta.url);
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

test("role definitions seed the six names and reject a second default or an unknown name", () => {
  runFile(rollback);
  runFile(forward);

  const seeded = run(`
    SELECT name || '=' || CASE WHEN is_default THEN 'true' ELSE 'false' END
    FROM role_definition
    ORDER BY name;
  `);
  assert.deepEqual(seeded.split("\n").sort(), [
    "Admin=false",
    "Customer=true",
    "Distributor=false",
    "Retailer=false",
    "Super Admin=false",
    "Super Distributor=false",
  ]);
  assert.equal(run(`SELECT count(*) FROM role_definition WHERE is_default;`), "1");
  assert.equal(run(`SELECT to_regclass('public.role_permission') IS NULL;`), "t");

  expectError(
    `INSERT INTO role_definition (name, is_default) VALUES ('Owner', false);`,
    /role_definition_name_known/,
  );
  expectError(
    `INSERT INTO role_definition (name, is_default) VALUES ('Admin', true);`,
    /role_definition_default_is_customer|role_definition_one_default|duplicate key/,
  );
  expectError(
    `UPDATE role_definition SET is_default = true WHERE name = 'Retailer';`,
    /role_definition_default_is_customer|role_definition_one_default/,
  );

  runFile(rollback);
  assert.equal(run(`SELECT to_regclass('public.role_definition') IS NULL;`), "t");
});
