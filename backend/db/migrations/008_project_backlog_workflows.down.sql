DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.tasks WHERE is_backlog) THEN
    RAISE EXCEPTION 'Cannot roll back while backlog items exist; move or archive them first';
  END IF;
  IF EXISTS (SELECT 1 FROM public.projects WHERE priority <> 'Medium') THEN
    RAISE EXCEPTION 'Cannot roll back while projects have non-default priorities';
  END IF;
  IF EXISTS (SELECT 1 FROM public.projects WHERE created_by_user_id IS NULL OR created_by_user_id <> owner_user_id) THEN
    RAISE EXCEPTION 'Cannot roll back while project creators differ from project owners';
  END IF;
  IF EXISTS (SELECT 1 FROM public.milestones WHERE due_date IS NULL OR owner_user_id IS NULL) THEN
    RAISE EXCEPTION 'Cannot roll back while milestones have no due date or owner';
  END IF;
END
$$;

ALTER TABLE public.tasks
  DROP COLUMN IF EXISTS is_backlog;

ALTER TABLE public.milestones
  ALTER COLUMN due_date SET NOT NULL,
  ALTER COLUMN owner_user_id SET NOT NULL;

ALTER TABLE public.projects
  DROP CONSTRAINT IF EXISTS projects_priority_check,
  DROP CONSTRAINT IF EXISTS projects_created_by_user_fk,
  DROP COLUMN IF EXISTS priority,
  DROP COLUMN IF EXISTS created_by_user_id;
