ALTER TABLE public.blocker_requests
  DROP CONSTRAINT IF EXISTS blocker_requests_work_item_fk;

ALTER TABLE public.blocker_requests
  ADD CONSTRAINT blocker_requests_issue_fk
  FOREIGN KEY (issue_work_item_id, project_id)
  REFERENCES public.issues(work_item_id, project_id) ON DELETE CASCADE;

ALTER TABLE public.blocker_requests
  DROP COLUMN IF EXISTS work_item_id;

DROP TABLE IF EXISTS public.task_merge_issue_backup;

DROP INDEX IF EXISTS public.tasks_project_issue_number_unique;

ALTER TABLE public.tasks
  DROP CONSTRAINT IF EXISTS tasks_custom_type_name_check,
  DROP CONSTRAINT IF EXISTS tasks_issue_number_check,
  DROP COLUMN IF EXISTS resolved_at,
  DROP COLUMN IF EXISTS reopened_count,
  DROP COLUMN IF EXISTS target_release_id,
  DROP COLUMN IF EXISTS fixed_in_version,
  DROP COLUMN IF EXISTS found_in_version,
  DROP COLUMN IF EXISTS severity,
  DROP COLUMN IF EXISTS issue_number,
  DROP COLUMN IF EXISTS custom_type_name;
