import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { test } from "node:test";
import { PGlite } from "@electric-sql/pglite";
import {
  getProjectChecklist,
  postProjectChecklist,
  postProjectChecklistIssue,
} from "../apps/web/project-checklist-http.mjs";
import { DESK_ACCOUNTS, deskCsrf, deskLogin } from "../services/desk-session.mjs";
import {
  PROJECT_CHECK_STATUSES,
  PROJECT_CHECK_TEMPLATES,
  createProjectChecklistStore,
  openIssueFromMonitoredError,
  readProjectChecklist,
  saveProjectCheck,
} from "../services/checklists/project-checklist.mjs";

const evidenceDir = resolve(import.meta.dirname, "../docs/architecture/evidence/1-c-2");
const SECRET = "super-secret-value";
const admin = DESK_ACCOUNTS.find((account) => account.role === "Admin");
const user = DESK_ACCOUNTS.find((account) => account.role === "User");
const actor = { role: "Admin", tenantId: "desk" };
const clock = () => "2026-10-07T00:00:00.000Z";

async function sqlFile(name) {
  return readFile(new URL(`../data/migrations/${name}`, import.meta.url), "utf8");
}

function sessionFor(account) {
  const csrf = deskCsrf();
  assert.equal(csrf.ok, true);
  const login = deskLogin({
    loginId: account.loginId,
    password: account.password,
    csrfToken: csrf.csrfToken,
    ip: `checklist-${account.role}`,
  });
  assert.equal(login.ok, true);
  return login;
}

function requestFor(url, session, body) {
  const headers = { "content-type": "application/json" };
  if (session) {
    headers.cookie = session.setCookie;
    headers["x-csrf-token"] = session.csrfToken;
  }
  return new Request(url, {
    method: body ? "POST" : "GET",
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
}

test("migration keeps versioned checks, rejects a bare PASS, and blocks a downstream task", async () => {
  const db = new PGlite();
  const cases = [];
  await db.exec(await sqlFile("0001_checklist_entities.sql"));
  await db.exec(await sqlFile("0015_project_checklist.sql"));

  const templates = await db.query(`SELECT id FROM project_check_template ORDER BY id`);
  assert.deepEqual(templates.rows.map((row) => row.id), [
    "android",
    "api",
    "data",
    "ios",
    "paper-engine",
    "scoring",
    "web",
  ]);
  cases.push({ case: "seven templates", ok: true });

  const tenant = await db.query(`INSERT INTO tenant DEFAULT VALUES RETURNING id`);
  const tenantId = tenant.rows[0].id;
  const web = await db.query(`
    INSERT INTO project_check (tenant_id, version, template_id, status, recorded_at)
    VALUES (${tenantId}, 1, 'web', 'TODO', '2026-10-07T00:00:00Z')
    RETURNING id, lineage_id
  `);
  assert.equal(web.rows[0].lineage_id, web.rows[0].id);
  cases.push({ case: "first version assigned", ok: true });

  await assert.rejects(
    () => db.query(`
      INSERT INTO project_check (tenant_id, lineage_id, version, template_id, status, recorded_at)
      VALUES (${tenantId}, ${web.rows[0].lineage_id}, 2, 'web', 'PASS', '2026-10-07T00:01:00Z')
    `),
    (error) => /project_check_pass_requirements|PASS/i.test(String(error)),
  );
  cases.push({ case: "PASS without evidence", rejected: true });

  await db.query(`
    INSERT INTO project_check (
      tenant_id, lineage_id, version, template_id, status, evidence_url, reviewer, reviewed_at, recorded_at
    ) VALUES (
      ${tenantId}, ${web.rows[0].lineage_id}, 2, 'web', 'PASS',
      'https://example.com/checklist/web', 'desk reviewer', '2026-10-07T12:00:00Z', '2026-10-07T00:02:00Z'
    )
  `);
  const api = await db.query(`
    INSERT INTO project_check (tenant_id, version, template_id, status, depends_on, recorded_at)
    VALUES (${tenantId}, 1, 'api', 'TODO', ${web.rows[0].lineage_id}, '2026-10-07T00:03:00Z')
    RETURNING lineage_id
  `);
  await db.query(`
    INSERT INTO project_check (tenant_id, lineage_id, version, template_id, status, recorded_at)
    VALUES (${tenantId}, ${web.rows[0].lineage_id}, 3, 'web', 'BLOCKED', '2026-10-07T00:04:00Z')
  `);
  await assert.rejects(
    () => db.query(`
      INSERT INTO project_check (tenant_id, lineage_id, version, template_id, status, depends_on, recorded_at)
      VALUES (${tenantId}, ${api.rows[0].lineage_id}, 2, 'api', 'IN_PROGRESS', ${web.rows[0].lineage_id}, '2026-10-07T00:05:00Z')
    `),
    (error) => /BLOCKED dependency locks the downstream task/.test(String(error)),
  );
  cases.push({ case: "blocked dependency", rejected: true });

  await assert.rejects(
    () => db.query(`UPDATE project_check SET owner = 'changed' WHERE id = ${web.rows[0].id}`),
    (error) => /checklist versions are immutable/.test(String(error)),
  );
  const kept = await db.query(`
    SELECT version, status FROM project_check
    WHERE lineage_id = ${web.rows[0].lineage_id}
    ORDER BY version
  `);
  assert.deepEqual(kept.rows.map((row) => row.status), ["TODO", "PASS", "BLOCKED"]);

  const correlation = "11111111-1111-4111-8111-111111111111";
  await db.query(`
    INSERT INTO project_check_issue (tenant_id, correlation_id, section, route, http_status, recorded_at)
    VALUES (${tenantId}, '${correlation}', 'Checklist', '/api/view-state', 500, '2026-10-07T12:00:00Z')
  `);
  await assert.rejects(
    () => db.query(`
      INSERT INTO project_check_issue (tenant_id, correlation_id, http_status, recorded_at)
      VALUES (${tenantId}, '${correlation}', 500, '2026-10-07T12:01:00Z')
    `),
    (error) => /duplicate|unique/i.test(String(error)),
  );
  await assert.rejects(
    () => db.query(`
      INSERT INTO project_check_issue (tenant_id, correlation_id, http_status, recorded_at)
      VALUES (${tenantId}, '22222222-2222-4222-8222-222222222222', 200, '2026-10-07T12:02:00Z')
    `),
    (error) => /project_check_issue_error|http_status/i.test(String(error)),
  );
  cases.push({ case: "issue opens once from an error", ok: true });

  await db.exec(await sqlFile("0015_project_checklist_rollback.sql"));
  const left = await db.query(`
    SELECT table_name FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name LIKE 'project_check%'
  `);
  assert.equal(left.rows.length, 0);
  cases.push({ case: "rollback drops project checklist tables", ok: true });

  await mkdir(evidenceDir, { recursive: true });
  await writeFile(resolve(evidenceDir, "migration.json"), `${JSON.stringify({
    task: "1.C.2",
    date: "2026-10-07",
    truth: "MOCK",
    database: "pglite",
    statuses: PROJECT_CHECK_STATUSES,
    templates: PROJECT_CHECK_TEMPLATES.map((item) => item.id),
    cases,
  }, null, 2)}\n`);
});

test("service rejects PASS without evidence and a blocked downstream edit", () => {
  const store = createProjectChecklistStore();
  const initial = readProjectChecklist(store);
  assert.deepEqual(initial.checks.map((check) => check.templateId), PROJECT_CHECK_TEMPLATES.map((item) => item.id));
  assert.equal(initial.checks.every((check) => check.status === "TODO" && check.version === 0), true);

  const denied = saveProjectCheck(store, { templateId: "web", status: "TODO" }, { role: "Customer", tenantId: "desk" }, clock);
  assert.equal(denied.error, "role scope denied");

  const missing = saveProjectCheck(store, {
    templateId: "web",
    status: "PASS",
    owner: "phase desk",
    dueOn: "2026-10-08",
  }, actor, clock);
  assert.equal(missing.error, "PASS requires evidence");
  assert.equal(store.records.length, 0);

  const blocked = saveProjectCheck(store, {
    templateId: "web",
    status: "BLOCKED",
    owner: "phase desk",
    dueOn: "2026-10-08",
    dependsOn: null,
  }, actor, clock);
  assert.equal(blocked.ok, true);
  const downstream = saveProjectCheck(store, {
    templateId: "api",
    status: "IN_PROGRESS",
    dependsOn: "web",
  }, actor, clock);
  assert.equal(downstream.error, "a BLOCKED dependency locks the downstream task");
  assert.equal(readProjectChecklist(store).checks.find((check) => check.templateId === "api").status, "TODO");

  const secret = saveProjectCheck(store, {
    templateId: "web",
    status: "TODO",
    evidenceUrl: `https://user:${SECRET}@example.com/checklist`,
  }, actor, clock);
  assert.equal(secret.error, "secret value is not allowed");
  assert.equal(JSON.stringify(store).includes(SECRET), false);

  const passed = saveProjectCheck(store, {
    templateId: "web",
    status: "PASS",
    owner: "phase desk",
    dueOn: "2026-10-08",
    evidenceUrl: "https://example.com/checklist/web",
    reviewer: "desk reviewer",
    reviewedAt: "2026-10-07T12:00:00.000Z",
    dependsOn: null,
  }, actor, clock);
  assert.equal(passed.ok, true);
  const web = passed.checks.find((check) => check.templateId === "web");
  assert.equal(web.status, "PASS");
  assert.equal(web.version, 2);
  assert.deepEqual(web.history.map((item) => item.status), ["BLOCKED", "PASS"]);
  assert.equal(web.reviewedAt, "2026-10-07T12:00:00.000Z");

  const live = saveProjectCheck(store, { templateId: "data", status: "LIVE" }, actor, clock);
  assert.equal(live.error, "invalid status");
});

test("monitored error event opens one TODO issue", () => {
  const store = createProjectChecklistStore();
  const event = {
    correlationId: "11111111-1111-4111-8111-111111111111",
    section: "Checklist",
    route: "/api/view-state",
    httpStatus: 500,
    recordedAt: "2026-10-07T12:00:00.000Z",
    password: SECRET,
  };
  const opened = openIssueFromMonitoredError(store, event, actor);
  assert.equal(opened.ok, true);
  assert.equal(opened.duplicate, false);
  assert.equal(opened.issue.status, "TODO");
  assert.equal(opened.issue.httpStatus, 500);
  assert.equal(JSON.stringify(opened).includes(SECRET), false);
  const again = openIssueFromMonitoredError(store, event, actor);
  assert.equal(again.duplicate, true);
  assert.equal(store.issues.length, 1);
  const ignored = openIssueFromMonitoredError(store, { ...event, correlationId: "33333333-3333-4333-8333-333333333333", httpStatus: 200 }, actor);
  assert.equal(ignored.error, "monitored event is not an error");
});

test("API keeps a saved version and rejects a pass without evidence", async () => {
  const store = createProjectChecklistStore();
  const adminSession = sessionFor(admin);
  const userSession = sessionFor(user);
  const cases = [];

  const csrfOnly = await postProjectChecklist(new Request("http://localhost/api/project-checklist", {
    method: "POST",
    headers: { "content-type": "application/json", "x-csrf-token": adminSession.csrfToken },
    body: JSON.stringify({ templateId: "scoring", status: "TODO", owner: "phase desk" }),
  }), store);
  assert.equal(csrfOnly.status, 200);
  const userCsrf = await postProjectChecklist(new Request("http://localhost/api/project-checklist", {
    method: "POST",
    headers: { "content-type": "application/json", "x-csrf-token": userSession.csrfToken },
    body: JSON.stringify({ templateId: "scoring", status: "IN_PROGRESS" }),
  }), store);
  assert.equal(userCsrf.status, 403);
  cases.push({ case: "csrf without the secure cookie", admin: 200, user: 403 });

  const signedOut = await postProjectChecklist(
    requestFor("http://localhost/api/project-checklist", null, { templateId: "web", status: "TODO" }),
    store,
  );
  assert.equal(signedOut.status, 401);
  cases.push({ case: "signed out write", status: 401 });

  const userWrite = await postProjectChecklist(
    requestFor("http://localhost/api/project-checklist", userSession, { templateId: "web", status: "TODO" }),
    store,
  );
  assert.equal(userWrite.status, 403);
  assert.equal((await userWrite.json()).error, "role scope denied");
  cases.push({ case: "user write", status: 403 });

  const forged = await postProjectChecklist(
    requestFor("http://localhost/api/project-checklist", adminSession, {
      templateId: "web",
      status: "PASS",
      role: "Admin",
    }),
    store,
  );
  assert.equal(forged.status, 400);
  assert.equal((await forged.json()).error, "unknown field");

  const barePass = await postProjectChecklist(
    requestFor("http://localhost/api/project-checklist", adminSession, { templateId: "web", status: "PASS" }),
    store,
  );
  assert.equal(barePass.status, 400);
  assert.equal((await barePass.json()).error, "PASS requires evidence");
  cases.push({ case: "PASS without evidence", status: 400 });

  const blocked = await postProjectChecklist(
    requestFor("http://localhost/api/project-checklist", adminSession, {
      templateId: "web",
      status: "BLOCKED",
      owner: "phase desk",
      dueOn: "2026-10-08",
      dependsOn: null,
    }),
    store,
  );
  assert.equal(blocked.status, 200);
  const locked = await postProjectChecklist(
    requestFor("http://localhost/api/project-checklist", adminSession, {
      templateId: "api",
      status: "IN_PROGRESS",
      dependsOn: "web",
    }),
    store,
  );
  assert.equal(locked.status, 400);
  assert.equal((await locked.json()).error, "a BLOCKED dependency locks the downstream task");
  cases.push({ case: "blocked dependency", status: 400 });

  const passed = await postProjectChecklist(
    requestFor("http://localhost/api/project-checklist", adminSession, {
      templateId: "web",
      status: "PASS",
      owner: "phase desk",
      dueOn: "2026-10-08",
      evidenceUrl: "https://example.com/checklist/web",
      reviewer: "desk reviewer",
      reviewedAt: "2026-10-07T12:00:00.000Z",
      dependsOn: null,
    }),
    store,
  );
  assert.equal(passed.status, 200);
  const reloaded = await getProjectChecklist(requestFor("http://localhost/api/project-checklist", null), store);
  const body = await reloaded.json();
  const web = body.checks.find((check) => check.templateId === "web");
  const api = body.checks.find((check) => check.templateId === "api");
  assert.equal(web.status, "PASS");
  assert.equal(web.version, 2);
  assert.equal(web.owner, "phase desk");
  assert.equal(web.dueOn, "2026-10-08");
  assert.equal(api.status, "TODO");
  assert.equal(api.version, 0);
  cases.push({ case: "reload keeps the saved version", version: web.version });

  const issue = await postProjectChecklistIssue(
    requestFor("http://localhost/api/project-checklist/issue", adminSession, {
      correlationId: "11111111-1111-4111-8111-111111111111",
      section: "Checklist",
      route: "/api/view-state",
      httpStatus: 500,
      recordedAt: "2026-10-07T12:00:00.000Z",
      api_key: SECRET,
    }),
    store,
  );
  assert.equal(issue.status, 400);
  const opened = await postProjectChecklistIssue(
    requestFor("http://localhost/api/project-checklist/issue", adminSession, {
      correlationId: "11111111-1111-4111-8111-111111111111",
      section: "Checklist",
      route: "/api/view-state",
      httpStatus: 500,
      recordedAt: "2026-10-07T12:00:00.000Z",
    }),
    store,
  );
  assert.equal(opened.status, 200);
  const openedBody = await opened.json();
  assert.equal(openedBody.issue.status, "TODO");
  assert.equal(openedBody.duplicate, false);
  const duplicate = await postProjectChecklistIssue(
    requestFor("http://localhost/api/project-checklist/issue", adminSession, {
      correlationId: "11111111-1111-4111-8111-111111111111",
      section: "Checklist",
      route: "/api/view-state",
      httpStatus: 500,
      recordedAt: "2026-10-07T12:00:00.000Z",
    }),
    store,
  );
  assert.equal((await duplicate.json()).duplicate, true);
  assert.equal(store.issues.length, 1);
  assert.equal(JSON.stringify(store).includes(SECRET), false);
  cases.push({ case: "one issue from the monitored event", issues: 1 });

  await mkdir(evidenceDir, { recursive: true });
  await writeFile(resolve(evidenceDir, "api-integration.json"), `${JSON.stringify({
    task: "1.C.2",
    date: "2026-10-07",
    truth: "MOCK",
    cases,
  }, null, 2)}\n`);
});
