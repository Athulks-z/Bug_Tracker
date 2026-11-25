ALTER TABLE public.notifications
  ADD COLUMN title text NOT NULL DEFAULT 'Notification',
  ADD COLUMN message text NOT NULL DEFAULT '',
  ADD COLUMN link text,
  ADD COLUMN entity_type text,
  ADD COLUMN entity_id text;

UPDATE public.notifications n
SET title=INITCAP(REPLACE(n.type, '_', ' ')),
    message=COALESCE(n.details, ''),
    entity_type=CASE
      WHEN nr.work_item_id IS NOT NULL THEN 'task'
      WHEN nr.target_project_id IS NOT NULL THEN 'project'
      WHEN nr.milestone_id IS NOT NULL THEN 'milestone'
      ELSE NULL
    END,
    entity_id=COALESCE(nr.work_item_id, nr.target_project_id, nr.milestone_id),
    link=CASE
      WHEN nr.work_item_id IS NOT NULL THEN '/tasks/' || nr.work_item_id
      WHEN nr.target_project_id IS NOT NULL THEN '/projects/' || nr.target_project_id
      WHEN nr.milestone_id IS NOT NULL THEN '/projects/' || nr.project_scope_id
      ELSE NULL
    END
FROM public.notification_resources nr
WHERE nr.notification_id=n.id;

CREATE INDEX notifications_user_read_created_idx
  ON public.notifications (recipient_user_id, read_at, created_at DESC);
