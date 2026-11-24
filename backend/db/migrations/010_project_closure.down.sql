DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.project_closures)
    OR EXISTS (SELECT 1 FROM public.project_closure_uploads)
    OR EXISTS (SELECT 1 FROM public.projects WHERE status='closed') THEN
    RAISE EXCEPTION 'Reopen projects and remove staged closure uploads before rolling back project closure data';
  END IF;
END;
$$;

DROP TRIGGER IF EXISTS projects_require_reopen_before_status_change ON public.projects;
DROP FUNCTION IF EXISTS public.protect_closed_project_mutations();
DROP TRIGGER IF EXISTS work_items_reject_closed_project ON public.work_items;
DROP TRIGGER IF EXISTS milestones_reject_closed_project ON public.milestones;
DROP TRIGGER IF EXISTS stakeholders_reject_closed_project ON public.project_stakeholders;
DROP TRIGGER IF EXISTS closure_uploads_reject_closed_project ON public.project_closure_uploads;
DROP FUNCTION IF EXISTS public.reject_closed_project_child_mutation();

DROP INDEX IF EXISTS public.attachments_project_closure_idx;
ALTER TABLE public.attachments
  DROP CONSTRAINT IF EXISTS attachments_project_closure_fk,
  DROP CONSTRAINT IF EXISTS attachments_exactly_one_parent,
  DROP COLUMN IF EXISTS project_closure_id,
  ADD CONSTRAINT attachments_exactly_one_parent CHECK (
    (work_item_id IS NOT NULL) <> (backlog_item_id IS NOT NULL)
  );

DROP INDEX IF EXISTS public.project_closure_uploads_expiry_idx;
DROP TABLE IF EXISTS public.project_closure_uploads;
DROP INDEX IF EXISTS public.project_closures_history_idx;
DROP INDEX IF EXISTS public.project_closures_one_active_idx;
DROP TABLE IF EXISTS public.project_closures;

ALTER TABLE public.projects
  DROP CONSTRAINT IF EXISTS projects_status_fk,
  ADD CONSTRAINT projects_status_check
    CHECK (status IN ('planning','active','on_hold','completed','archived','cancelled'));

DROP TRIGGER IF EXISTS project_statuses_protect_closed ON public.project_statuses;
DROP FUNCTION IF EXISTS public.protect_closed_project_status();
DROP TABLE IF EXISTS public.project_statuses;
