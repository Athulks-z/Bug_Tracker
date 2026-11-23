CREATE TABLE public.app_records (
  collection text NOT NULL CHECK (
    collection IN ('users', 'projects', 'issues', 'tasks', 'sprints', 'releases', 'templates', 'notifications')
  ),
  id text NOT NULL,
  record jsonb NOT NULL CHECK (jsonb_typeof(record) = 'object'),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (collection, id),
  CONSTRAINT app_records_id_matches_record CHECK (record->>'_id' = id)
);

CREATE INDEX app_records_collection_created_idx
  ON public.app_records (collection, created_at, id);

CREATE UNIQUE INDEX app_records_users_email_unique
  ON public.app_records (lower(record->>'email'))
  WHERE collection = 'users' AND record->>'email' IS NOT NULL;

CREATE UNIQUE INDEX app_records_users_bootstrap_admin_unique
  ON public.app_records (collection)
  WHERE collection = 'users' AND record->>'bootstrapAdmin' = 'true';
