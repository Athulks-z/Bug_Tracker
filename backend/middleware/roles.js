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

function canViewAllProjects(user) {
  return isAdministrator(user) || isManager(user);
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
  if (!project) return false;
  const userId = String(user?._id || '');
  return canViewAllProjects(user) || projectHasUser(project, userId);
}

function canManageProject(user, project) {
  if (!project) return false;
  return isAdministrator(user)
    || (isManager(user) && projectHasUser(project, String(user?._id || ''), false));
}

function canCreateWorkItem(user, project) {
  if (!project) return false;
  return isAdministrator(user)
    || ((isManager(user) || user?.role === 'employee')
      && projectHasUser(project, String(user?._id || '')));
}

function canCreateBacklog(user, project) {
  if (!project) return false;
  if (canViewAllProjects(user)) return true;
  return user?.role === 'employee'
    && projectHasUser(project, String(user?._id || ''));
}

function projectHasUser(project, userId, includeStakeholders = true) {
  const projectUserId = (value) => String(typeof value === 'object' && value !== null ? value._id : value || '');
  return projectUserId(project.owner) === userId
    || (project.members || []).some((member) => projectUserId(member) === userId)
    || (includeStakeholders && (project.stakeholders || []).some((member) => projectUserId(member) === userId));
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
  canViewAllProjects,
  projectIds,
  hasProjectAccess,
  hasProjectManagementAccess,
  canReadProject,
  canManageProject,
  canCreateWorkItem,
  canCreateBacklog,
  canUpdateWorkItem,
  requireRoles,
  requireAdministrator
};
