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

test("provider versions stay after archive and audit rows stay append-only", () => {
  runFile("../data/migrations/0008_provider_registry_rollback.sql");
  runFile("../data/migrations/0001_checklist_entities.sql");
  runFile("../data/migrations/0008_provider_registry.sql");
  runFile("../data/migrations/0009_provider_vault_references.sql");
  runFile("../data/migrations/0010_provider_actions.sql");
  runFile("../data/migrations/0011_provider_health.sql");
  runFile("../data/migrations/0012_provider_review.sql");
  runFile("../data/migrations/0013_provider_documentation.sql");

  const listed = run(`
    INSERT INTO tenant DEFAULT VALUES RETURNING id \\gset t_
    INSERT INTO provider_registry (
      tenant_id, kind, product, channel, docs_reference, region,
      limits, heartbeat, status, version
    ) VALUES (
      :t_id, 'CEX', 'spot', 'trades', 'https://example.test/docs', 'caller-region',
      'caller limit text', 'caller heartbeat text', 'caller-status', '1'
    ) RETURNING id \\gset first_
    INSERT INTO provider_registry (
      tenant_id, lineage_id, kind, product, channel, docs_reference, region,
      limits, heartbeat, status, last_error, version
    ) VALUES (
      :t_id, :first_id, 'CEX', 'spot', 'book', 'https://example.test/docs', 'caller-region',
      'caller limit text', 'caller heartbeat text', 'caller-status', 'caller last error', '2'
    );
    INSERT INTO audit_record (tenant_id, actor, before_value, after_value, changed_at)
    VALUES
      (:t_id, 'admin-1', NULL, '{"action":"create","version":"1"}', '2026-10-06T00:00:00Z'),
      (:t_id, 'admin-1', '{"version":"1"}', '{"action":"update","version":"2"}', '2026-10-06T01:00:00Z');
    UPDATE provider_registry
    SET archived_at = '2026-10-06T02:00:00Z'
    WHERE lineage_id = :first_id;
    INSERT INTO audit_record (tenant_id, actor, before_value, after_value, changed_at)
    VALUES (
      :t_id, 'admin-1', '{"version":"2"}', '{"action":"archive"}', '2026-10-06T02:00:00Z'
    );
    SELECT string_agg(version, ',' ORDER BY id)
      || '|' || count(archived_at)::text
      || '|' || (SELECT count(*) FROM audit_record)::text
    FROM provider_registry
    WHERE lineage_id = :first_id;
  `);
  assert.equal(listed, "1,2|2|3");

  expectError(
    `UPDATE provider_registry SET product = 'margin' WHERE version = '1';`,
    /provider versions are append-only/,
  );
  expectError(
    `DELETE FROM provider_registry WHERE version = '1';`,
    /provider versions are not deleted/,
  );
  expectError(
    `UPDATE provider_registry SET archived_at = NULL WHERE version = '2';`,
    /archived provider versions stay archived/,
  );
  expectError(
    `INSERT INTO provider_registry (
      tenant_id, kind, product, channel, docs_reference, region, status, version
    )
    SELECT id, 'venue', 'spot', 'trades', 'https://example.test/docs', 'caller-region', 'caller-status', '1'
    FROM tenant;`,
    /provider_registry_kind_known/,
  );
  expectError(
    `UPDATE audit_record SET actor = 'other' WHERE actor = 'admin-1';`,
    /audit records are append-only/,
  );

  const scopes = run(`
    INSERT INTO tenant DEFAULT VALUES RETURNING id \\gset t_
    INSERT INTO provider_registry (
      tenant_id, kind, product, channel, docs_reference, region, status, version,
      market_data_vault_reference, market_data_scope,
      order_vault_reference, order_scope, withdrawals
    ) VALUES (
      :t_id, 'market-data API', 'spot', 'ticker', 'https://example.test/docs', 'caller-region',
      'caller-status', '1',
      'vault-ref-market-data', 'read-only',
      'vault-ref-orders', 'order-capable', false
    );
    INSERT INTO audit_record (tenant_id, actor, before_value, after_value, changed_at)
    VALUES (
      :t_id, 'admin-1', NULL,
      '{"marketData":"vault-ref-market-data","orders":"vault-ref-orders"}',
      '2026-10-06T04:00:00Z'
    );
    SELECT market_data_scope || '|' || order_scope || '|' || withdrawals::text
      || '|' || (
        SELECT count(*) FROM audit_record
        WHERE after_value LIKE '%super-secret-value%'
      )::text
    FROM provider_registry
    WHERE market_data_vault_reference = 'vault-ref-market-data';
  `);
  assert.equal(scopes, "read-only|order-capable|false|0");
  expectError(
    `INSERT INTO provider_registry (
      tenant_id, kind, product, channel, docs_reference, region, status, version,
      market_data_vault_reference, market_data_scope
    )
    SELECT id, 'CEX', 'spot', 'trades', 'https://example.test/docs', 'caller-region',
      'caller-status', '1', 'vault-ref-market-data', 'order-capable'
    FROM tenant LIMIT 1;`,
    /provider_registry_market_data_scope/,
  );
  expectError(
    `INSERT INTO provider_registry (
      tenant_id, kind, product, channel, docs_reference, region, status, version,
      market_data_vault_reference, market_data_scope,
      order_vault_reference, order_scope
    )
    SELECT id, 'CEX', 'spot', 'trades', 'https://example.test/docs', 'caller-region',
      'caller-status', '9', 'vault-ref-shared', 'read-only', 'vault-ref-shared', 'order-capable'
    FROM tenant LIMIT 1;`,
    /provider_registry_credentials_separate/,
  );
  expectError(
    `INSERT INTO provider_registry (
      tenant_id, kind, product, channel, docs_reference, region, status, version, withdrawals
    )
    SELECT id, 'CEX', 'spot', 'trades', 'https://example.test/docs', 'caller-region',
      'caller-status', '8', true
    FROM tenant LIMIT 1;`,
    /provider_registry_withdrawals_closed/,
  );
  expectError(
    `UPDATE provider_registry
    SET market_data_vault_reference = 'vault-ref-other'
    WHERE market_data_vault_reference = 'vault-ref-market-data';`,
    /provider versions are append-only/,
  );

  const actions = run(`
    INSERT INTO provider_action (tenant_id, lineage_id, action, confirmed, auto_start, recorded_at)
    SELECT id, 1, 'test-connection', false, false, '2026-10-06T01:00:00Z' FROM tenant LIMIT 1;
    INSERT INTO provider_action (tenant_id, lineage_id, action, confirmed, auto_start, recorded_at)
    SELECT id, 1, 'fetch-once', false, false, '2026-10-06T02:00:00Z' FROM tenant LIMIT 1;
    INSERT INTO provider_action (tenant_id, lineage_id, action, confirmed, auto_start, recorded_at)
    SELECT id, 1, 'auto-start', true, true, '2026-10-06T03:00:00Z' FROM tenant LIMIT 1;
    SELECT string_agg(action, ',' ORDER BY id) || '|' ||
      (SELECT auto_start::text FROM provider_registry ORDER BY id LIMIT 1)
    FROM provider_action;
  `);
  assert.equal(actions, "test-connection,fetch-once,auto-start|false");
  expectError(
    `INSERT INTO provider_registry (
      tenant_id, kind, product, channel, docs_reference, region, status, version, auto_start
    )
    SELECT id, 'CEX', 'spot', 'trades', 'https://example.test/docs', 'caller-region',
      'caller-status', '7', true
    FROM tenant LIMIT 1;`,
    /provider_registry_auto_start_off/,
  );
  expectError(
    `INSERT INTO provider_action (tenant_id, lineage_id, action, confirmed, auto_start, recorded_at)
    SELECT id, 1, 'test-connection', false, true, '2026-10-06T04:00:00Z' FROM tenant LIMIT 1;`,
    /provider_action_auto_separated/,
  );
  expectError(
    `INSERT INTO provider_action (tenant_id, lineage_id, action, confirmed, auto_start, recorded_at)
    SELECT id, 1, 'auto-start', false, true, '2026-10-06T04:00:00Z' FROM tenant LIMIT 1;`,
    /provider_action_auto_separated/,
  );
  expectError(
    `DELETE FROM provider_action WHERE action = 'test-connection';`,
    /provider actions are append-only/,
  );

  const health = run(`
    INSERT INTO provider_health (
      tenant_id, lineage_id, connection_status, heartbeat_age, retry_budget,
      attempts, backoff_state, status, rate_limit_headers, documented_limit,
      safety_margin, recorded_at
    )
    SELECT id, 1, 'disconnected', '5', 2, 2, 'bounded', 'degraded',
      '{"retry-after":"caller-retry-after"}', '10', '3', '2026-10-06T01:00:00Z'
    FROM tenant LIMIT 1;
    SELECT status || '|' || attempts::text || '|' || backoff_state || '|' || connection_status
    FROM provider_health;
  `);
  assert.equal(health, "degraded|2|bounded|disconnected");
  expectError(
    `INSERT INTO provider_health (
      tenant_id, lineage_id, retry_budget, attempts, backoff_state, status, recorded_at
    )
    SELECT id, 1, 2, 5, 'bounded', 'degraded', '2026-10-06T02:00:00Z'
    FROM tenant LIMIT 1;`,
    /provider_health_attempts_bounded/,
  );
  expectError(
    `DELETE FROM provider_health WHERE status = 'degraded';`,
    /provider health is append-only/,
  );

  const reviews = run(`
    INSERT INTO provider_review (tenant_id, lineage_id, provider_id, action, actor, recorded_at)
    SELECT id, 1, 1, 'approve', 'admin-2', '2026-10-06T02:00:00Z' FROM tenant LIMIT 1;
    INSERT INTO provider_review (tenant_id, lineage_id, provider_id, action, actor, recorded_at)
    SELECT id, 1, 1, 'rollback', 'admin-2', '2026-10-06T03:00:00Z' FROM tenant LIMIT 1;
    SELECT string_agg(action, ',' ORDER BY id)
      || '|' || (SELECT count(*) FROM provider_registry)::text
    FROM provider_review;
  `);
  assert.equal(reviews.endsWith("|"), false);
  assert.equal(reviews.startsWith("approve,rollback|"), true);
  const providerCount = Number(reviews.split("|")[1]);
  assert.equal(providerCount > 0, true);
  expectError(
    `DELETE FROM provider_review WHERE action = 'approve';`,
    /provider reviews are append-only/,
  );

  const documentation = run(`
    INSERT INTO provider_documentation (
      tenant_id, lineage_id, documentation_url, checked_at, supported_products,
      verification_owner, enabled, stale, recorded_at
    )
    SELECT id, 1, 'https://example.test/official-docs', '2026-10-06T03:00:00Z',
      'spot', 'ada', true, false, '2026-10-06T04:00:00Z'
    FROM tenant LIMIT 1;
    INSERT INTO provider_documentation (
      tenant_id, lineage_id, documentation_url, checked_at, supported_products,
      verification_owner, enabled, stale, recorded_at
    )
    SELECT id, 1, 'https://example.test/official-docs', '2026-10-06T03:00:00Z',
      'spot', 'ada', true, true, '2026-10-06T05:00:00Z'
    FROM tenant LIMIT 1;
    INSERT INTO provider_documentation (
      tenant_id, lineage_id, enabled, stale, recorded_at
    )
    SELECT id, 1, false, false, '2026-10-06T06:00:00Z'
    FROM tenant LIMIT 1;
    SELECT string_agg(
      coalesce(documentation_url, 'none') || '|' || enabled::text || '|' || stale::text
        || '|' || (checked_at IS NOT NULL)::text || '|' || coalesce(verification_owner, 'none')
        || '|' || coalesce(supported_products, 'none'),
      ',' ORDER BY id
    )
    FROM provider_documentation;
  `);
  assert.equal(
    documentation,
    "https://example.test/official-docs|true|false|true|ada|spot,https://example.test/official-docs|true|true|true|ada|spot,none|false|false|false|none|none",
  );
  assert.equal(run(`
    SELECT count(*) FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'provider_documentation'
      AND column_name = 'verified';
  `), "0");
  expectError(
    `INSERT INTO provider_documentation (
      tenant_id, lineage_id, documentation_url, checked_at, supported_products,
      verification_owner, enabled, stale, recorded_at
    )
    SELECT id, 1, 'https://example.test/official-docs', NULL, 'spot', 'ada', true, false,
      '2026-10-06T07:00:00Z'
    FROM tenant LIMIT 1;`,
    /provider_documentation_enabled_reviewed/,
  );
  expectError(
    `INSERT INTO provider_documentation (
      tenant_id, lineage_id, documentation_url, checked_at, supported_products,
      verification_owner, enabled, stale, recorded_at
    )
    SELECT id, 1, 'https://user:hidden@example.test/docs', '2026-10-06T03:00:00Z',
      'spot', 'ada', true, false, '2026-10-06T07:00:00Z'
    FROM tenant LIMIT 1;`,
    /provider_documentation_enabled_reviewed/,
  );
  expectError(
    `DELETE FROM provider_documentation WHERE verification_owner = 'ada';`,
    /provider documentation is append-only/,
  );

  runFile("../data/migrations/0013_provider_documentation_rollback.sql");
  runFile("../data/migrations/0012_provider_review_rollback.sql");
  runFile("../data/migrations/0011_provider_health_rollback.sql");
  runFile("../data/migrations/0010_provider_actions_rollback.sql");
  runFile("../data/migrations/0009_provider_vault_references_rollback.sql");
  runFile("../data/migrations/0008_provider_registry_rollback.sql");
  runFile("../data/migrations/0001_checklist_entities_rollback.sql");
  assert.equal(run(`SELECT to_regclass('public.provider_documentation') IS NULL;`), "t");
  assert.equal(run(`SELECT to_regclass('public.provider_health') IS NULL;`), "t");
  assert.equal(run(`SELECT to_regclass('public.provider_registry') IS NULL;`), "t");
  assert.equal(run(`SELECT to_regclass('public.tenant') IS NULL;`), "t");
  assert.equal(run(`SELECT to_regclass('public.privileged_audit') IS NOT NULL;`), "t");
});
