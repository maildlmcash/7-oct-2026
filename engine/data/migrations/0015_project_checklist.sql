-- Versioned project checklist for task 1.C.2.
-- Separate from checklist_item. Migration 0002 keeps NOT_STARTED and NOT_APPLICABLE.
-- This table does not store a secret, an order, or a wallet balance.
-- Depends on tenant from 0001.

BEGIN;

CREATE TABLE project_check_template (
  id text PRIMARY KEY,
  title text NOT NULL,
  CONSTRAINT project_check_template_known CHECK (
    id IN ('web', 'api', 'data', 'scoring', 'paper-engine', 'ios', 'android')
  )
);

INSERT INTO project_check_template (id, title) VALUES
  ('web', 'Web'),
  ('api', 'API'),
  ('data', 'Data'),
  ('scoring', 'Scoring'),
  ('paper-engine', 'Paper engine'),
  ('ios', 'iOS'),
  ('android', 'Android');

CREATE TABLE project_check (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  tenant_id bigint NOT NULL REFERENCES tenant (id),
  lineage_id bigint NOT NULL,
  version integer NOT NULL,
  template_id text NOT NULL REFERENCES project_check_template (id),
  owner text,
  due_on date,
  evidence_url text,
  status text NOT NULL,
  depends_on bigint,
  reviewer text,
  reviewed_at timestamptz,
  recorded_at timestamptz NOT NULL,
  CONSTRAINT project_check_version_positive CHECK (version >= 1),
  CONSTRAINT project_check_status_known CHECK (
    status IN ('TODO', 'IN_PROGRESS', 'PASS', 'FAIL', 'BLOCKED')
  ),
  CONSTRAINT project_check_pass_requirements CHECK (
    status <> 'PASS'
    OR (
      length(btrim(coalesce(evidence_url, ''))) > 0
      AND length(btrim(coalesce(reviewer, ''))) > 0
      AND reviewed_at IS NOT NULL
    )
  ),
  UNIQUE (tenant_id, lineage_id, version)
);

CREATE FUNCTION project_check_before_insert()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  previous integer;
  upstream text;
BEGIN
  IF NEW.lineage_id IS NULL THEN
    NEW.lineage_id := NEW.id;
  END IF;
  SELECT max(version) INTO previous
  FROM project_check
  WHERE tenant_id = NEW.tenant_id
    AND lineage_id = NEW.lineage_id;
  IF previous IS NULL THEN
    IF NEW.version <> 1 THEN
      RAISE EXCEPTION 'checklist version must increase';
    END IF;
  ELSIF NEW.version <> previous + 1 THEN
    RAISE EXCEPTION 'checklist version must increase';
  END IF;
  IF NEW.depends_on IS NOT NULL THEN
    IF NEW.depends_on = NEW.lineage_id THEN
      RAISE EXCEPTION 'checklist dependency cycle';
    END IF;
    IF NOT EXISTS (
      SELECT 1
      FROM project_check
      WHERE tenant_id = NEW.tenant_id
        AND lineage_id = NEW.depends_on
    ) THEN
      RAISE EXCEPTION 'unknown checklist dependency';
    END IF;
    IF NEW.status IN ('IN_PROGRESS', 'PASS') THEN
      SELECT status INTO upstream
      FROM project_check
      WHERE tenant_id = NEW.tenant_id
        AND lineage_id = NEW.depends_on
      ORDER BY version DESC
      LIMIT 1;
      IF upstream = 'BLOCKED' THEN
        RAISE EXCEPTION 'a BLOCKED dependency locks the downstream task';
      END IF;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER project_check_before_insert
BEFORE INSERT ON project_check
FOR EACH ROW
EXECUTE FUNCTION project_check_before_insert();

CREATE FUNCTION project_check_immutable()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'checklist versions are immutable';
END;
$$;

CREATE TRIGGER project_check_no_update
BEFORE UPDATE OR DELETE ON project_check
FOR EACH ROW
EXECUTE FUNCTION project_check_immutable();

CREATE TABLE project_check_issue (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  tenant_id bigint NOT NULL REFERENCES tenant (id),
  correlation_id uuid NOT NULL,
  section text,
  route text,
  http_status integer NOT NULL,
  recorded_at timestamptz NOT NULL,
  status text NOT NULL DEFAULT 'TODO',
  UNIQUE (tenant_id, correlation_id),
  CONSTRAINT project_check_issue_error CHECK (http_status >= 400),
  CONSTRAINT project_check_issue_open CHECK (status = 'TODO')
);

CREATE FUNCTION project_check_issue_immutable()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'checklist issues are immutable';
END;
$$;

CREATE TRIGGER project_check_issue_no_update
BEFORE UPDATE OR DELETE ON project_check_issue
FOR EACH ROW
EXECUTE FUNCTION project_check_issue_immutable();

COMMIT;
