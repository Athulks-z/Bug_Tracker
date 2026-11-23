const ROLE_CODES = ['super_admin', 'admin', 'manager', 'employee', 'trainee'];

function isAdministrator(user) {
  return user?.role === 'super_admin' || user?.role === 'admin';
}

function isSuperAdministrator(user) {
  return user?.role === 'super_admin';
}

function isManager(user) {
  return user?.role === 'manager';
}

function projectIds(user) {
  return new Set((Array.isArray(user?.assignedProjects) ? user.assignedProjects : [])
    .map((project) => String(typeof project === 'object' && project !== null ? project._id : project)));
}

function hasProjectAccess(user, projectId) {
  return isAdministrator(user) || projectIds(user).has(String(projectId));
}

function hasProjectManagementAccess(user, projectId) {
  return isAdministrator(user) || (isManager(user) && projectIds(user).has(String(projectId)));
}

function canReadProject(user, project) {
  return Boolean(project && (isAdministrator(user)
    || project.owner === user?._id
    || (project.members || []).includes(user?._id)));
}

function canManageProject(user, project) {
  return Boolean(project && (isAdministrator(user)
    || (isManager(user)
      && (project.owner === user?._id || (project.members || []).includes(user?._id)))));
}

function canCreateWorkItem(user, project) {
  return Boolean(project && (isAdministrator(user)
    || ((isManager(user) || user?.role === 'employee')
      && (project.owner === user?._id || (project.members || []).includes(user?._id)))));
}

function canUpdateWorkItem(user, item, project) {
  if (!item || !project || !canReadProject(user, project)) return false;
  if (isAdministrator(user) || isManager(user)) return true;
  return user?.role === 'employee'
    && (item.reporter === user._id || item.assignee === user._id);
}

function requireRoles(...roles) {
  return (req, res, next) => {
    if (!roles.includes(req.user?.role)) return res.status(403).json({ message: 'Insufficient permissions' });
    next();
  };
}

function requireAdministrator(req, res, next) {
  if (!isAdministrator(req.user)) return res.status(403).json({ message: 'Administrator access required' });
  next();
}

module.exports = {
  ROLE_CODES,
  isAdministrator,
  isSuperAdministrator,
  isManager,
  projectIds,
  hasProjectAccess,
  hasProjectManagementAccess,
  canReadProject,
  canManageProject,
  canCreateWorkItem,
  canUpdateWorkItem,
  requireRoles,
  requireAdministrator
};
