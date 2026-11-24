DROP TRIGGER IF EXISTS project_members_reject_closed_project ON public.project_members;
DROP TRIGGER IF EXISTS attachments_reject_closed_project ON public.attachments;
DROP TRIGGER IF EXISTS sprints_reject_closed_project ON public.sprints;
DROP TRIGGER IF EXISTS releases_reject_closed_project ON public.releases;

CREATE OR REPLACE FUNCTION public.reject_closed_project_child_mutation()
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
