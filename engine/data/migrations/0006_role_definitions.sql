-- Role name definitions only.
-- The six names match packages/contracts/src/roles.mjs.
-- Customer is the only default. No permission rows are stored.
-- Phase 17 is the approval matrix. This file does not grant one.

BEGIN;

CREATE TABLE role_definition (
  name text PRIMARY KEY,
  is_default boolean NOT NULL,
  CONSTRAINT role_definition_name_known CHECK (
    name IN (
      'Super Admin',
      'Admin',
      'Super Distributor',
      'Distributor',
      'Retailer',
      'Customer'
    )
  ),
  CONSTRAINT role_definition_default_is_customer CHECK (
    is_default = false OR name = 'Customer'
  )
);

CREATE UNIQUE INDEX role_definition_one_default
  ON role_definition (is_default) WHERE is_default;

INSERT INTO role_definition (name, is_default) VALUES
  ('Super Admin', false),
  ('Admin', false),
  ('Super Distributor', false),
  ('Distributor', false),
  ('Retailer', false),
  ('Customer', true);

COMMIT;
