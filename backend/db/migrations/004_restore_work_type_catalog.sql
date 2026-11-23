INSERT INTO public.work_types (value, label, icon, sort_order) VALUES
  ('task', 'Task', 'check-square', 10),
  ('bug', 'Bug', 'bug', 20),
  ('feature', 'Feature', 'sparkles', 30),
  ('improvement', 'Improvement', 'trending-up', 40),
  ('other', 'Other', 'circle', 50)
ON CONFLICT (value) DO UPDATE SET
  label = EXCLUDED.label,
  icon = EXCLUDED.icon,
  sort_order = EXCLUDED.sort_order,
  active = true;

INSERT INTO public.work_type_kinds (type_value, kind) VALUES
  ('task', 'task'),
  ('other', 'task'),
  ('bug', 'issue'),
  ('feature', 'issue'),
  ('improvement', 'issue'),
  ('other', 'issue')
ON CONFLICT DO NOTHING;

CREATE UNIQUE INDEX users_bootstrap_admin_unique
  ON public.users (bootstrap_admin)
  WHERE bootstrap_admin;
