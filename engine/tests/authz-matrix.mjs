import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { test } from "node:test";
import { resolve } from "node:path";
import { CAPABILITY_NAMES } from "../packages/contracts/src/identity/index.mjs";
import { isInSubtree } from "../packages/contracts/src/identity/index.mjs";
import {
  CONTROL_ROUTES,
  IGNORED_CLIENT_FIELDS,
  authorizeControlRequest,
} from "../services/authz/index.mjs";

const TENANT_ROOT = "11111111-1111-4111-8111-111111111111";
const TENANT_CHILD = "22222222-2222-4222-8222-222222222222";
const TENANT_OTHER = "33333333-3333-4333-8333-333333333333";
const ACTOR = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const PARENT = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const CHILD = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const SECRET = "super-secret-value";
const TOKEN = "tok-forged-value";
const API_KEY = "connector-key-fixture";
const SEED = "seed-phrase-fixture";

const evidenceDir = resolve(import.meta.dirname, "../docs/architecture/evidence/1-b-2");

function ceiling(map) {
  return {
    "Super Admin": [],
    Admin: [],
    "Super Distributor": [],
    Distributor: [],
    Retailer: [],
    Customer: [],
    ...map,
  };
}

const openCeiling = ceiling({
  "Super Admin": [...CAPABILITY_NAMES],
  Admin: [...CAPABILITY_NAMES],
});

const forgedCeiling = ceiling({
  "Super Admin": [...CAPABILITY_NAMES],
});

const allowAll = CAPABILITY_NAMES.map((capability) => ({ capability, effect: "allow" }));

function tenants() {
  return {
    [TENANT_ROOT]: { id: TENANT_ROOT, parentId: null, status: "active" },
    [TENANT_CHILD]: { id: TENANT_CHILD, parentId: TENANT_ROOT, status: "active" },
    [TENANT_OTHER]: { id: TENANT_OTHER, parentId: null, status: "active" },
  };
}

function assignment(role, parentPrincipalId = null, status = "active") {
  return { role, status, parentPrincipalId };
}

function principal(id, tenantId, role, extras = {}) {
  return {
    id,
    tenantId,
    status: extras.status ?? "active",
    assignments: extras.assignments ?? [assignment(role, extras.parentPrincipalId ?? null, extras.assignmentStatus ?? "active")],
  };
}

function directory(principals, extras = {}) {
  return {
    principals,
    tenants: extras.tenants ?? tenants(),
    rules: extras.rules ?? allowAll,
    audit: [],
  };
}

function request(route, fields) {
  return { method: route.method, path: route.path, ...fields };
}

function forgedFields() {
  return {
    role: "Super Admin",
    tenantId: TENANT_OTHER,
    editChecklist: true,
    canEdit: true,
    capability: "global.policy",
    password: SECRET,
    token: TOKEN,
    cookie: `session=${SECRET}`,
    proof: "mfa-proof-fixture",
    apiKey: API_KEY,
    seed: SEED,
    authorization: `Bearer ${SECRET}`,
  };
}

function assertClosed(result) {
  assert.deepEqual(Object.keys(result).sort(), ["action", "audited", "decision", "ok", "reason", "route"]);
}

function assertRedacted(value) {
  const blob = JSON.stringify(value);
  for (const secret of [SECRET, TOKEN, API_KEY, SEED, "Bearer", "mfa-proof-fixture", "Super Admin"]) {
    assert.equal(blob.includes(secret), false, secret);
  }
  for (const field of IGNORED_CLIENT_FIELDS) {
    assert.equal(Object.hasOwn(value, field), false, field);
  }
}

test("subtree walk stays on the parent chain", () => {
  const parentOf = (id) => ({ child: "parent", parent: "root", root: null, loop: "loop" })[id] ?? null;
  assert.equal(isInSubtree("root", "root", parentOf), true);
  assert.equal(isInSubtree("root", "child", parentOf), true);
  assert.equal(isInSubtree("parent", "child", parentOf), true);
  assert.equal(isInSubtree("child", "root", parentOf), false);
  assert.equal(isInSubtree("child", "other", parentOf), false);
  assert.equal(isInSubtree("loop", "loop", parentOf), true);
  assert.equal(isInSubtree("outside", "loop", parentOf), false);
  assert.equal(isInSubtree(null, "child", parentOf), false);
  assert.equal(isInSubtree("root", "child", null), false);
});

test("authorization matrix denies escalation, cross-tenant access, revoked roles, and forged UI requests", async () => {
  assert.deepEqual(CONTROL_ROUTES.map((route) => route.capability), [...CAPABILITY_NAMES]);
  const rows = [];
  const examples = [];

  for (const route of CONTROL_ROUTES) {
    const escalated = directory({
      [ACTOR]: principal(ACTOR, TENANT_CHILD, "Admin"),
    });
    const escalatedResult = authorizeControlRequest(escalated, request(route, {
      principalId: ACTOR,
      targetTenantId: TENANT_ROOT,
    }), { ceiling: openCeiling });
    assert.equal(escalatedResult.decision, "denied");
    assert.equal(escalatedResult.reason, "privilege escalation");
    assert.equal(escalatedResult.audited, route.privileged);
    assertClosed(escalatedResult);
    rows.push({ route: `${route.method} ${route.path}`, case: "privilege escalation", ...escalatedResult });

    const foreign = directory({
      [ACTOR]: principal(ACTOR, TENANT_ROOT, "Admin"),
    });
    const foreignResult = authorizeControlRequest(foreign, request(route, {
      principalId: ACTOR,
      targetTenantId: TENANT_OTHER,
    }), { ceiling: openCeiling });
    assert.equal(foreignResult.decision, "denied");
    assert.equal(foreignResult.reason, "cross-tenant");
    assert.equal(foreignResult.audited, route.privileged);
    rows.push({ route: `${route.method} ${route.path}`, case: "cross-tenant", ...foreignResult });

    const revoked = directory({
      [ACTOR]: principal(ACTOR, TENANT_ROOT, "Admin", { status: "suspended" }),
    });
    const revokedResult = authorizeControlRequest(revoked, request(route, {
      principalId: ACTOR,
      targetTenantId: TENANT_ROOT,
    }), { ceiling: openCeiling });
    assert.equal(revokedResult.decision, "denied");
    assert.equal(revokedResult.reason, "role revoked");
    assert.equal(revokedResult.audited, route.privileged);
    rows.push({ route: `${route.method} ${route.path}`, case: "revoked role", ...revokedResult });

    const forgedDirectory = directory({
      [ACTOR]: principal(ACTOR, TENANT_ROOT, "Customer"),
    });
    const forgedRequest = request(route, {
      principalId: ACTOR,
      targetTenantId: TENANT_ROOT,
      ...forgedFields(),
    });
    const forgedResult = authorizeControlRequest(forgedDirectory, forgedRequest, { ceiling: forgedCeiling });
    const cleanResult = authorizeControlRequest(directory({
      [ACTOR]: principal(ACTOR, TENANT_ROOT, "Customer"),
    }), request(route, {
      principalId: ACTOR,
      targetTenantId: TENANT_ROOT,
    }), { ceiling: forgedCeiling });
    assert.equal(forgedResult.decision, "denied");
    assert.equal(forgedResult.reason, "capability denied");
    assert.deepEqual(
      { decision: forgedResult.decision, reason: forgedResult.reason, ok: forgedResult.ok },
      { decision: cleanResult.decision, reason: cleanResult.reason, ok: cleanResult.ok },
    );
    assert.equal(forgedResult.audited, route.privileged);
    assertRedacted(forgedResult);
    if (route.privileged) {
      assert.equal(forgedDirectory.audit.length, 1);
      assertRedacted(forgedDirectory.audit[0]);
      assert.equal(forgedDirectory.audit[0].actor, ACTOR);
      assert.equal(forgedDirectory.audit[0].reason, "capability denied");
    } else {
      assert.equal(forgedDirectory.audit.length, 0);
    }
    rows.push({ route: `${route.method} ${route.path}`, case: "forged UI", ...forgedResult });

    if (route.path === "/api/checklist-owner" && route.method === "POST") examples.push(escalated.audit.at(-1), foreign.audit.at(-1), revoked.audit.at(-1), forgedDirectory.audit.at(-1));
  }

  const suspendedAssignment = directory({
    [ACTOR]: principal(ACTOR, TENANT_ROOT, "Admin", { assignmentStatus: "suspended" }),
  });
  const suspendedAssignmentResult = authorizeControlRequest(suspendedAssignment, {
    method: "POST",
    path: "/api/checklist-owner",
    principalId: ACTOR,
    targetTenantId: TENANT_ROOT,
  }, { ceiling: openCeiling });
  assert.equal(suspendedAssignmentResult.reason, "role revoked");

  const suspendedTenant = directory({
    [ACTOR]: principal(ACTOR, TENANT_ROOT, "Admin"),
  }, {
    tenants: {
      ...tenants(),
      [TENANT_ROOT]: { id: TENANT_ROOT, parentId: null, status: "suspended" },
    },
  });
  assert.equal(authorizeControlRequest(suspendedTenant, {
    method: "POST",
    path: "/api/control/tenant",
    principalId: ACTOR,
    targetTenantId: TENANT_ROOT,
  }, { ceiling: openCeiling }).reason, "role revoked");

  const pair = directory({
    [ACTOR]: principal(ACTOR, TENANT_ROOT, "Admin", {
      assignments: [assignment("Admin"), assignment("Customer")],
    }),
  });
  assert.equal(authorizeControlRequest(pair, {
    method: "POST",
    path: "/api/control/policy",
    principalId: ACTOR,
    targetTenantId: TENANT_ROOT,
  }, { ceiling: openCeiling }).reason, "role revoked");

  const unknown = authorizeControlRequest(directory({
    [ACTOR]: principal(ACTOR, TENANT_ROOT, "Admin"),
  }), {
    method: "POST",
    path: "/api/control/not-a-route",
    principalId: ACTOR,
    targetTenantId: TENANT_ROOT,
    password: SECRET,
  }, { ceiling: openCeiling });
  assert.equal(unknown.decision, "denied");
  assert.equal(unknown.reason, "capability denied");
  assert.equal(unknown.audited, false);
  assertRedacted(unknown);

  const missing = directory({
    [ACTOR]: principal(ACTOR, TENANT_ROOT, "Admin"),
  });
  const login = authorizeControlRequest(missing, {
    method: "POST",
    path: "/api/control/connector",
    targetTenantId: TENANT_ROOT,
    password: SECRET,
    cookie: SECRET,
  }, { ceiling: openCeiling });
  assert.equal(login.reason, "login denied");
  assert.equal(login.audited, true);
  assert.equal(missing.audit.at(-1).actor, null);
  assertRedacted(missing.audit.at(-1));

  const descendant = directory({
    [ACTOR]: principal(ACTOR, TENANT_ROOT, "Admin"),
  });
  const descendantResult = authorizeControlRequest(descendant, {
    method: "POST",
    path: "/api/control/tenant",
    principalId: ACTOR,
    targetTenantId: TENANT_CHILD,
  }, { ceiling: openCeiling });
  assert.equal(descendantResult.decision, "granted");
  assert.equal(descendantResult.reason, "granted");
  assert.equal(descendant.audit.at(-1).decision, "granted");
  examples.push(descendant.audit.at(-1));

  const shipped = directory({
    [ACTOR]: principal(ACTOR, TENANT_ROOT, "Admin"),
  });
  const shippedResult = authorizeControlRequest(shipped, {
    method: "POST",
    path: "/api/checklist-owner",
    principalId: ACTOR,
    targetTenantId: TENANT_ROOT,
  });
  assert.equal(shippedResult.decision, "denied");
  assert.equal(shippedResult.reason, "capability denied");
  examples.push(shipped.audit.at(-1));

  const granted = directory({
    [ACTOR]: principal(ACTOR, TENANT_ROOT, "Admin"),
  });
  const grantedResult = authorizeControlRequest(granted, {
    method: "POST",
    path: "/api/checklist-owner",
    principalId: ACTOR,
    targetTenantId: TENANT_ROOT,
    ...forgedFields(),
  }, { ceiling: openCeiling });
  assert.equal(grantedResult.decision, "granted");
  assert.equal(granted.audit.length, 1);
  assertRedacted(granted.audit[0]);
  assert.equal(granted.audit[0].action, "checklist.write");
  examples.push(granted.audit[0]);

  const deniedWrite = directory({
    [ACTOR]: principal(ACTOR, TENANT_ROOT, "Admin"),
  }, {
    rules: [...allowAll, { capability: "checklist.write", effect: "deny" }],
  });
  const deniedWriteResult = authorizeControlRequest(deniedWrite, {
    method: "POST",
    path: "/api/checklist-owner",
    principalId: ACTOR,
    targetTenantId: TENANT_ROOT,
  }, { ceiling: openCeiling });
  assert.equal(deniedWriteResult.reason, "capability denied");
  examples.push(deniedWrite.audit.at(-1));

  const chain = directory({
    [PARENT]: principal(PARENT, TENANT_ROOT, "Admin"),
    [CHILD]: principal(CHILD, TENANT_ROOT, "Admin", { parentPrincipalId: PARENT }),
  });
  const down = authorizeControlRequest(chain, {
    method: "POST",
    path: "/api/control/subtree",
    principalId: PARENT,
    targetTenantId: TENANT_ROOT,
    targetPrincipalId: CHILD,
  }, { ceiling: openCeiling });
  assert.equal(down.decision, "granted");
  examples.push(chain.audit.at(-1));
  const up = authorizeControlRequest(chain, {
    method: "POST",
    path: "/api/control/subtree",
    principalId: CHILD,
    targetTenantId: TENANT_ROOT,
    targetPrincipalId: PARENT,
  }, { ceiling: openCeiling });
  assert.equal(up.reason, "privilege escalation");
  examples.push(chain.audit.at(-1));

  const combined = directory({
    [ACTOR]: principal(ACTOR, TENANT_ROOT, "Retailer", {
      assignments: [assignment("Retailer"), assignment("Customer")],
    }),
  }, { rules: allowAll });
  const unionCeiling = ceiling({
    Retailer: ["checklist.read", "subtree.delegate"],
    Customer: ["checklist.read"],
  });
  assert.equal(authorizeControlRequest(combined, {
    method: "POST",
    path: "/api/control/subtree",
    principalId: ACTOR,
    targetTenantId: TENANT_ROOT,
  }, { ceiling: unionCeiling }).decision, "granted");
  assert.equal(authorizeControlRequest(combined, {
    method: "POST",
    path: "/api/checklist-owner",
    principalId: ACTOR,
    targetTenantId: TENANT_ROOT,
  }, { ceiling: unionCeiling }).reason, "capability denied");
  assert.equal(authorizeControlRequest(combined, {
    method: "GET",
    path: "/api/checklist-owner",
    principalId: ACTOR,
    targetTenantId: TENANT_ROOT,
  }, {
    ceiling: unionCeiling,
    rules: [{ capability: "checklist.read", effect: "deny" }],
  }).reason, "capability denied");

  const unauditedGrant = authorizeControlRequest({
    principals: { [ACTOR]: principal(ACTOR, TENANT_ROOT, "Admin") },
    tenants: tenants(),
    rules: allowAll,
  }, {
    method: "POST",
    path: "/api/checklist-owner",
    principalId: ACTOR,
    targetTenantId: TENANT_ROOT,
  }, { ceiling: openCeiling });
  assert.equal(unauditedGrant.decision, "denied");
  assert.equal(unauditedGrant.audited, false);

  const source = await readFile(new URL("../services/authz/evaluate.mjs", import.meta.url), "utf8");
  assert.equal(source.includes("...request"), false);
  assert.equal(source.includes("request.role"), false);
  assert.equal(source.includes("request.password"), false);
  assert.equal(source.includes("access-policy"), false);
  assert.equal(source.includes("LIVE_TRADING"), false);
  assert.equal(source.includes("from \"react\""), false);

  const denied = rows.filter((row) => row.decision === "denied").length;
  assert.equal(rows.length, CONTROL_ROUTES.length * 4);
  assert.equal(denied, rows.length);
  assertRedacted(examples);

  await mkdir(evidenceDir, { recursive: true });
  const matrix = {
    task: "1.B.2",
    date: "2026-10-07",
    truth: "MOCK",
    routes: CONTROL_ROUTES.map((route) => ({
      method: route.method,
      path: route.path,
      capability: route.capability,
      privileged: route.privileged,
      httpMounted: route.path === "/api/checklist-owner",
    })),
    cases: rows.map((row) => ({
      route: row.route,
      case: row.case,
      decision: row.decision,
      reason: row.reason,
      audited: row.audited,
    })),
    totals: { cases: rows.length, denied, granted: 0 },
  };
  const auditExamples = {
    task: "1.B.2",
    date: "2026-10-07",
    truth: "MOCK",
    fields: ["actor", "action", "target", "decision", "reason"],
    containsSecrets: false,
    rows: examples,
  };
  assertRedacted(matrix);
  assertRedacted(auditExamples);
  await writeFile(resolve(evidenceDir, "authorization-matrix.json"), `${JSON.stringify(matrix, null, 2)}\n`);
  await writeFile(resolve(evidenceDir, "audit-examples.json"), `${JSON.stringify(auditExamples, null, 2)}\n`);
  const lines = [
    "# 1.B.2 authorization matrix",
    "",
    "Truth label: MOCK. Fixture principals only. The shipped role ceiling grants nothing.",
    "",
    `Denied cases: ${denied} of ${rows.length}.`,
    "",
    "| Route | Case | Decision | Reason | Audited |",
    "| --- | --- | --- | --- | --- |",
    ...rows.map((row) => `| ${row.route} | ${row.case} | ${row.decision} | ${row.reason} | ${row.audited} |`),
    "",
  ];
  await writeFile(resolve(evidenceDir, "authorization-matrix.md"), `${lines.join("\n")}\n`);
});
