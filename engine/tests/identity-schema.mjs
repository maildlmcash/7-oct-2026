import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { test } from "node:test";
import { resolve } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { catalogGrants, ROLE_NAMES } from "../packages/contracts/src/roles.mjs";
import {
  assignmentParentLink,
  effectiveCapabilities,
  mergeHeldCapabilities,
  shippedCeilingsAreEmpty,
  tenantParentLink,
} from "../packages/contracts/src/identity/index.mjs";

const evidenceDir = resolve(import.meta.dirname, "../docs/architecture/evidence/1-b-1");

async function sqlFile(name) {
  return readFile(new URL(`../data/migrations/${name}`, import.meta.url), "utf8");
}

function fixtureCeiling() {
  return {
    "Super Admin": [],
    Admin: [],
    "Super Distributor": [],
    Distributor: [],
    Retailer: ["checklist.read", "subtree.delegate"],
    Customer: ["checklist.read"],
  };
}

test("deny-by-default merge unions only held roles and an explicit deny wins", () => {
  assert.equal(shippedCeilingsAreEmpty(), true);
  for (const role of ROLE_NAMES) assert.deepEqual([...catalogGrants(role)], []);

  const deniedByDefault = effectiveCapabilities(["Retailer", "Customer"], [
    { capability: "checklist.read", effect: "allow" },
    { capability: "commission.manage", effect: "allow" },
  ]);
  assert.equal(deniedByDefault.ok, true);
  assert.deepEqual(deniedByDefault.capabilities, []);

  const union = mergeHeldCapabilities(["Customer", "Retailer"], {
    allows: ["checklist.read", "subtree.delegate", "commission.manage"],
    denies: [],
    ceiling: fixtureCeiling(),
  });
  assert.deepEqual(union.capabilities, ["checklist.read", "subtree.delegate"]);

  const denied = mergeHeldCapabilities(["Retailer", "Customer"], {
    allows: ["checklist.read", "subtree.delegate"],
    denies: ["checklist.read"],
    ceiling: fixtureCeiling(),
  });
  assert.deepEqual(denied.capabilities, ["subtree.delegate"]);

  const customerOnly = mergeHeldCapabilities(["Customer"], {
    allows: ["subtree.delegate", "checklist.read"],
    denies: [],
    ceiling: fixtureCeiling(),
  });
  assert.deepEqual(customerOnly.capabilities, ["checklist.read"]);

  assert.equal(mergeHeldCapabilities(["Admin", "Customer"], { allows: ["checklist.read"] }).ok, false);
  assert.equal(assignmentParentLink({ tenantId: "a", parentTenantId: "b" }).ok, false);
  assert.equal(assignmentParentLink({ tenantId: "a", parentTenantId: "a" }).ok, true);
  assert.equal(tenantParentLink({ tenantId: 1, parentId: 1 }).error, "parent cycle");
});

test("migration rejects a cross-tenant parent and any combined pair except Retailer and Customer", async () => {
  const db = new PGlite();
  const cases = [];
  try {
    await db.exec(await sqlFile("0001_checklist_entities.sql"));
    await db.exec(await sqlFile("0006_role_definitions.sql"));
    await db.exec(await sqlFile("0014_identity_role_tenant.sql"));

    const tables = await db.query(`
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = 'public'
        AND table_name IN (
          'tenant',
          'identity_principal',
          'identity_role_assignment',
          'identity_capability',
          'identity_capability_rule',
          'role_definition'
        )
      ORDER BY table_name
    `);
    assert.deepEqual(tables.rows.map((row) => row.table_name), [
      "identity_capability",
      "identity_capability_rule",
      "identity_principal",
      "identity_role_assignment",
      "role_definition",
      "tenant",
    ]);

    const allows = await db.query(`SELECT count(*)::int AS count FROM identity_capability_rule WHERE effect = 'allow'`);
    assert.equal(allows.rows[0].count, 0);
    const capabilityCount = await db.query(`SELECT count(*)::int AS count FROM identity_capability`);
    assert.equal(capabilityCount.rows[0].count, 8);

    await db.exec(`
      INSERT INTO tenant (status) VALUES ('active');
      INSERT INTO tenant (status) VALUES ('active');
    `);
    const tenants = await db.query(`SELECT id FROM tenant ORDER BY id`);
    const tenantA = tenants.rows[0].id;
    const tenantB = tenants.rows[1].id;
    await db.exec(`UPDATE tenant SET parent_id = ${tenantA} WHERE id = ${tenantB}`);

    await db.exec(`
      INSERT INTO identity_principal (tenant_id, subject_key, status)
      VALUES (${tenantA}, 'fixture-parent', 'active');
      INSERT INTO identity_principal (tenant_id, subject_key, status)
      VALUES (${tenantA}, 'fixture-child', 'active');
      INSERT INTO identity_principal (tenant_id, subject_key, status)
      VALUES (${tenantB}, 'fixture-other', 'active');
    `);
    const principals = await db.query(`SELECT id, tenant_id, subject_key FROM identity_principal ORDER BY id`);
    const parentA = principals.rows.find((row) => row.subject_key === "fixture-parent").id;
    const childA = principals.rows.find((row) => row.subject_key === "fixture-child").id;
    const otherB = principals.rows.find((row) => row.subject_key === "fixture-other").id;

    await db.exec(`
      INSERT INTO identity_role_assignment (tenant_id, principal_id, role_name, status)
      VALUES (${tenantA}, ${parentA}, 'Distributor', 'active');
      INSERT INTO identity_role_assignment (tenant_id, principal_id, role_name, parent_principal_id, status)
      VALUES (${tenantA}, ${childA}, 'Retailer', ${parentA}, 'active');
    `);
    cases.push({ case: "same-tenant parent", ok: true });

    await assert.rejects(
      () => db.exec(`
        INSERT INTO identity_role_assignment (tenant_id, principal_id, role_name, parent_principal_id, status)
        VALUES (${tenantA}, ${childA}, 'Customer', ${otherB}, 'active');
      `),
      (error) => /foreign key|identity_role_assignment/i.test(String(error)),
    );
    cases.push({ case: "cross-tenant parent", rejected: true });

    await assert.rejects(
      () => db.exec(`
        INSERT INTO identity_role_assignment (tenant_id, principal_id, role_name, parent_principal_id, status)
        VALUES (${tenantB}, ${otherB}, 'Customer', ${parentA}, 'active');
      `),
      (error) => /foreign key|identity_role_assignment/i.test(String(error)),
    );
    cases.push({ case: "cross-tenant child", rejected: true });

    await db.exec(`
      INSERT INTO identity_role_assignment (tenant_id, principal_id, role_name, parent_principal_id, status)
      VALUES (${tenantA}, ${childA}, 'Customer', ${parentA}, 'active');
    `);
    const held = await db.query(`
      SELECT role_name FROM identity_role_assignment WHERE principal_id = ${childA} ORDER BY role_name
    `);
    assert.deepEqual(held.rows.map((row) => row.role_name), ["Customer", "Retailer"]);
    cases.push({ case: "retailer and customer", ok: true });

    await assert.rejects(
      () => db.exec(`
        INSERT INTO identity_role_assignment (tenant_id, principal_id, role_name, status)
        VALUES (${tenantA}, ${childA}, 'Admin', 'active');
      `),
      (error) => /profile is not combined/i.test(String(error)),
    );
    cases.push({ case: "admin plus customer", rejected: true });

    await db.exec(await sqlFile("0014_identity_role_tenant_rollback.sql"));
    const gone = await db.query(`SELECT to_regclass('public.identity_principal') AS name`);
    assert.equal(gone.rows[0].name, null);
    const statusColumn = await db.query(`
      SELECT count(*)::int AS count
      FROM information_schema.columns
      WHERE table_name = 'tenant' AND column_name = 'status'
    `);
    assert.equal(statusColumn.rows[0].count, 0);
    cases.push({ case: "rollback", ok: true });

    await mkdir(evidenceDir, { recursive: true });
    await writeFile(
      resolve(evidenceDir, "schema-test.json"),
      `${JSON.stringify({ engine: "pglite", allowRules: 0, cases }, null, 2)}\n`,
    );
  } finally {
    await db.close();
  }
});
