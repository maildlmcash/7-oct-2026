-- Rollback for 0004_technology_inventory.sql.
-- Apply this before the 0003, 0002, and 0001 rollbacks.

BEGIN;

DROP TABLE IF EXISTS technology_inventory;

COMMIT;
