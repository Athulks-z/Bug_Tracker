const { isAdministrator, isManager } = require('./roles');

function buildTaskVisibilityFilter(user, alias = 'w', parameterIndex = 1) {
  if (isAdministrator(user) || isManager(user)) {
    return { clause: 'TRUE', values: [] };
  }
  return {
    clause: `${alias}.assignee_user_id = $${parameterIndex}`,
    values: [String(user?._id || '')]
  };
}

module.exports = { buildTaskVisibilityFilter };
