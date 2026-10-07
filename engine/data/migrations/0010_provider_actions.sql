-- Manual Test Connection and Fetch Once are separate from Auto Start.
-- The registry row stays auto_start false. A live data subscription is an
-- auto-start action that requires confirmation. This file opens no connection
-- and stores no secret.

BEGIN;

ALTER TABLE provider_registry
  ADD COLUMN auto_start boolean NOT NULL DEFAULT false;

ALTER TABLE provider_registry
  ADD CONSTRAINT provider_registry_auto_start_off CHECK (auto_start = false);

CREATE TABLE provider_action (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  tenant_id bigint NOT NULL REFERENCES tenant (id),
  lineage_id bigint NOT NULL,
  action text NOT NULL,
  confirmed boolean NOT NULL,
  auto_start boolean NOT NULL,
  recorded_at timestamptz NOT NULL,
  CONSTRAINT provider_action_known CHECK (
    action IN ('test-connection', 'fetch-once', 'auto-start')
  ),
  CONSTRAINT provider_action_auto_separated CHECK (
    (
      action = 'auto-start'
      AND auto_start = true
      AND confirmed = true
    )
    OR (
      action <> 'auto-start'
      AND auto_start = false
      AND confirmed = false
    )
  )
);

CREATE FUNCTION provider_action_append_only()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'provider actions are append-only';
END;
$$;

CREATE TRIGGER provider_action_no_update
BEFORE UPDATE OR DELETE ON provider_action
FOR EACH ROW
EXECUTE FUNCTION provider_action_append_only();

CREATE TRIGGER provider_action_no_truncate
BEFORE TRUNCATE ON provider_action
FOR EACH STATEMENT
EXECUTE FUNCTION provider_action_append_only();

COMMIT;
