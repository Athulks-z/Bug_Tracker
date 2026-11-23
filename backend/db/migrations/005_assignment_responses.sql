CREATE TABLE public.assignment_responses (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  email_outbox_id text NOT NULL REFERENCES public.email_outbox(id) ON DELETE CASCADE,
  work_item_id text NOT NULL REFERENCES public.work_items(id) ON DELETE CASCADE,
  assigned_user_id text REFERENCES public.users(id) ON DELETE SET NULL,
  assignee_email_snapshot text NOT NULL,
  token_hash text NOT NULL UNIQUE,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'accepted', 'rejected', 'expired')),
  closing_remarks text,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  invalidated_at timestamptz,
  responded_at timestamptz,
  CONSTRAINT assignment_response_rejection_remarks CHECK (
    status <> 'rejected' OR NULLIF(btrim(closing_remarks), '') IS NOT NULL
  )
);

CREATE INDEX assignment_responses_work_item_created_idx
  ON public.assignment_responses (work_item_id, created_at DESC);
CREATE INDEX assignment_responses_status_expiry_idx
  ON public.assignment_responses (status, expires_at)
  WHERE status = 'pending';
