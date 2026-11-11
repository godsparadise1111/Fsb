BEGIN;

DO $$
DECLARE constraint_name text;
BEGIN
  FOR constraint_name IN
    SELECT conname
      FROM pg_constraint
     WHERE conrelid='workflow_task_reassignments'::regclass
       AND contype='c'
       AND pg_get_constraintdef(oid) ILIKE '%triggerType%'
  LOOP
    EXECUTE format('ALTER TABLE workflow_task_reassignments DROP CONSTRAINT %I', constraint_name);
  END LOOP;
  ALTER TABLE workflow_task_reassignments
    ADD CONSTRAINT workflow_task_reassignments_trigger_type_check
    CHECK ("triggerType" IN ('SLA','INACTIVE_ASSIGNEE','MANUAL'));
END $$;

INSERT INTO permissions (code, name, description)
VALUES (
  'workflow.tasks.reassign',
  'ارجاع مجدد وظایف گردش کار',
  'اجازه ارجاع مجدد وظیفه فعال به کاربران، سمت‌ها یا واحدهای سازمانی در همان سازمان'
)
ON CONFLICT (code) DO UPDATE
SET name=EXCLUDED.name, description=EXCLUDED.description;

COMMIT;
