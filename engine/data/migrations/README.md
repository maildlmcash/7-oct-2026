# Checklist migrations

No database convention existed in this repository. `pyproject.toml` declares no packages. `docs/admin-checklist/phase-01-baseline.md` is a written record, not a database. Design section 13 names PostgreSQL as the transactional database. Design section 19 names `data/migrations/`.

Alembic, Flyway, and a PostgreSQL version are NOT IN SOURCE. These files are plain SQL. The bigint identity key type is a storage choice because the source does not name one.

## Forward

`0001_checklist_entities.sql` runs in one transaction on an empty database. It creates `tenant`, `project`, `checklist_template`, `checklist_item`, `finding`, `check_run`, `evidence`, and `audit_record`.

Every checklist row carries `tenant_id`. Child rows use a foreign key on `(parent id, tenant_id)`, so a row cannot point at another tenant.

`audit_record` rejects update, delete, and truncate.

`0002_checklist_statuses.sql` limits `checklist_item.status` and `check_run.result` to `NOT_STARTED`, `IN_PROGRESS`, `PASS`, `FAIL`, `BLOCKED`, and `NOT_APPLICABLE`. `PASS` also needs `pass_approver`. `checklist_dependency` stores a prerequisite in the same tenant. The service in `services/checklist-status.mjs` rejects a `PASS` while a prerequisite is `NOT_STARTED`, `IN_PROGRESS`, `FAIL`, or `BLOCKED`. It rejects `IN_PROGRESS` while a prerequisite is `BLOCKED`.

`0003_checklist_template_versions.sql` adds `project_id`, `lineage_id`, and `retired_at` on `checklist_template`. A new version is a new row with the same `lineage_id`. `services/checklist-templates.mjs` keeps those rows and writes `audit_record` fields. The areas are website, API, data engine, mobile iOS, mobile Android, security, performance, backup, and release. Mobile iOS and mobile Android are separate. The checklist role in the design is Admin for that tenant. Other roles are denied.

`0004_technology_inventory.sql` stores one technology row per requirement dependency. The requirement is `checklist_template`. `services/technology-inventory.mjs` fills required technology/version, detected usage evidence, owner, limit/SLO, current measurement, last checked time, and status. A `package` evidence kind is presence only. `PASS` requires `runtime` or `build` evidence that is not marked stale. Stale usage evidence is `UNKNOWN/STALE`. No staleness duration is in the source, so `last_checked_at` does not change the status. Missing limit/SLO, owner, and current measurement display as `UNKNOWN`. Design section 22 starting targets are not copied into these rows.

`0005_checklist_runs.sql` adds manual and scheduled runs on `check_run`. `services/checklist-runs.mjs` requires environment, build SHA, and `startedAt`. The same checklist item, path, environment, build SHA, and `startedAt` returns the original run id and does not add evidence. Evidence rows attached to a run, and `check_run.evidence_url`, cannot be updated or deleted. Destructive checks stay off unless the request sets both `destructiveChecksConfigured` and `isolatedTestEnvironment`. The environment name `test` is not that flag. No schedule interval is in the source. A requested run is stored as `NOT_STARTED` because this task does not name a run outcome. The task title says on-demand; the acceptance word stored for that path is `manual`.

`0006_role_definitions.sql` stores the six role names in `role_definition`. The names match `packages/contracts/src/roles.mjs`. Customer is the only default. The table has no permission column. Phase 17 is the approval matrix.

`0007_privileged_audit.sql` stores actor, action, target, reason, and `recorded_at` for a privileged action. Rows cannot be updated, deleted, or truncated. Indexes support search by actor and time, and by action and target. The source names no identity provider, so the table has no MFA secret.

`0008_provider_registry.sql` stores versioned CEX, DEX, chain, market-data API, and WebSocket records. The columns are product, channel, docs reference, region, limits, heartbeat, status, last error, and version. Limits and heartbeat are text because the source names no numeric limit or interval. Status is text because the source names no provider status set. A new version is a new row with the same `lineage_id`. `archived_at` marks the lineage and does not delete rows. Content columns cannot be updated. `services/provider-registry.mjs` writes an audit row for create, update, and archive. The service does not open a connection and does not store a secret value.

`0009_provider_vault_references.sql` adds a market-data vault reference with scope `read-only` and a separate order vault reference with scope `order-capable`. The source names no secret-manager product, so the columns store the reference only. The two references cannot be equal. `withdrawals` must stay false. A secret value is rejected by the service and is not written into the audit row.

`0010_provider_actions.sql` keeps `provider_registry.auto_start` false. Test Connection and Fetch Once are `provider_action` rows that cannot turn auto on. Auto Start is a separate row and requires confirmation. Rows cannot be updated, deleted, or truncated. The migration opens no connection and stores no secret.

`0011_provider_health.sql` stores rate-limit headers, connection status, heartbeat age, retry budget, attempts, backoff state, and degraded status per lineage. Attempts cannot exceed the caller budget. The source names no retry budget or safety margin, so those values are not defaulted here. The migration opens no connection and stores no secret.

`0012_provider_review.sql` stores approve and rollback rows for a provider version. Rows cannot be updated, deleted, or truncated. Provider versions stay in place. The migration stores no secret.

`0013_provider_documentation.sql` stores the official documentation URL, checked-at time, supported products, verification owner, enabled flag, and stale flag. An enabled row needs a documentation URL and a checked-at time. The source names no review age, so stale is stored and not calculated. Rows cannot be updated, deleted, or truncated. The migration opens no connection and stores no secret.

`0014_identity_role_tenant.sql` adds `tenant.parent_id` and `tenant.status`, then `identity_principal`, `identity_role_assignment`, `identity_capability`, and `identity_capability_rule`. A parent principal must share the child row's tenant. Retailer and Customer are the only two roles one principal may hold. Capability names are inserted. No allow rule is inserted. The file stores no secret, order, or wallet column.

`0015_project_checklist.sql` adds `project_check_template`, `project_check`, and `project_check_issue`. Templates are web, API, data, scoring, paper engine, iOS, and Android. Status values are `TODO`, `IN_PROGRESS`, `PASS`, `FAIL`, and `BLOCKED`. A new edit is a new version. `PASS` needs an evidence link, a reviewer, and `reviewed_at`. A downstream `IN_PROGRESS` or `PASS` is rejected while the dependency's latest status is `BLOCKED`. An issue row stays `TODO` and needs an HTTP status of 400 or higher. This table does not change `checklist_item`.

## Rollback

`0015_project_checklist_rollback.sql` drops the project checklist tables and functions. Apply it before `0001_checklist_entities_rollback.sql`. It does not drop `tenant` or `checklist_item`.

`0014_identity_role_tenant_rollback.sql` drops the identity tables and the tenant parent and status columns. Apply it before `0006_role_definitions_rollback.sql` and before `0001_checklist_entities_rollback.sql`. It does not drop `privileged_audit`.

`0013_provider_documentation_rollback.sql` drops `provider_documentation`. Apply it before `0012_provider_review_rollback.sql`.

`0012_provider_review_rollback.sql` drops `provider_review`. Apply it before `0011_provider_health_rollback.sql`.

`0011_provider_health_rollback.sql` drops `provider_health`. Apply it before `0010_provider_actions_rollback.sql`.

`0010_provider_actions_rollback.sql` drops `provider_action` and `auto_start`. Apply it before `0009_provider_vault_references_rollback.sql`.

`0009_provider_vault_references_rollback.sql` drops the vault reference columns. Apply it before `0008_provider_registry_rollback.sql`.

`0008_provider_registry_rollback.sql` drops `provider_registry`. Apply it before `0001_checklist_entities_rollback.sql`. It does not drop `privileged_audit`.

`0007_privileged_audit_rollback.sql` drops `privileged_audit`. Apply it before `0006_role_definitions_rollback.sql`.

`0006_role_definitions_rollback.sql` drops `role_definition`. Apply it before `0005_checklist_runs_rollback.sql`.

`0005_checklist_runs_rollback.sql` drops the run path, destructive-check columns, and evidence immutability triggers. Apply it before `0004_technology_inventory_rollback.sql`.

`0004_technology_inventory_rollback.sql` drops `technology_inventory`. Apply it before `0003_checklist_template_versions_rollback.sql`.

`0003_checklist_template_versions_rollback.sql` drops `project_id`, `lineage_id`, and `retired_at`. Apply it before `0002_checklist_statuses_rollback.sql`.

`0002_checklist_statuses_rollback.sql` drops the dependency table, the status checks, and `pass_approver`. Apply it before `0001_checklist_entities_rollback.sql`.

`0001_checklist_entities_rollback.sql` drops the checklist tables and the three functions. Rollback deletes the rows in those tables.

Apply rollback, then forward, to recreate the empty schema.

## Commands

```text
psql -v ON_ERROR_STOP=1 -f data/migrations/0001_checklist_entities.sql
psql -v ON_ERROR_STOP=1 -f data/migrations/0002_checklist_statuses.sql
psql -v ON_ERROR_STOP=1 -f data/migrations/0003_checklist_template_versions.sql
psql -v ON_ERROR_STOP=1 -f data/migrations/0004_technology_inventory.sql
psql -v ON_ERROR_STOP=1 -f data/migrations/0005_checklist_runs.sql
psql -v ON_ERROR_STOP=1 -f data/migrations/0006_role_definitions.sql
psql -v ON_ERROR_STOP=1 -f data/migrations/0007_privileged_audit.sql
psql -v ON_ERROR_STOP=1 -f data/migrations/0008_provider_registry.sql
psql -v ON_ERROR_STOP=1 -f data/migrations/0009_provider_vault_references.sql
psql -v ON_ERROR_STOP=1 -f data/migrations/0010_provider_actions.sql
psql -v ON_ERROR_STOP=1 -f data/migrations/0011_provider_health.sql
psql -v ON_ERROR_STOP=1 -f data/migrations/0012_provider_review.sql
psql -v ON_ERROR_STOP=1 -f data/migrations/0013_provider_documentation.sql
psql -v ON_ERROR_STOP=1 -f data/migrations/0014_identity_role_tenant.sql
psql -v ON_ERROR_STOP=1 -f data/migrations/0015_project_checklist.sql
psql -v ON_ERROR_STOP=1 -f data/migrations/0015_project_checklist_rollback.sql
psql -v ON_ERROR_STOP=1 -f data/migrations/0014_identity_role_tenant_rollback.sql
psql -v ON_ERROR_STOP=1 -f data/migrations/0013_provider_documentation_rollback.sql
psql -v ON_ERROR_STOP=1 -f data/migrations/0012_provider_review_rollback.sql
psql -v ON_ERROR_STOP=1 -f data/migrations/0011_provider_health_rollback.sql
psql -v ON_ERROR_STOP=1 -f data/migrations/0010_provider_actions_rollback.sql
psql -v ON_ERROR_STOP=1 -f data/migrations/0009_provider_vault_references_rollback.sql
psql -v ON_ERROR_STOP=1 -f data/migrations/0008_provider_registry_rollback.sql
psql -v ON_ERROR_STOP=1 -f data/migrations/0007_privileged_audit_rollback.sql
psql -v ON_ERROR_STOP=1 -f data/migrations/0006_role_definitions_rollback.sql
psql -v ON_ERROR_STOP=1 -f data/migrations/0005_checklist_runs_rollback.sql
psql -v ON_ERROR_STOP=1 -f data/migrations/0004_technology_inventory_rollback.sql
psql -v ON_ERROR_STOP=1 -f data/migrations/0003_checklist_template_versions_rollback.sql
psql -v ON_ERROR_STOP=1 -f data/migrations/0002_checklist_statuses_rollback.sql
psql -v ON_ERROR_STOP=1 -f data/migrations/0001_checklist_entities_rollback.sql
pnpm test:checklist-schema
pnpm test:checklist-status
pnpm test:checklist-templates
pnpm test:technology-inventory
pnpm test:checklist-runs
pnpm test:provider-registry
```

`pnpm test:checklist-schema`, the migration half of `pnpm test:checklist-status`, the migration half of `pnpm test:technology-inventory`, and the migration half of `pnpm test:checklist-runs` need a reachable PostgreSQL and `psql` on `PATH`, or `PSQL` set to the client binary. The service tests do not need a database. GitHub Actions does not run these database tests.

## Conflict, not resolved

Design section 20 lists statuses `NOT_STARTED`, `READY`, `RUNNING`, `PASS`, `FAIL`, `BLOCKED`, and `NOT_APPLICABLE`. Task 02.A.02 lists `NOT_STARTED`, `IN_PROGRESS`, `PASS`, `FAIL`, `BLOCKED`, and `NOT_APPLICABLE`. Migration 0002 follows the task list. `READY` and `RUNNING` are rejected. They are not treated as `IN_PROGRESS`.

Which role may be an authorized approver is NOT IN SOURCE. The service requires a non-blank approver and does not check a role.

The shared rules that are enforced now: `NOT_APPLICABLE` needs a reason and an approver, `PASS` needs `pass_expiry`, and `FAIL` or `BLOCKED` needs a finding in the same tenant. No expiry duration is in the source, so the column has no default interval.

Task 1.C.2 does not add `TODO` to `checklist_item`. That word lives only on `project_check`.

Design section 20 lists technology inventory statuses `planned`, `installed`, `active`, `missing`, and `deprecated`. Task 02.B.02 accepts `FAIL`, `PASS`, and `UNKNOWN/STALE` for required-versus-detected usage. Migration 0004 follows the task list. The design statuses are not stored and are not aliased. This is conflict C006. Checklist item statuses are unchanged.
