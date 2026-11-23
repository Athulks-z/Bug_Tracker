DELETE FROM public.work_types
WHERE value IN ('task', 'bug', 'feature', 'improvement', 'other');

CREATE UNIQUE INDEX email_recipients_email_lower_unique
  ON public.email_recipients (email_outbox_id, lower(email_snapshot));

CREATE FUNCTION public.enforce_manager_department_role() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  role_code text;
BEGIN
  SELECT users.role_code INTO role_code
  FROM public.users
  WHERE users.id = NEW.manager_user_id;

  IF role_code IS DISTINCT FROM 'manager' THEN
    RAISE EXCEPTION 'Manager department scope requires a manager user'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END
$$;

CREATE TRIGGER manager_departments_role_guard
BEFORE INSERT OR UPDATE OF manager_user_id ON public.manager_departments
FOR EACH ROW EXECUTE FUNCTION public.enforce_manager_department_role();

CREATE FUNCTION public.prevent_invalid_manager_role_change() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.role_code IS DISTINCT FROM 'manager'
     AND EXISTS (
       SELECT 1
       FROM public.manager_departments
       WHERE manager_user_id = NEW.id
     ) THEN
    RAISE EXCEPTION 'Remove manager department scopes before changing the user role'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END
$$;

CREATE TRIGGER users_manager_role_guard
BEFORE UPDATE OF role_code ON public.users
FOR EACH ROW EXECUTE FUNCTION public.prevent_invalid_manager_role_change();

CREATE FUNCTION public.prevent_department_hierarchy_cycles() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.parent_department_id IS NOT NULL AND EXISTS (
    WITH RECURSIVE parent_chain(id) AS (
      SELECT NEW.parent_department_id
      UNION
      SELECT departments.parent_department_id
      FROM public.departments
      JOIN parent_chain ON departments.id = parent_chain.id
      WHERE departments.parent_department_id IS NOT NULL
    )
    SELECT 1 FROM parent_chain WHERE id = NEW.id
  ) THEN
    RAISE EXCEPTION 'Department parent change would create a hierarchy cycle'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END
$$;

CREATE TRIGGER departments_hierarchy_guard
BEFORE INSERT OR UPDATE OF parent_department_id ON public.departments
FOR EACH ROW EXECUTE FUNCTION public.prevent_department_hierarchy_cycles();

CREATE FUNCTION public.enforce_project_department_shares() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  affected_project_id text;
  owning_department_id text;
BEGIN
  IF TG_TABLE_NAME = 'projects' THEN
    affected_project_id := CASE WHEN TG_OP = 'DELETE' THEN OLD.id ELSE NEW.id END;
  ELSE
    affected_project_id := CASE WHEN TG_OP = 'DELETE' THEN OLD.project_id ELSE NEW.project_id END;
  END IF;

  SELECT projects.owning_department_id INTO owning_department_id
  FROM public.projects
  WHERE projects.id = affected_project_id;

  IF owning_department_id IS NOT NULL AND EXISTS (
    SELECT 1
    FROM public.project_departments
    WHERE project_id = affected_project_id
      AND department_id = owning_department_id
  ) THEN
    RAISE EXCEPTION 'Owning department cannot also be a shared project department'
      USING ERRCODE = '23514';
  END IF;
  RETURN NULL;
END
$$;

CREATE CONSTRAINT TRIGGER projects_department_share_guard
AFTER INSERT OR UPDATE OR DELETE ON public.projects
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW
EXECUTE FUNCTION public.enforce_project_department_shares();

CREATE CONSTRAINT TRIGGER project_departments_share_guard
AFTER INSERT OR UPDATE OR DELETE ON public.project_departments
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW
EXECUTE FUNCTION public.enforce_project_department_shares();
