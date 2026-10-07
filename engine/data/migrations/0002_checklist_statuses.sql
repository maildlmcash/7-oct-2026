-- Forward migration for checklist statuses and dependency gates.
-- The allowed set is the task 02.A.02 list.
-- Design section 20 also names READY and RUNNING. Those values are rejected.
-- They are not aliased to IN_PROGRESS.

BEGIN;

ALTER TABLE checklist_item
  ADD CONSTRAINT checklist_item_status_known CHECK (
    status IN (
      'NOT_STARTED',
      'IN_PROGRESS',
      'PASS',
      'FAIL',
      'BLOCKED',
      'NOT_APPLICABLE'
    )
  );

ALTER TABLE checklist_item DROP CONSTRAINT checklist_item_not_applicable;

ALTER TABLE checklist_item
  ADD CONSTRAINT checklist_item_not_applicable CHECK (
    status <> 'NOT_APPLICABLE'
    OR (
      length(btrim(coalesce(not_applicable_reason, ''))) > 0
      AND length(btrim(coalesce(not_applicable_approver, ''))) > 0
    )
  );

ALTER TABLE checklist_item
  ADD COLUMN pass_approver text;

ALTER TABLE checklist_item
  ADD CONSTRAINT checklist_item_pass_approver CHECK (
    status <> 'PASS' OR length(btrim(coalesce(pass_approver, ''))) > 0
  );

ALTER TABLE check_run
  ADD CONSTRAINT check_run_result_known CHECK (
    result IN (
      'NOT_STARTED',
      'IN_PROGRESS',
      'PASS',
      'FAIL',
      'BLOCKED',
      'NOT_APPLICABLE'
    )
  );

CREATE TABLE checklist_dependency (
  tenant_id bigint NOT NULL,
  item_id bigint NOT NULL,
  prerequisite_id bigint NOT NULL,
  PRIMARY KEY (tenant_id, item_id, prerequisite_id),
  CHECK (item_id <> prerequisite_id),
  FOREIGN KEY (item_id, tenant_id) REFERENCES checklist_item (id, tenant_id),
  FOREIGN KEY (prerequisite_id, tenant_id) REFERENCES checklist_item (id, tenant_id)
);

COMMIT;
