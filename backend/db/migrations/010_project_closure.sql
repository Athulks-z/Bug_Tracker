CREATE TABLE public.project_statuses (
  status text PRIMARY KEY,
  label text NOT NULL,
  active boolean NOT NULL DEFAULT true,
  is_system boolean NOT NULL DEFAULT false
);

INSERT INTO public.project_statuses (status,label,is_system) VALUES
  ('planning','Planning',true),
  ('active','In Progress',true),
  ('on_hold','On Hold',true),
  ('completed','Completed',true),
  ('archived','Archived',true),
  ('cancelled','Cancelled',true),
  ('closed','Closed',true);

CREATE FUNCTION public.protect_closed_project_status()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD.status='closed' AND (
    TG_OP='DELETE'
    OR NEW.status <> 'closed'
    OR NOT NEW.active
    OR NOT NEW.is_system
  ) THEN
    RAISE EXCEPTION 'The Closed project status is protected';
  END IF;
  IF TG_OP='DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER project_statuses_protect_closed
BEFORE UPDATE OR DELETE ON public.project_statuses
FOR EACH ROW EXECUTE FUNCTION public.protect_closed_project_status();

ALTER TABLE public.projects
  DROP CONSTRAINT projects_status_check,
  ADD CONSTRAINT projects_status_fk
    FOREIGN KEY (status) REFERENCES public.project_statuses(status) ON UPDATE RESTRICT ON DELETE RESTRICT;

CREATE TABLE public.project_closures (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  project_id text NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  closed_by_user_id text NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
  closed_at timestamptz NOT NULL DEFAULT now(),
  previous_status text NOT NULL REFERENCES public.project_statuses(status) ON DELETE RESTRICT,
  closing_remarks_html text NOT NULL,
  links jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(links)='array'),
  snapshot jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(snapshot)='object'),
  reopened_by_user_id text REFERENCES public.users(id) ON DELETE RESTRICT,
  reopened_at timestamptz,
  reopening_remarks text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT project_closures_id_project_unique UNIQUE (id,project_id),
  CONSTRAINT project_closure_reopen_fields_check CHECK (
    (reopened_at IS NULL AND reopened_by_user_id IS NULL AND reopening_remarks IS NULL)
    OR
    (reopened_at IS NOT NULL AND reopened_by_user_id IS NOT NULL AND reopening_remarks IS NOT NULL)
  )
);

CREATE UNIQUE INDEX project_closures_one_active_idx
  ON public.project_closures (project_id) WHERE reopened_at IS NULL;
CREATE INDEX project_closures_history_idx ON public.project_closures (project_id,closed_at DESC);

CREATE TABLE public.project_closure_uploads (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  project_id text NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  uploaded_by_user_id text NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  filename text NOT NULL,
  mime text NOT NULL,
  size_bytes bigint NOT NULL CHECK (size_bytes > 0),
  storage_key text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '24 hours')
);

CREATE INDEX project_closure_uploads_expiry_idx ON public.project_closure_uploads (expires_at);

ALTER TABLE public.attachments
  ADD COLUMN project_closure_id text;

ALTER TABLE public.attachments
  DROP CONSTRAINT attachments_exactly_one_parent,
  ADD CONSTRAINT attachments_exactly_one_parent CHECK (
    num_nonnulls(work_item_id,backlog_item_id,project_closure_id)=1
  ),
  ADD CONSTRAINT attachments_project_closure_fk
    FOREIGN KEY (project_closure_id,project_id)
    REFERENCES public.project_closures(id,project_id) ON DELETE CASCADE;

CREATE INDEX attachments_project_closure_idx ON public.attachments (project_closure_id);

CREATE OR REPLACE FUNCTION public.protect_closed_project_mutations()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD.status='closed' AND (
    TG_OP='DELETE'
    OR current_setting('app.project_reopen',true) IS DISTINCT FROM 'true'
  ) THEN
    RAISE EXCEPTION 'Closed projects must be reopened before they can be changed';
  END IF;
  IF TG_OP='DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER projects_require_reopen_before_status_change
BEFORE UPDATE OR DELETE ON public.projects
FOR EACH ROW EXECUTE FUNCTION public.protect_closed_project_mutations();

CREATE FUNCTION public.reject_closed_project_child_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  child_project_id text;
  project_status text;
BEGIN
  child_project_id := COALESCE(NEW.project_id,OLD.project_id);
  SELECT status INTO project_status
  FROM public.projects
  WHERE id=child_project_id
  FOR SHARE;
  IF project_status='closed' THEN
    RAISE EXCEPTION 'Closed projects are read-only';
  END IF;
  IF TG_OP='DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER work_items_reject_closed_project
BEFORE INSERT OR UPDATE OR DELETE ON public.work_items
FOR EACH ROW EXECUTE FUNCTION public.reject_closed_project_child_mutation();

CREATE TRIGGER milestones_reject_closed_project
BEFORE INSERT OR UPDATE OR DELETE ON public.milestones
FOR EACH ROW EXECUTE FUNCTION public.reject_closed_project_child_mutation();

CREATE TRIGGER stakeholders_reject_closed_project
BEFORE INSERT OR UPDATE OR DELETE ON public.project_stakeholders
FOR EACH ROW EXECUTE FUNCTION public.reject_closed_project_child_mutation();

CREATE TRIGGER closure_uploads_reject_closed_project
BEFORE INSERT OR UPDATE OR DELETE ON public.project_closure_uploads
FOR EACH ROW EXECUTE FUNCTION public.reject_closed_project_child_mutation();
