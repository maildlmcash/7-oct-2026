import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  DEFAULT_ROLE,
  PERMISSION_MATRIX,
  ROLE_NAMES,
  catalogGrants,
  isKnownRole,
  roleDefinitions,
} from "../packages/contracts/src/roles.mjs";
import { createAccount, createSessionStore } from "../services/session.mjs";
import { SHELL_ROLES, authorizeShell } from "../services/shell-capabilities.mjs";

const migration = readFileSync(new URL("../data/migrations/0006_role_definitions.sql", import.meta.url), "utf8");
const rollback = readFileSync(new URL("../data/migrations/0006_role_definitions_rollback.sql", import.meta.url), "utf8");
const decision = readFileSync(new URL("../docs/decisions/0011-role-definitions.md", import.meta.url), "utf8");

function quotedNames(source, pattern) {
  const found = source.match(pattern);
  assert.ok(found);
  return [...found[1].matchAll(/'([^']+)'/g)].map((match) => match[1]);
}

test("role names match in the contract, the shell, and the migration", () => {
  assert.deepEqual([...ROLE_NAMES], [
    "Super Admin",
    "Admin",
    "Super Distributor",
    "Distributor",
    "Retailer",
    "Customer",
  ]);
  assert.equal(SHELL_ROLES, ROLE_NAMES);
  assert.equal(Object.isFrozen(ROLE_NAMES), true);
  assert.deepEqual(quotedNames(migration, /name IN \(\s*([\s\S]*?)\)/), [...ROLE_NAMES]);
  const inserted = [...migration.matchAll(/\('([^']+)', (true|false)\)/g)].map((match) => [
    match[1],
    match[2] === "true",
  ]);
  assert.deepEqual(inserted, ROLE_NAMES.map((name) => [name, name === "Customer"]));
  assert.equal(migration.includes("GRANT"), false);
  assert.equal(migration.includes("role_permission"), false);
  assert.match(rollback, /DROP TABLE IF EXISTS role_definition/);
  assert.equal(rollback.includes("tenant"), false);
  for (const name of ROLE_NAMES) {
    assert.equal(decision.includes(`| ${name} |`), true);
  }
});

test("the default role is Customer and every catalog grant list is empty", () => {
  assert.equal(DEFAULT_ROLE, "Customer");
  const definitions = roleDefinitions();
  assert.deepEqual(definitions.map((row) => row.name), [...ROLE_NAMES]);
  assert.deepEqual(definitions.filter((row) => row.isDefault).map((row) => row.name), ["Customer"]);
  for (const name of ROLE_NAMES) {
    assert.equal(isKnownRole(name), true);
    assert.equal(catalogGrants(name), PERMISSION_MATRIX[name]);
    assert.deepEqual([...catalogGrants(name)], []);
    assert.ok(catalogGrants(DEFAULT_ROLE).length <= catalogGrants(name).length);
  }
  assert.equal(catalogGrants("SuperAdmin"), null);
  assert.equal(catalogGrants("Retailer+Customer"), null);
  assert.equal(isKnownRole("owner"), false);
  assert.match(decision, /Every role has catalog permissions none\./);
  assert.match(decision, /The default role is Customer\. Its catalog grant list is empty, which is the minimum\./);
  const caps = authorizeShell({ id: "customer", role: DEFAULT_ROLE, tenantId: 1 }, 1);
  assert.equal(caps.editChecklist, false);
  const account = createAccount(createSessionStore(), { loginId: "account-1", password: "super-secret-value" });
  assert.equal(account.ok, true);
  assert.equal(account.role, undefined);
});
