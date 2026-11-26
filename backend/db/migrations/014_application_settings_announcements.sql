CREATE TABLE public.app_settings (
  key text PRIMARY KEY,
  value jsonb NOT NULL,
  updated_by_user_id text REFERENCES public.users(id) ON DELETE SET NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO public.app_settings (key, value) VALUES
  ('email_enabled', 'true'::jsonb),
  ('email_events', '{"task_assigned":true,"task_blocked":true,"assignment_rejected":true,"project_closed":true,"announcement":true}'::jsonb),
  ('in_app_notifications_enabled', 'true'::jsonb),
  ('sender_email', 'null'::jsonb);

CREATE TABLE public.settings_audit_log (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  actor_user_id text REFERENCES public.users(id) ON DELETE SET NULL,
  setting_key text NOT NULL,
  old_value jsonb,
  new_value jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX settings_audit_actor_created_idx
  ON public.settings_audit_log (actor_user_id, created_at DESC);

CREATE TABLE public.announcements (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  title text NOT NULL,
  message text NOT NULL,
  audience_role text,
  expires_at timestamptz,
  created_by_user_id text REFERENCES public.users(id) ON DELETE SET NULL,
  send_email boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  CONSTRAINT announcements_audience_role_check
    CHECK (audience_role IS NULL OR audience_role IN ('super_admin','admin','manager','employee','trainee'))
);

CREATE INDEX announcements_active_created_idx
  ON public.announcements (created_at DESC)
  WHERE deleted_at IS NULL;

CREATE TABLE public.announcement_acknowledgements (
  announcement_id text NOT NULL REFERENCES public.announcements(id) ON DELETE CASCADE,
  user_id text NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  acknowledged_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (announcement_id, user_id)
);

CREATE INDEX announcement_ack_user_idx
  ON public.announcement_acknowledgements (user_id, announcement_id);

ALTER TABLE public.notifications
  ADD COLUMN announcement_id text REFERENCES public.announcements(id) ON DELETE SET NULL;

CREATE INDEX notifications_announcement_user_idx
  ON public.notifications (announcement_id, recipient_user_id);

ALTER TABLE public.email_outbox
  DROP CONSTRAINT email_outbox_status_check,
  ADD CONSTRAINT email_outbox_status_check
    CHECK (status IN ('pending', 'sending', 'sent', 'failed', 'skipped'));
