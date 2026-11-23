DO $$
BEGIN
  IF to_regclass('public.users') IS NOT NULL THEN
    IF to_regclass('public.users_legacy_empty') IS NOT NULL THEN
      RAISE EXCEPTION 'Both users and users_legacy_empty exist; refusing to rename either table';
    END IF;
    IF EXISTS (SELECT 1 FROM public.users LIMIT 1) THEN
      RAISE EXCEPTION 'public.users contains data; refusing to replace the existing table';
    END IF;
    ALTER TABLE public.users RENAME TO users_legacy_empty;
  END IF;
END
$$;

CREATE TABLE public.roles (
  code text PRIMARY KEY,
  label text NOT NULL,
  rank smallint NOT NULL UNIQUE
);

INSERT INTO public.roles (code, label, rank) VALUES
  ('super_admin', 'Super Admin', 1),
  ('admin', 'Admin', 2),
  ('manager', 'Manager', 3),
  ('employee', 'Employee', 4),
  ('trainee', 'Trainee', 5);

CREATE TABLE public.departments (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  name text NOT NULL,
  head_user_id text,
  parent_department_id text,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT departments_parent_not_self CHECK (parent_department_id IS NULL OR parent_department_id <> id),
  CONSTRAINT departments_parent_fk FOREIGN KEY (parent_department_id)
    REFERENCES public.departments(id) ON DELETE RESTRICT
);

CREATE UNIQUE INDEX departments_name_lower_unique ON public.departments (lower(name));

CREATE TABLE public.users (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  name text NOT NULL,
  email text NOT NULL,
  password_hash text NOT NULL,
  role_code text NOT NULL REFERENCES public.roles(code) ON DELETE RESTRICT,
  department_id text REFERENCES public.departments(id) ON DELETE RESTRICT,
  reporting_manager_id text REFERENCES public.users(id) ON DELETE RESTRICT,
  mentor_id text REFERENCES public.users(id) ON DELETE RESTRICT,
  job_title text,
  domain text,
  phone text,
  skills text,
  avatar text,
  active boolean NOT NULL DEFAULT true,
  bootstrap_admin boolean NOT NULL DEFAULT false,
  token_version integer NOT NULL DEFAULT 0 CHECK (token_version >= 0),
  must_change_password boolean NOT NULL DEFAULT false,
  email_task_assigned boolean NOT NULL DEFAULT true,
  email_task_completed boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX users_email_lower_unique ON public.users (lower(email));
ALTER TABLE public.departments
  ADD CONSTRAINT departments_head_user_fk FOREIGN KEY (head_user_id)
  REFERENCES public.users(id) ON DELETE RESTRICT;

CREATE TABLE public.manager_departments (
  manager_user_id text NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  department_id text NOT NULL REFERENCES public.departments(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (manager_user_id, department_id)
);

CREATE TABLE public.password_reset_tokens (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  user_id text NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  token_hash text NOT NULL UNIQUE,
  expires_at timestamptz NOT NULL,
  used_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX password_reset_tokens_user_expiry_idx
  ON public.password_reset_tokens (user_id, expires_at);

CREATE TABLE public.projects (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  name text NOT NULL,
  key text NOT NULL,
  description_html text,
  description_text text,
  owner_user_id text NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
  owning_department_id text REFERENCES public.departments(id) ON DELETE RESTRICT,
  start_date date,
  target_end_date date,
  status text NOT NULL CHECK (status IN ('planning', 'active', 'on_hold', 'completed', 'archived', 'cancelled')),
  settings jsonb NOT NULL DEFAULT '{}'::jsonb,
  health_status text,
  completion_email_sent_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT projects_dates_ordered CHECK (start_date IS NULL OR target_end_date IS NULL OR target_end_date >= start_date),
  CONSTRAINT projects_id_department_unique UNIQUE (id, owning_department_id)
);

CREATE UNIQUE INDEX projects_key_lower_unique ON public.projects (lower(key));
CREATE INDEX projects_owner_user_idx ON public.projects (owner_user_id);
CREATE INDEX projects_department_status_idx ON public.projects (owning_department_id, status);

CREATE TABLE public.project_departments (
  project_id text NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  department_id text NOT NULL REFERENCES public.departments(id) ON DELETE RESTRICT,
  share_type text NOT NULL DEFAULT 'shared' CHECK (share_type = 'shared'),
  PRIMARY KEY (project_id, department_id)
);

CREATE INDEX project_departments_department_idx
  ON public.project_departments (department_id, project_id);

CREATE TABLE public.project_members (
  project_id text NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  user_id text NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
  project_role text NOT NULL CHECK (project_role IN ('lead', 'member', 'viewer')),
  trainee_full_view boolean NOT NULL DEFAULT false,
  added_by_user_id text REFERENCES public.users(id) ON DELETE SET NULL,
  added_at timestamptz NOT NULL DEFAULT now(),
  active boolean NOT NULL DEFAULT true,
  PRIMARY KEY (project_id, user_id)
);

CREATE INDEX project_members_user_idx ON public.project_members (user_id, project_id);

CREATE TABLE public.project_stakeholders (
  project_id text NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  user_id text NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
  added_by_user_id text REFERENCES public.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (project_id, user_id)
);

CREATE TABLE public.milestones (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  project_id text NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  name text NOT NULL,
  description_html text,
  description_text text,
  start_date date,
  due_date date NOT NULL,
  owner_user_id text NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
  status text NOT NULL CHECK (status IN ('not_started', 'in_progress', 'completed', 'cancelled')),
  sort_order integer NOT NULL DEFAULT 0,
  warnings_sent jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT milestones_dates_ordered CHECK (start_date IS NULL OR due_date >= start_date),
  CONSTRAINT milestones_id_project_unique UNIQUE (id, project_id)
);

CREATE INDEX milestones_project_idx ON public.milestones (project_id);
CREATE INDEX milestones_owner_idx ON public.milestones (owner_user_id);

CREATE TABLE public.sprints (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  project_id text NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  name text NOT NULL,
  start_date date,
  end_date date,
  goal text,
  status text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT sprints_dates_ordered CHECK (start_date IS NULL OR end_date IS NULL OR end_date >= start_date),
  CONSTRAINT sprints_id_project_unique UNIQUE (id, project_id)
);

CREATE INDEX sprints_project_idx ON public.sprints (project_id);

CREATE TABLE public.releases (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  project_id text NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  name text NOT NULL,
  version text,
  description_html text,
  description_text text,
  release_date date,
  status text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT releases_id_project_unique UNIQUE (id, project_id)
);

CREATE INDEX releases_project_idx ON public.releases (project_id);

CREATE TABLE public.templates (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  project_id text REFERENCES public.projects(id) ON DELETE CASCADE,
  name text NOT NULL,
  type text NOT NULL,
  body_html text,
  body_text text,
  fields jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_by_user_id text NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX templates_project_idx ON public.templates (project_id);
CREATE INDEX templates_creator_idx ON public.templates (created_by_user_id);

CREATE TABLE public.work_types (
  value text PRIMARY KEY,
  label text NOT NULL,
  icon text,
  active boolean NOT NULL DEFAULT true,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX work_types_label_lower_unique ON public.work_types (lower(label));

CREATE TABLE public.work_type_kinds (
  type_value text NOT NULL REFERENCES public.work_types(value) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('task', 'issue')),
  PRIMARY KEY (type_value, kind)
);

INSERT INTO public.work_types (value, label, icon, sort_order) VALUES
  ('task', 'Task', 'check-square', 10),
  ('bug', 'Bug', 'bug', 20),
  ('feature', 'Feature', 'sparkles', 30),
  ('improvement', 'Improvement', 'trending-up', 40),
  ('other', 'Other', 'circle', 50);

INSERT INTO public.work_type_kinds (type_value, kind) VALUES
  ('task', 'task'),
  ('bug', 'issue'),
  ('feature', 'issue'),
  ('improvement', 'issue'),
  ('other', 'task'),
  ('other', 'issue');

CREATE TABLE public.work_items (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  project_id text NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('task', 'issue')),
  title text NOT NULL,
  description_html text,
  description_text text,
  reporter_user_id text NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
  assignee_user_id text REFERENCES public.users(id) ON DELETE RESTRICT,
  status text NOT NULL,
  priority text,
  start_date date,
  due_date date,
  milestone_id text,
  sprint_id text,
  estimate_hours numeric(8,2),
  rejected_by_user_id text REFERENCES public.users(id) ON DELETE RESTRICT,
  rejected_at timestamptz,
  closing_remarks text,
  reject_reason text,
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT work_items_estimate_nonnegative CHECK (estimate_hours IS NULL OR estimate_hours >= 0),
  CONSTRAINT work_items_dates_ordered CHECK (start_date IS NULL OR due_date IS NULL OR due_date >= start_date),
  CONSTRAINT work_items_id_project_unique UNIQUE (id, project_id),
  CONSTRAINT work_items_id_kind_unique UNIQUE (id, kind),
  CONSTRAINT work_items_id_project_kind_unique UNIQUE (id, project_id, kind)
);

ALTER TABLE public.work_items
  ADD CONSTRAINT work_items_milestone_project_fk
  FOREIGN KEY (milestone_id, project_id)
  REFERENCES public.milestones(id, project_id) ON DELETE SET NULL (milestone_id);

ALTER TABLE public.work_items
  ADD CONSTRAINT work_items_sprint_project_fk
  FOREIGN KEY (sprint_id, project_id)
  REFERENCES public.sprints(id, project_id) ON DELETE SET NULL (sprint_id);

CREATE INDEX work_items_project_kind_status_idx ON public.work_items (project_id, kind, status);
CREATE INDEX work_items_assignee_status_idx ON public.work_items (assignee_user_id, status);
CREATE INDEX work_items_reporter_status_idx ON public.work_items (reporter_user_id, status);
CREATE INDEX work_items_milestone_idx ON public.work_items (milestone_id);
CREATE INDEX work_items_sprint_idx ON public.work_items (sprint_id);

CREATE TABLE public.tasks (
  work_item_id text PRIMARY KEY,
  subtype_kind text NOT NULL DEFAULT 'task' CHECK (subtype_kind = 'task'),
  project_id text NOT NULL,
  task_type text NOT NULL,
  parent_task_id text,
  labels text[] NOT NULL DEFAULT ARRAY[]::text[],
  CONSTRAINT tasks_parent_fk FOREIGN KEY (work_item_id, subtype_kind)
    REFERENCES public.work_items(id, kind) ON DELETE CASCADE,
  CONSTRAINT tasks_project_fk FOREIGN KEY (work_item_id, project_id)
    REFERENCES public.work_items(id, project_id) ON DELETE CASCADE,
  CONSTRAINT tasks_type_fk FOREIGN KEY (task_type, subtype_kind)
    REFERENCES public.work_type_kinds(type_value, kind) ON DELETE RESTRICT,
  CONSTRAINT tasks_parent_project_fk FOREIGN KEY (parent_task_id, project_id)
    REFERENCES public.tasks(work_item_id, project_id) ON DELETE SET NULL (parent_task_id),
  CONSTRAINT tasks_id_project_unique UNIQUE (work_item_id, project_id)
);

CREATE INDEX tasks_project_type_idx ON public.tasks (project_id, task_type);

CREATE TABLE public.issues (
  work_item_id text PRIMARY KEY,
  subtype_kind text NOT NULL DEFAULT 'issue' CHECK (subtype_kind = 'issue'),
  project_id text NOT NULL,
  issue_number integer NOT NULL CHECK (issue_number >= 0),
  issue_type text NOT NULL,
  severity text,
  found_in_version text,
  fixed_in_version text,
  target_release_id text,
  reopened_count integer NOT NULL DEFAULT 0 CHECK (reopened_count >= 0),
  resolved_at timestamptz,
  labels text[] NOT NULL DEFAULT ARRAY[]::text[],
  CONSTRAINT issues_parent_fk FOREIGN KEY (work_item_id, subtype_kind)
    REFERENCES public.work_items(id, kind) ON DELETE CASCADE,
  CONSTRAINT issues_project_fk FOREIGN KEY (work_item_id, project_id)
    REFERENCES public.work_items(id, project_id) ON DELETE CASCADE,
  CONSTRAINT issues_type_fk FOREIGN KEY (issue_type, subtype_kind)
    REFERENCES public.work_type_kinds(type_value, kind) ON DELETE RESTRICT,
  CONSTRAINT issues_release_project_fk FOREIGN KEY (target_release_id, project_id)
    REFERENCES public.releases(id, project_id) ON DELETE SET NULL (target_release_id),
  CONSTRAINT issues_id_project_unique UNIQUE (work_item_id, project_id),
  CONSTRAINT issues_project_number_unique UNIQUE (project_id, issue_number)
);

CREATE INDEX issues_project_type_idx ON public.issues (project_id, issue_type);
CREATE INDEX issues_target_release_idx ON public.issues (target_release_id);

CREATE FUNCTION public.enforce_work_item_subtype() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  item_id text;
  item_kind text;
  task_count integer;
  issue_count integer;
BEGIN
  IF TG_TABLE_NAME = 'work_items' THEN
    item_id := CASE WHEN TG_OP = 'DELETE' THEN OLD.id ELSE NEW.id END;
  ELSE
    item_id := CASE WHEN TG_OP = 'DELETE' THEN OLD.work_item_id ELSE NEW.work_item_id END;
  END IF;

  SELECT kind INTO item_kind FROM public.work_items WHERE id = item_id;
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  SELECT count(*) INTO task_count FROM public.tasks WHERE work_item_id = item_id;
  SELECT count(*) INTO issue_count FROM public.issues WHERE work_item_id = item_id;
  IF (item_kind = 'task' AND (task_count <> 1 OR issue_count <> 0))
     OR (item_kind = 'issue' AND (issue_count <> 1 OR task_count <> 0)) THEN
    RAISE EXCEPTION 'Work item % must have exactly one matching subtype', item_id
      USING ERRCODE = '23514';
  END IF;
  RETURN NULL;
END
$$;

CREATE CONSTRAINT TRIGGER work_items_subtype_integrity
AFTER INSERT OR UPDATE OR DELETE ON public.work_items
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW
EXECUTE FUNCTION public.enforce_work_item_subtype();

CREATE CONSTRAINT TRIGGER tasks_subtype_integrity
AFTER INSERT OR UPDATE OR DELETE ON public.tasks
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW
EXECUTE FUNCTION public.enforce_work_item_subtype();

CREATE CONSTRAINT TRIGGER issues_subtype_integrity
AFTER INSERT OR UPDATE OR DELETE ON public.issues
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW
EXECUTE FUNCTION public.enforce_work_item_subtype();

CREATE TABLE public.backlog_items (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  project_id text NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  title text NOT NULL,
  description_html text,
  description_text text,
  kind text NOT NULL CHECK (kind IN ('task', 'issue')),
  estimate_hours numeric(8,2) CHECK (estimate_hours IS NULL OR estimate_hours >= 0),
  priority text,
  milestone_id text,
  rank bigint NOT NULL,
  state text NOT NULL,
  created_by_user_id text NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
  approved_by_user_id text REFERENCES public.users(id) ON DELETE RESTRICT,
  approved_at timestamptz,
  rejected_by_user_id text REFERENCES public.users(id) ON DELETE RESTRICT,
  rejected_at timestamptz,
  closing_remarks text,
  reject_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT backlog_items_milestone_project_fk FOREIGN KEY (milestone_id, project_id)
    REFERENCES public.milestones(id, project_id) ON DELETE SET NULL (milestone_id),
  CONSTRAINT backlog_items_id_project_unique UNIQUE (id, project_id),
  CONSTRAINT backlog_items_project_rank_unique UNIQUE (project_id, rank)
    DEFERRABLE INITIALLY IMMEDIATE
);

CREATE INDEX backlog_items_project_milestone_idx ON public.backlog_items (project_id, milestone_id);
CREATE INDEX backlog_items_creator_idx ON public.backlog_items (created_by_user_id);

CREATE TABLE public.backlog_conversions (
  backlog_item_id text PRIMARY KEY,
  work_item_id text NOT NULL UNIQUE,
  project_id text NOT NULL,
  converted_by_user_id text NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
  converted_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT backlog_conversion_item_fk FOREIGN KEY (backlog_item_id, project_id)
    REFERENCES public.backlog_items(id, project_id) ON DELETE CASCADE,
  CONSTRAINT backlog_conversion_work_item_fk FOREIGN KEY (work_item_id, project_id)
    REFERENCES public.work_items(id, project_id) ON DELETE CASCADE
);

CREATE TABLE public.work_item_dependencies (
  project_id text NOT NULL,
  work_item_id text NOT NULL,
  depends_on_work_item_id text NOT NULL,
  created_by_user_id text NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (work_item_id, depends_on_work_item_id),
  CONSTRAINT dependencies_not_self CHECK (work_item_id <> depends_on_work_item_id),
  CONSTRAINT dependencies_source_task_fk FOREIGN KEY (work_item_id, project_id)
    REFERENCES public.tasks(work_item_id, project_id) ON DELETE CASCADE,
  CONSTRAINT dependencies_target_fk FOREIGN KEY (depends_on_work_item_id, project_id)
    REFERENCES public.work_items(id, project_id) ON DELETE CASCADE
);

CREATE TABLE public.block_links (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  project_id text NOT NULL,
  blocker_issue_id text NOT NULL,
  blocked_work_item_id text,
  blocked_milestone_id text,
  created_by_user_id text NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT block_links_exactly_one_target CHECK (
    (blocked_work_item_id IS NOT NULL) <> (blocked_milestone_id IS NOT NULL)
  ),
  CONSTRAINT block_links_blocker_fk FOREIGN KEY (blocker_issue_id, project_id)
    REFERENCES public.issues(work_item_id, project_id) ON DELETE CASCADE,
  CONSTRAINT block_links_work_target_fk FOREIGN KEY (blocked_work_item_id, project_id)
    REFERENCES public.work_items(id, project_id) ON DELETE CASCADE,
  CONSTRAINT block_links_milestone_target_fk FOREIGN KEY (blocked_milestone_id, project_id)
    REFERENCES public.milestones(id, project_id) ON DELETE CASCADE
);

CREATE UNIQUE INDEX block_links_work_target_unique
  ON public.block_links (blocker_issue_id, blocked_work_item_id)
  WHERE blocked_work_item_id IS NOT NULL;
CREATE UNIQUE INDEX block_links_milestone_target_unique
  ON public.block_links (blocker_issue_id, blocked_milestone_id)
  WHERE blocked_milestone_id IS NOT NULL;

CREATE TABLE public.blocker_requests (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  project_id text NOT NULL,
  issue_work_item_id text NOT NULL,
  requested_by_user_id text NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
  status text NOT NULL CHECK (status IN ('pending', 'approved', 'rejected')),
  reviewed_by_user_id text REFERENCES public.users(id) ON DELETE RESTRICT,
  reviewed_at timestamptz,
  decision_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT blocker_requests_issue_fk FOREIGN KEY (issue_work_item_id, project_id)
    REFERENCES public.issues(work_item_id, project_id) ON DELETE CASCADE
);

CREATE TABLE public.comments (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  work_item_id text NOT NULL REFERENCES public.work_items(id) ON DELETE CASCADE,
  author_user_id text NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
  body_text text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX comments_work_item_idx ON public.comments (work_item_id);

CREATE TABLE public.time_entries (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  work_item_id text NOT NULL REFERENCES public.work_items(id) ON DELETE CASCADE,
  user_id text NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
  hours numeric(8,2) NOT NULL CHECK (hours > 0),
  note text,
  work_date date NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX time_entries_work_item_idx ON public.time_entries (work_item_id);
CREATE INDEX time_entries_user_idx ON public.time_entries (user_id);

CREATE TABLE public.activity_log (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  work_item_id text,
  project_id text NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  actor_user_id text REFERENCES public.users(id) ON DELETE RESTRICT,
  action text NOT NULL,
  details text,
  before jsonb,
  after jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT activity_work_item_project_fk FOREIGN KEY (work_item_id, project_id)
    REFERENCES public.work_items(id, project_id) ON DELETE CASCADE
);

CREATE INDEX activity_work_item_idx ON public.activity_log (work_item_id);
CREATE INDEX activity_actor_idx ON public.activity_log (actor_user_id);

CREATE TABLE public.attachments (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  project_id text NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  work_item_id text,
  backlog_item_id text,
  filename text NOT NULL,
  mime text,
  size_bytes bigint NOT NULL CHECK (size_bytes >= 0),
  storage_key text NOT NULL UNIQUE,
  status text NOT NULL,
  uploaded_by_user_id text NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
  scan_status text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  linked_at timestamptz,
  CONSTRAINT attachments_exactly_one_parent CHECK (
    (work_item_id IS NOT NULL) <> (backlog_item_id IS NOT NULL)
  ),
  CONSTRAINT attachments_work_item_project_fk FOREIGN KEY (work_item_id, project_id)
    REFERENCES public.work_items(id, project_id) ON DELETE CASCADE,
  CONSTRAINT attachments_backlog_project_fk FOREIGN KEY (backlog_item_id, project_id)
    REFERENCES public.backlog_items(id, project_id) ON DELETE CASCADE
);

CREATE INDEX attachments_work_item_idx ON public.attachments (work_item_id);
CREATE INDEX attachments_backlog_item_idx ON public.attachments (backlog_item_id);
CREATE INDEX attachments_uploader_idx ON public.attachments (uploaded_by_user_id);

CREATE TABLE public.notifications (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  recipient_user_id text NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  actor_user_id text REFERENCES public.users(id) ON DELETE SET NULL,
  type text NOT NULL,
  details text,
  resource_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  read_at timestamptz,
  idempotency_key text UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX notifications_recipient_read_created_idx
  ON public.notifications (recipient_user_id, read_at, created_at DESC);

CREATE TABLE public.notification_resources (
  notification_id text PRIMARY KEY REFERENCES public.notifications(id) ON DELETE CASCADE,
  project_scope_id text NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  target_project_id text,
  work_item_id text,
  milestone_id text,
  CONSTRAINT notification_resource_exactly_one_target CHECK (
    num_nonnulls(target_project_id, work_item_id, milestone_id) = 1
  ),
  CONSTRAINT notification_project_target_fk FOREIGN KEY (target_project_id)
    REFERENCES public.projects(id) ON DELETE CASCADE,
  CONSTRAINT notification_work_target_fk FOREIGN KEY (work_item_id, project_scope_id)
    REFERENCES public.work_items(id, project_id) ON DELETE CASCADE,
  CONSTRAINT notification_milestone_target_fk FOREIGN KEY (milestone_id, project_scope_id)
    REFERENCES public.milestones(id, project_id) ON DELETE CASCADE,
  CONSTRAINT notification_project_scope_check CHECK (
    target_project_id IS NULL OR target_project_id = project_scope_id
  )
);

CREATE TABLE public.audit_log (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  actor_user_id text REFERENCES public.users(id) ON DELETE SET NULL,
  actor_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  action text NOT NULL,
  resource_type text NOT NULL,
  resource_id text,
  resource_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  before jsonb,
  after jsonb,
  ip inet,
  user_agent text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX audit_log_actor_created_idx ON public.audit_log (actor_user_id, created_at);
CREATE INDEX audit_log_resource_idx ON public.audit_log (resource_type, resource_id, created_at);

CREATE TABLE public.email_outbox (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  event_type text NOT NULL,
  batch_id text,
  subject text NOT NULL,
  payload jsonb NOT NULL,
  status text NOT NULL CHECK (status IN ('pending', 'sending', 'sent', 'failed')),
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  last_error text,
  idempotency_key text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now(),
  sent_at timestamptz
);

CREATE INDEX email_outbox_status_attempt_idx ON public.email_outbox (status, next_attempt_at);

CREATE TABLE public.email_recipients (
  email_outbox_id text NOT NULL REFERENCES public.email_outbox(id) ON DELETE CASCADE,
  user_id text REFERENCES public.users(id) ON DELETE SET NULL,
  email_snapshot text NOT NULL,
  name_snapshot text,
  recipient_type text NOT NULL CHECK (recipient_type IN ('to', 'cc')),
  delivery_status text NOT NULL,
  delivered_at timestamptz,
  PRIMARY KEY (email_outbox_id, email_snapshot, recipient_type)
);

CREATE INDEX email_recipients_user_idx ON public.email_recipients (user_id, email_outbox_id);

CREATE TABLE public.email_attachments (
  email_outbox_id text NOT NULL REFERENCES public.email_outbox(id) ON DELETE CASCADE,
  attachment_id text NOT NULL REFERENCES public.attachments(id) ON DELETE RESTRICT,
  delivery_mode text NOT NULL CHECK (delivery_mode IN ('attached', 'secure_link')),
  position integer NOT NULL CHECK (position >= 0),
  PRIMARY KEY (email_outbox_id, attachment_id),
  UNIQUE (email_outbox_id, position)
);

CREATE TABLE public.email_resources (
  email_outbox_id text PRIMARY KEY REFERENCES public.email_outbox(id) ON DELETE CASCADE,
  project_scope_id text NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  target_project_id text,
  work_item_id text,
  milestone_id text,
  CONSTRAINT email_resource_exactly_one_target CHECK (
    num_nonnulls(target_project_id, work_item_id, milestone_id) = 1
  ),
  CONSTRAINT email_project_target_fk FOREIGN KEY (target_project_id)
    REFERENCES public.projects(id) ON DELETE CASCADE,
  CONSTRAINT email_work_target_fk FOREIGN KEY (work_item_id, project_scope_id)
    REFERENCES public.work_items(id, project_id) ON DELETE CASCADE,
  CONSTRAINT email_milestone_target_fk FOREIGN KEY (milestone_id, project_scope_id)
    REFERENCES public.milestones(id, project_id) ON DELETE CASCADE,
  CONSTRAINT email_project_scope_check CHECK (
    target_project_id IS NULL OR target_project_id = project_scope_id
  )
);

CREATE TABLE public.storage_cleanup_jobs (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  storage_key text NOT NULL UNIQUE,
  status text NOT NULL CHECK (status IN ('pending', 'processing', 'completed', 'failed')),
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz
);

CREATE INDEX storage_cleanup_jobs_status_idx
  ON public.storage_cleanup_jobs (status, next_attempt_at);

CREATE TABLE public.saved_filters (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  user_id text NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  name text NOT NULL,
  filters jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX saved_filters_user_name_lower_unique
  ON public.saved_filters (user_id, lower(name));
