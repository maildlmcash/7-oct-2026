-- Forward migration for the checklist entities.
-- PostgreSQL is the transactional database named in design section 13.
-- No existing database convention was present in this repository.
-- Key type is bigint identity because the source does not name a key type.

BEGIN;

CREATE TABLE tenant (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY
);

CREATE TABLE project (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  tenant_id bigint NOT NULL REFERENCES tenant (id),
  scope text,
  dependency text,
  data_licence text,
  owner text,
  environment text,
  change_approval text,
  UNIQUE (id, tenant_id)
);

CREATE TABLE checklist_template (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  tenant_id bigint NOT NULL REFERENCES tenant (id),
  area_platform text NOT NULL,
  requirement text NOT NULL,
  test_method text NOT NULL,
  expected_value text NOT NULL,
  owner text,
  dependency_gate text,
  version text NOT NULL,
  UNIQUE (id, tenant_id)
);

CREATE TABLE checklist_item (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  tenant_id bigint NOT NULL,
  project_id bigint NOT NULL,
  parent_id bigint,
  phase_id text NOT NULL,
  template_id bigint,
  title text NOT NULL,
  scope text NOT NULL,
  status text NOT NULL,
  owner text,
  dependency text,
  enabled boolean NOT NULL,
  not_applicable_reason text,
  not_applicable_approver text,
  pass_expiry timestamptz,
  UNIQUE (id, tenant_id),
  UNIQUE (id, tenant_id, project_id),
  FOREIGN KEY (project_id, tenant_id) REFERENCES project (id, tenant_id),
  FOREIGN KEY (parent_id, tenant_id, project_id) REFERENCES checklist_item (id, tenant_id, project_id),
  FOREIGN KEY (template_id, tenant_id) REFERENCES checklist_template (id, tenant_id),
  CONSTRAINT checklist_item_title_present CHECK (length(btrim(title)) > 0),
  CONSTRAINT checklist_item_not_applicable CHECK (
    status <> 'NOT_APPLICABLE'
    OR (
      length(btrim(not_applicable_reason)) > 0
      AND length(btrim(not_applicable_approver)) > 0
    )
  ),
  CONSTRAINT checklist_item_pass_expiry CHECK (
    status <> 'PASS' OR pass_expiry IS NOT NULL
  )
);

CREATE TABLE finding (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  tenant_id bigint NOT NULL,
  checklist_item_id bigint NOT NULL,
  dedupe_fingerprint text NOT NULL,
  affected_page text,
  affected_api text,
  affected_device text,
  affected_release text,
  first_seen timestamptz NOT NULL,
  last_seen timestamptz NOT NULL,
  seen_count integer NOT NULL,
  suspected_cause text,
  confidence text,
  trace_repro text,
  owner text,
  status text NOT NULL,
  UNIQUE (tenant_id, dedupe_fingerprint),
  UNIQUE (id, tenant_id),
  FOREIGN KEY (checklist_item_id, tenant_id) REFERENCES checklist_item (id, tenant_id)
);

CREATE TABLE check_run (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  tenant_id bigint NOT NULL,
  checklist_item_id bigint NOT NULL,
  environment text,
  build_sha text,
  device_browser text,
  started_at timestamptz,
  ended_at timestamptz,
  observed_value text,
  result text NOT NULL,
  trace_id text,
  evidence_url text,
  not_applicable_reason text,
  not_applicable_approver text,
  pass_expiry timestamptz,
  UNIQUE (id, tenant_id),
  FOREIGN KEY (checklist_item_id, tenant_id) REFERENCES checklist_item (id, tenant_id),
  CONSTRAINT check_run_not_applicable CHECK (
    result <> 'NOT_APPLICABLE'
    OR (
      length(btrim(not_applicable_reason)) > 0
      AND length(btrim(not_applicable_approver)) > 0
    )
  ),
  CONSTRAINT check_run_pass_expiry CHECK (
    result <> 'PASS' OR pass_expiry IS NOT NULL
  ),
  CONSTRAINT check_run_time_order CHECK (
    started_at IS NULL OR ended_at IS NULL OR ended_at >= started_at
  )
);

CREATE TABLE evidence (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  tenant_id bigint NOT NULL,
  check_run_id bigint,
  finding_id bigint,
  url text NOT NULL,
  UNIQUE (id, tenant_id),
  FOREIGN KEY (check_run_id, tenant_id) REFERENCES check_run (id, tenant_id),
  FOREIGN KEY (finding_id, tenant_id) REFERENCES finding (id, tenant_id),
  CONSTRAINT evidence_has_parent CHECK (
    check_run_id IS NOT NULL OR finding_id IS NOT NULL
  ),
  CONSTRAINT evidence_url_present CHECK (length(btrim(url)) > 0)
);

CREATE TABLE audit_record (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  tenant_id bigint NOT NULL REFERENCES tenant (id),
  actor text NOT NULL,
  before_value text,
  after_value text,
  reason text,
  approval text,
  changed_at timestamptz NOT NULL,
  config_checksum text
);

CREATE FUNCTION checklist_item_requires_finding()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.status IN ('FAIL', 'BLOCKED') THEN
    IF NOT EXISTS (
      SELECT 1
      FROM finding
      WHERE checklist_item_id = NEW.id
        AND tenant_id = NEW.tenant_id
    ) THEN
      RAISE EXCEPTION 'FAIL or BLOCKED requires a linked finding';
    END IF;
  END IF;
  RETURN NULL;
END;
$$;

CREATE CONSTRAINT TRIGGER checklist_item_requires_finding
AFTER INSERT OR UPDATE OF status ON checklist_item
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW
EXECUTE FUNCTION checklist_item_requires_finding();

CREATE FUNCTION check_run_requires_finding()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.result IN ('FAIL', 'BLOCKED') THEN
    IF NOT EXISTS (
      SELECT 1
      FROM finding
      WHERE checklist_item_id = NEW.checklist_item_id
        AND tenant_id = NEW.tenant_id
    ) THEN
      RAISE EXCEPTION 'FAIL or BLOCKED requires a linked finding';
    END IF;
  END IF;
  RETURN NULL;
END;
$$;

CREATE CONSTRAINT TRIGGER check_run_requires_finding
AFTER INSERT OR UPDATE OF result ON check_run
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW
EXECUTE FUNCTION check_run_requires_finding();

CREATE FUNCTION checklist_audit_append_only()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'audit records are append-only';
END;
$$;

CREATE TRIGGER checklist_audit_no_update
BEFORE UPDATE OR DELETE ON audit_record
FOR EACH ROW
EXECUTE FUNCTION checklist_audit_append_only();

CREATE TRIGGER checklist_audit_no_truncate
BEFORE TRUNCATE ON audit_record
FOR EACH STATEMENT
EXECUTE FUNCTION checklist_audit_append_only();

COMMIT;
