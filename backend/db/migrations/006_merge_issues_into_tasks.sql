ALTER TABLE public.tasks
  ADD COLUMN IF NOT EXISTS custom_type_name text,
  ADD COLUMN IF NOT EXISTS issue_number integer,
  ADD COLUMN IF NOT EXISTS severity text,
  ADD COLUMN IF NOT EXISTS found_in_version text,
  ADD COLUMN IF NOT EXISTS fixed_in_version text,
  ADD COLUMN IF NOT EXISTS target_release_id text,
  ADD COLUMN IF NOT EXISTS reopened_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS resolved_at timestamptz;

ALTER TABLE public.tasks
  DROP CONSTRAINT IF EXISTS tasks_custom_type_name_check,
  ADD CONSTRAINT tasks_custom_type_name_check
    CHECK (custom_type_name IS NULL OR char_length(btrim(custom_type_name)) BETWEEN 1 AND 100);

ALTER TABLE public.tasks
  DROP CONSTRAINT IF EXISTS tasks_issue_number_check,
  ADD CONSTRAINT tasks_issue_number_check
    CHECK (issue_number IS NULL OR issue_number >= 0);

CREATE UNIQUE INDEX IF NOT EXISTS tasks_project_issue_number_unique
  ON public.tasks (project_id, issue_number)
  WHERE issue_number IS NOT NULL;

INSERT INTO public.work_types (value, label, icon, sort_order, active)
VALUES
  ('task', 'Task', 'check-square', 10, true),
  ('bug', 'Bug', 'bug', 20, true),
  ('issue', 'Issue', 'alert-circle', 30, true),
  ('support', 'Support', 'headset', 40, true),
  ('testing', 'Testing', 'clipboard-check', 50, true),
  ('documentation', 'Documentation', 'book', 60, true),
  ('purchase_order', 'Purchase Order', 'shopping-cart', 70, true),
  ('work_order', 'Work Order', 'tool', 80, true),
  ('part_number_request', 'Part Number Request', 'tag', 90, true),
  ('shipment', 'Shipment', 'truck', 100, true),
  ('packing', 'Packing', 'package', 110, true),
  ('assembly', 'Assembly', 'assembly', 120, true),
  ('other', 'Other', 'circle', 999, true)
ON CONFLICT (value) DO UPDATE SET
  label = EXCLUDED.label,
  icon = EXCLUDED.icon,
  sort_order = EXCLUDED.sort_order,
  active = true,
  updated_at = now();

INSERT INTO public.work_type_kinds (type_value, kind)
SELECT value, 'task'
FROM public.work_types
WHERE value IN (
  'task','bug','issue','support','testing','documentation','purchase_order',
  'work_order','part_number_request','shipment','packing','assembly','other'
)
ON CONFLICT DO NOTHING;

UPDATE public.work_types
SET active = false, sort_order = 900, updated_at = now()
WHERE value IN ('feature', 'improvement');

ALTER TABLE public.blocker_requests
  ADD COLUMN IF NOT EXISTS work_item_id text;

UPDATE public.blocker_requests
SET work_item_id = issue_work_item_id
WHERE work_item_id IS NULL;

ALTER TABLE public.blocker_requests
  DROP CONSTRAINT IF EXISTS blocker_requests_issue_fk;

ALTER TABLE public.blocker_requests
  DROP CONSTRAINT IF EXISTS blocker_requests_work_item_fk;

ALTER TABLE public.blocker_requests
  ADD CONSTRAINT blocker_requests_work_item_fk
  FOREIGN KEY (work_item_id, project_id)
  REFERENCES public.work_items(id, project_id) ON DELETE CASCADE;

CREATE TABLE IF NOT EXISTS public.task_merge_issue_backup (
  work_item_id text PRIMARY KEY,
  work_item_snapshot jsonb NOT NULL,
  issue_snapshot jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
