CREATE OR REPLACE FUNCTION public.reject_closed_project_child_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  child_project_id text;
  project_status text;
BEGIN
  IF TG_OP='UPDATE' AND NEW.project_id IS DISTINCT FROM OLD.project_id THEN
    SELECT status INTO project_status
    FROM public.projects
    WHERE id=OLD.project_id
    FOR SHARE;
    IF project_status='closed' THEN
      RAISE EXCEPTION 'Closed projects are read-only';
    END IF;
  END IF;
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

CREATE TRIGGER project_members_reject_closed_project
BEFORE INSERT OR UPDATE OR DELETE ON public.project_members
FOR EACH ROW EXECUTE FUNCTION public.reject_closed_project_child_mutation();

CREATE TRIGGER attachments_reject_closed_project
BEFORE INSERT OR UPDATE OR DELETE ON public.attachments
FOR EACH ROW EXECUTE FUNCTION public.reject_closed_project_child_mutation();

CREATE TRIGGER sprints_reject_closed_project
BEFORE INSERT OR UPDATE OR DELETE ON public.sprints
FOR EACH ROW EXECUTE FUNCTION public.reject_closed_project_child_mutation();

CREATE TRIGGER releases_reject_closed_project
BEFORE INSERT OR UPDATE OR DELETE ON public.releases
FOR EACH ROW EXECUTE FUNCTION public.reject_closed_project_child_mutation();
