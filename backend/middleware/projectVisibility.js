const { canViewAllProjects } = require('./roles');

function buildProjectVisibilityFilter(user, alias = 'p', parameterIndex = 1) {
  if (canViewAllProjects(user)) return { clause: 'TRUE', values: [] };
  const userId = String(user?._id || '');
  if (!userId) return { clause: 'FALSE', values: [] };
  const parameter = `$${parameterIndex}`;
  return {
    clause: `(
      ${alias}.owner_user_id=${parameter}
      OR EXISTS (
        SELECT 1 FROM public.project_members pm
        WHERE pm.project_id=${alias}.id AND pm.user_id=${parameter} AND pm.active=true
      )
      OR EXISTS (
        SELECT 1 FROM public.project_stakeholders ps
        WHERE ps.project_id=${alias}.id AND ps.user_id=${parameter}
      )
    )`,
    values: [userId]
  };
}

module.exports = { buildProjectVisibilityFilter };
