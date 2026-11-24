ALTER TABLE public.projects
  ALTER COLUMN created_by_user_id SET NOT NULL,
  ADD CONSTRAINT projects_created_by_user_fk
    FOREIGN KEY (created_by_user_id) REFERENCES public.users(id) ON DELETE RESTRICT;
