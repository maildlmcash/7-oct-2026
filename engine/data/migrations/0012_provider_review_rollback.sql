-- Rollback for 0012_provider_review.sql.
-- Apply this before the 0011 rollback. It does not drop provider versions or privileged_audit.

BEGIN;

DROP TABLE IF EXISTS provider_review;
DROP FUNCTION IF EXISTS provider_review_append_only();

COMMIT;
