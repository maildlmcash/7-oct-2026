-- Manual and scheduled checklist runs.
-- Environment, build SHA, and started_at are required when run_path is set.
-- Evidence attached to a run cannot be updated or deleted.
-- Destructive checks require isolated_test_environment. The service also
-- requires an explicit configuration flag. No schedule interval is in the source.

BEGIN;

ALTER TABLE check_run ADD COLUMN run_path text;
ALTER TABLE check_run ADD COLUMN destructive_enabled boolean NOT NULL DEFAULT false;
ALTER TABLE check_run ADD COLUMN isolated_test_environment boolean NOT NULL DEFAULT false;

ALTER TABLE check_run
  ADD CONSTRAINT check_run_path_known CHECK (
    run_path IS NULL OR run_path IN ('manual', 'scheduled')
  );

ALTER TABLE check_run
  ADD CONSTRAINT check_run_request_fields CHECK (
    run_path IS NULL
    OR (
      length(btrim(coalesce(environment, ''))) > 0
      AND length(btrim(coalesce(build_sha, ''))) > 0
      AND started_at IS NOT NULL
    )
  );

ALTER TABLE check_run
  ADD CONSTRAINT check_run_destructive_isolated CHECK (
    destructive_enabled = false OR isolated_test_environment = true
  );

CREATE UNIQUE INDEX check_run_request_once
  ON check_run (tenant_id, checklist_item_id, run_path, environment, build_sha, started_at);

CREATE FUNCTION evidence_reference_immutable()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'TRUNCATE' THEN
    IF EXISTS (SELECT 1 FROM evidence WHERE check_run_id IS NOT NULL) THEN
      RAISE EXCEPTION 'evidence references are immutable';
    END IF;
    RETURN NULL;
  END IF;

  IF OLD.check_run_id IS NOT NULL THEN
    RAISE EXCEPTION 'evidence references are immutable';
  END IF;

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER evidence_reference_no_update
BEFORE UPDATE OR DELETE ON evidence
FOR EACH ROW
EXECUTE FUNCTION evidence_reference_immutable();

CREATE TRIGGER evidence_reference_no_truncate
BEFORE TRUNCATE ON evidence
FOR EACH STATEMENT
EXECUTE FUNCTION evidence_reference_immutable();

CREATE FUNCTION check_run_evidence_url_immutable()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.evidence_url IS DISTINCT FROM OLD.evidence_url THEN
    RAISE EXCEPTION 'evidence references are immutable';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER check_run_evidence_url_no_update
BEFORE UPDATE OF evidence_url ON check_run
FOR EACH ROW
EXECUTE FUNCTION check_run_evidence_url_immutable();

COMMIT;
