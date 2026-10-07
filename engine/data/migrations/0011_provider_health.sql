-- Provider health observations.
-- The source names no retry budget, safety margin, or heartbeat age.
-- attempts cannot exceed the caller budget. This file opens no connection
-- and stores no secret.

BEGIN;

CREATE TABLE provider_health (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  tenant_id bigint NOT NULL REFERENCES tenant (id),
  lineage_id bigint NOT NULL,
  connection_status text,
  heartbeat_age text,
  retry_budget integer,
  attempts integer NOT NULL,
  backoff_state text,
  status text,
  rate_limit_headers text,
  documented_limit text,
  safety_margin text,
  recorded_at timestamptz NOT NULL,
  CONSTRAINT provider_health_attempts_bounded CHECK (
    attempts >= 0
    AND (
      (retry_budget IS NULL AND attempts = 0)
      OR (retry_budget IS NOT NULL AND retry_budget >= 0 AND attempts <= retry_budget)
    )
  ),
  CONSTRAINT provider_health_status_known CHECK (
    status IS NULL OR status = 'degraded'
  ),
  CONSTRAINT provider_health_backoff_known CHECK (
    backoff_state IS NULL OR backoff_state IN ('bounded', 'stopped')
  )
);

CREATE FUNCTION provider_health_append_only()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'provider health is append-only';
END;
$$;

CREATE TRIGGER provider_health_no_update
BEFORE UPDATE OR DELETE ON provider_health
FOR EACH ROW
EXECUTE FUNCTION provider_health_append_only();

CREATE TRIGGER provider_health_no_truncate
BEFORE TRUNCATE ON provider_health
FOR EACH STATEMENT
EXECUTE FUNCTION provider_health_append_only();

COMMIT;
