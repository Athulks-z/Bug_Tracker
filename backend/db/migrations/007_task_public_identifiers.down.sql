DROP TABLE IF EXISTS public.project_task_counters;
DROP INDEX IF EXISTS public.tasks_task_key_unique;
ALTER TABLE public.tasks
  DROP CONSTRAINT IF EXISTS tasks_task_key_nonempty,
  DROP CONSTRAINT IF EXISTS tasks_task_number_positive,
  DROP COLUMN IF EXISTS task_key,
  DROP COLUMN IF EXISTS task_number;
