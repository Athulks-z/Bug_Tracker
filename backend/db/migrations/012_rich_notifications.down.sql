DROP INDEX IF EXISTS public.notifications_user_read_created_idx;

ALTER TABLE public.notifications
  DROP COLUMN entity_id,
  DROP COLUMN entity_type,
  DROP COLUMN link,
  DROP COLUMN message,
  DROP COLUMN title;
