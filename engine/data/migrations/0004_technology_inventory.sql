-- Technology tracking for a checklist requirement.
-- Package presence is stored separately and cannot satisfy PASS.
-- No staleness duration or SLO number is in the source. evidence_stale is recorded,
-- not calculated from last_checked_at. Design lifecycle statuses are not this column.

BEGIN;

CREATE TABLE technology_inventory (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  tenant_id bigint NOT NULL,
  template_id bigint NOT NULL,
  required_technology text NOT NULL,
  required_version text NOT NULL,
  detected_usage_evidence text,
  owner text,
  limit_slo text,
  current_measurement text,
  last_checked_at timestamptz,
  package_presence boolean NOT NULL,
  usage_present boolean NOT NULL,
  usage_kind text,
  evidence_stale boolean NOT NULL,
  status text NOT NULL,
  UNIQUE (id, tenant_id),
  FOREIGN KEY (template_id, tenant_id) REFERENCES checklist_template (id, tenant_id),
  CONSTRAINT technology_inventory_required_text CHECK (
    length(btrim(required_technology)) > 0
    AND length(btrim(required_version)) > 0
  ),
  CONSTRAINT technology_inventory_status_known CHECK (
    status IN ('PASS', 'FAIL', 'UNKNOWN/STALE')
  ),
  CONSTRAINT technology_inventory_usage_kind_known CHECK (
    usage_kind IS NULL OR usage_kind IN ('runtime', 'build', 'runtime,build')
  ),
  CONSTRAINT technology_inventory_usage_kind_matches CHECK (
    (usage_present = false AND usage_kind IS NULL)
    OR (usage_present = true AND usage_kind IS NOT NULL)
  ),
  CONSTRAINT technology_inventory_pass_needs_fresh_usage CHECK (
    status <> 'PASS'
    OR (usage_present = true AND evidence_stale = false)
  ),
  CONSTRAINT technology_inventory_stale_needs_usage CHECK (
    status <> 'UNKNOWN/STALE'
    OR (usage_present = true AND evidence_stale = true)
  ),
  CONSTRAINT technology_inventory_fail_has_no_usage CHECK (
    status <> 'FAIL'
    OR (usage_present = false AND detected_usage_evidence IS NULL)
  )
);

COMMIT;
