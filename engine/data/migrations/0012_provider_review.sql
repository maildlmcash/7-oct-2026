-- Review records for provider configuration.
-- Approve and rollback are append-only. Provider versions are not deleted.
-- This file stores no secret and does not open a connection.

BEGIN;

CREATE TABLE provider_review (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  tenant_id bigint NOT NULL REFERENCES tenant (id),
  lineage_id bigint NOT NULL,
  provider_id bigint NOT NULL,
  action text NOT NULL,
  actor text NOT NULL,
  recorded_at timestamptz NOT NULL,
  CONSTRAINT provider_review_action_known CHECK (action IN ('approve', 'rollback')),
  CONSTRAINT provider_review_actor_present CHECK (length(btrim(actor)) > 0)
);

CREATE FUNCTION provider_review_append_only()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'provider reviews are append-only';
END;
$$;

CREATE TRIGGER provider_review_no_update
BEFORE UPDATE OR DELETE ON provider_review
FOR EACH ROW
EXECUTE FUNCTION provider_review_append_only();

CREATE TRIGGER provider_review_no_truncate
BEFORE TRUNCATE ON provider_review
FOR EACH STATEMENT
EXECUTE FUNCTION provider_review_append_only();

COMMIT;
