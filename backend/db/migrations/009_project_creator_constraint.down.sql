ALTER TABLE public.projects
  DROP CONSTRAINT IF EXISTS projects_created_by_user_fk,
  ALTER COLUMN created_by_user_id DROP NOT NULL;
