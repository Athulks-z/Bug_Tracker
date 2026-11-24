const { PostgresStore } = require('./postgresStore');

const store = new PostgresStore();

function publicRecord(record) {
  if (!record) return null;
  const { __rowNumber, ...result } = record;
  return result;
}

function publicUser(user) {
  if (!user) return null;
  const { password, bootstrapAdmin, ...result } = publicRecord(user);
  return result;
}

async function hydrateUser(user) {
  if (!user) return null;
  const result = publicUser(user);
  if (result.reportingManager) {
    result.reportingManager = publicUser(await store.findById('users', result.reportingManager));
  }
  const projectIds = Array.isArray(result.assignedProjects) ? result.assignedProjects : [];
  result.assignedProjects = (await Promise.all(projectIds.map((id) => store.findById('projects', id))))
    .filter(Boolean)
    .map(({ _id, name, key }) => ({ _id, name, key }));
  return result;
}

async function hydrateProject(project) {
  if (!project) return null;
  const result = { ...publicRecord(project), prefix: project.key };
  result.owner = publicUser(await store.findById('users', project.owner));
  result.members = (await Promise.all((project.members || []).map((id) => store.findById('users', id))))
    .filter(Boolean)
    .map(publicUser);
  return result;
}

async function hydrateIssue(issue) {
  if (!issue) return null;
  const result = publicRecord(issue);
  result.reporter = await hydrateUser(await store.findById('users', issue.reporter));
  result.assignee = issue.assignee ? await hydrateUser(await store.findById('users', issue.assignee)) : null;
  result.rejectedBy = issue.rejectedBy ? publicUser(await store.findById('users', issue.rejectedBy)) : null;
  result.project = await hydrateProject(await store.findById('projects', issue.project));
  result.comments = await Promise.all((issue.comments || []).map(async (comment) => ({
    ...comment,
    author: publicUser(await store.findById('users', comment.author))
  })));
  result.activity = await Promise.all((issue.activity || []).map(async (activity) => ({
    ...activity,
    user: publicUser(await store.findById('users', activity.user))
  })));
  result.timeLogs = await Promise.all((issue.timeLogs || []).map(async (timeLog) => ({
    ...timeLog,
    user: publicUser(await store.findById('users', timeLog.user))
  })));
  return result;
}

async function hydrateTask(task) {
  if (!task) return null;
  const result = publicRecord(task);
  result.typeLabel = String(task.type || '').toLowerCase() === 'other'
    ? (task.customTypeName ? `Other: ${task.customTypeName}` : 'Other')
    : (task.type || 'Task');
  result.reporter = publicUser(await store.findById('users', task.reporter));
  result.assignee = task.assignee ? publicUser(await store.findById('users', task.assignee)) : null;
  result.rejectedBy = task.rejectedBy ? publicUser(await store.findById('users', task.rejectedBy)) : null;
  result.project = await hydrateProject(await store.findById('projects', task.project));
  result.comments = await Promise.all((task.comments || []).map(async (comment) => ({
    ...comment,
    author: publicUser(await store.findById('users', comment.author))
  })));
  result.activity = await Promise.all((task.activity || []).map(async (activity) => ({
    ...activity,
    user: publicUser(await store.findById('users', activity.user))
  })));
  result.timeLogs = await Promise.all((task.timeLogs || []).map(async (timeLog) => ({
    ...timeLog,
    user: publicUser(await store.findById('users', timeLog.user))
  })));
  return result;
}

module.exports = { store, publicRecord, publicUser, hydrateUser, hydrateProject, hydrateIssue, hydrateTask };
