-- Project link and version lineage for checklist templates.
-- Old version rows stay. retired_at marks a retired lineage without deleting it.

BEGIN;

ALTER TABLE checklist_template ADD COLUMN project_id bigint;
ALTER TABLE checklist_template ADD COLUMN lineage_id bigint;
ALTER TABLE checklist_template ADD COLUMN retired_at timestamptz;

UPDATE checklist_template SET lineage_id = id WHERE lineage_id IS NULL;

ALTER TABLE checklist_template ALTER COLUMN lineage_id SET NOT NULL;

ALTER TABLE checklist_template
  ADD CONSTRAINT checklist_template_project_tenant
  FOREIGN KEY (project_id, tenant_id) REFERENCES project (id, tenant_id);

CREATE FUNCTION checklist_template_lineage()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.lineage_id IS NULL THEN
    NEW.lineage_id := NEW.id;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER checklist_template_lineage
BEFORE INSERT ON checklist_template
FOR EACH ROW
EXECUTE FUNCTION checklist_template_lineage();

COMMIT;
