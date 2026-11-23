const test = require('node:test');
const assert = require('node:assert/strict');
const {
  isAdministrator,
  isSuperAdministrator,
  canReadProject,
  canManageProject,
  canCreateWorkItem,
  canUpdateWorkItem
} = require('./roles');

const project = { _id: 'p1', owner: 'owner', members: ['manager', 'employee', 'trainee', 'assignee'] };
const issue = { project: 'p1', reporter: 'employee', assignee: 'assignee' };

test('administrator role capabilities distinguish super admin from admin', () => {
  assert.equal(isAdministrator({ role: 'super_admin' }), true);
  assert.equal(isAdministrator({ role: 'admin' }), true);
  assert.equal(isAdministrator({ role: 'manager' }), false);
  assert.equal(isSuperAdministrator({ role: 'admin' }), false);
});

test('project access and work item permissions follow the approved role matrix', () => {
  const superAdmin = { role: 'super_admin', _id: 'root' };
  const admin = { role: 'admin', _id: 'admin' };
  const manager = { role: 'manager', _id: 'manager', assignedProjects: ['p1'] };
  const employee = { role: 'employee', _id: 'employee', assignedProjects: ['p1'] };
  const trainee = { role: 'trainee', _id: 'trainee', assignedProjects: ['p1'] };
  const outsider = { role: 'employee', _id: 'outsider', assignedProjects: [] };

  assert.equal(canReadProject(superAdmin, project), true);
  assert.equal(canReadProject(admin, project), true);
  assert.equal(canReadProject(manager, project), true);
  assert.equal(canReadProject(employee, project), true);
  assert.equal(canReadProject(trainee, project), true);
  assert.equal(canReadProject(outsider, project), false);

  assert.equal(canManageProject(manager, project), true);
  assert.equal(canManageProject(employee, project), false);
  assert.equal(canCreateWorkItem(manager, project), true);
  assert.equal(canCreateWorkItem(employee, project), true);
  assert.equal(canCreateWorkItem(trainee, project), false);

  assert.equal(canUpdateWorkItem(employee, issue, project), true);
  assert.equal(canUpdateWorkItem({ ...employee, _id: 'assignee' }, issue, project), true);
  assert.equal(canUpdateWorkItem({ ...employee, _id: 'outsider' }, issue, project), false);
  assert.equal(canUpdateWorkItem(trainee, issue, project), false);
  assert.equal(canUpdateWorkItem(manager, issue, project), true);
});
