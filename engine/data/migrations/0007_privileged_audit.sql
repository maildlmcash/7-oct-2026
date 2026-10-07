-- Append-only audit for privileged actions.
-- Columns are actor, action, target, reason, and recorded_at.
-- No identity provider is named, so this file stores no MFA secret.

BEGIN;

CREATE TABLE privileged_audit (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  actor text NOT NULL,
  action text NOT NULL,
  target text NOT NULL,
  reason text NOT NULL,
  recorded_at timestamptz NOT NULL,
  CONSTRAINT privileged_audit_action_known CHECK (action IN ('checklist.write')),
  CONSTRAINT privileged_audit_reason_known CHECK (
    reason IN (
      'mfa provider is not configured',
      'mfa required',
      'mfa denied',
      'mfa verified'
    )
  ),
  CONSTRAINT privileged_audit_actor_present CHECK (length(btrim(actor)) > 0),
  CONSTRAINT privileged_audit_target_present CHECK (length(btrim(target)) > 0)
);

CREATE INDEX privileged_audit_actor_time ON privileged_audit (actor, recorded_at);
CREATE INDEX privileged_audit_action_target ON privileged_audit (action, target);

CREATE FUNCTION privileged_audit_append_only()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'audit records are append-only';
END;
$$;

CREATE TRIGGER privileged_audit_no_update
BEFORE UPDATE OR DELETE ON privileged_audit
FOR EACH ROW
EXECUTE FUNCTION privileged_audit_append_only();

CREATE TRIGGER privileged_audit_no_truncate
BEFORE TRUNCATE ON privileged_audit
FOR EACH STATEMENT
EXECUTE FUNCTION privileged_audit_append_only();

COMMIT;
