CREATE INDEX notifications_user_read_created_idx
  ON public.notifications (recipient_user_id, read_at, created_at DESC);
