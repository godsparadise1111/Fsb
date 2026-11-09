BEGIN;

INSERT INTO permissions (code, name, description)
VALUES (
  'workflow.tasks.reassign',
  'ارجاع مجدد وظایف گردش کار',
  'اجازه ارجاع مجدد وظیفه فعال به کاربران، سمت‌ها یا واحدهای سازمانی در همان سازمان'
)
ON CONFLICT (code) DO UPDATE
SET name=EXCLUDED.name, description=EXCLUDED.description;

COMMIT;
