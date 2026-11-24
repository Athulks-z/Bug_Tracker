ALTER TABLE public.projects
  ADD COLUMN created_by_user_id text,
  ADD COLUMN priority text NOT NULL DEFAULT 'Medium'
    CHECK (priority IN ('High','Medium','Low'));

UPDATE public.projects
SET created_by_user_id=owner_user_id
WHERE created_by_user_id IS NULL;

ALTER TABLE public.milestones
  ALTER COLUMN due_date DROP NOT NULL,
  ALTER COLUMN owner_user_id DROP NOT NULL;

ALTER TABLE public.tasks
  ADD COLUMN is_backlog boolean NOT NULL DEFAULT false;
