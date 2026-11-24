ALTER TABLE public.tasks
  ADD COLUMN task_number integer,
  ADD COLUMN task_key text;

WITH numbered_tasks AS (
  SELECT
    t.work_item_id,
    row_number() OVER (PARTITION BY t.project_id ORDER BY w.created_at, w.id)::integer AS task_number,
    upper(p.key) AS project_key
  FROM public.tasks t
  JOIN public.work_items w ON w.id=t.work_item_id
  JOIN public.projects p ON p.id=t.project_id
)
UPDATE public.tasks t
SET task_number=numbered_tasks.task_number,
    task_key=numbered_tasks.project_key || '-' || numbered_tasks.task_number
FROM numbered_tasks
WHERE numbered_tasks.work_item_id=t.work_item_id;

SET CONSTRAINTS ALL IMMEDIATE;

ALTER TABLE public.tasks
  ALTER COLUMN task_number SET NOT NULL,
  ALTER COLUMN task_key SET NOT NULL,
  ADD CONSTRAINT tasks_task_number_positive CHECK (task_number > 0),
  ADD CONSTRAINT tasks_task_key_nonempty CHECK (char_length(btrim(task_key)) > 0);

CREATE UNIQUE INDEX tasks_task_key_unique ON public.tasks (task_key);

CREATE TABLE public.project_task_counters (
  project_id text PRIMARY KEY REFERENCES public.projects(id) ON DELETE CASCADE,
  last_number integer NOT NULL CHECK (last_number > 0)
);

INSERT INTO public.project_task_counters (project_id, last_number)
SELECT project_id, max(task_number)
FROM public.tasks
GROUP BY project_id;
