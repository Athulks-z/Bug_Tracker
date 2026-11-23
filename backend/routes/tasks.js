const router = require('express').Router();
const { auth } = require('../middleware/auth');
const {
  isAdministrator,
  canReadProject,
  canCreateWorkItem,
  canUpdateWorkItem,
  canManageProject
} = require('../middleware/roles');
const { store, hydrateTask } = require('../services/data');
const { queueAssignmentEmail } = require('../services/emailService');

const isOverdue = (task) => task.endDate && new Date(task.endDate) < new Date() && task.status !== 'Completed';
const matchesFilters = (task, query, userId) => (!query.project || task.project === query.project)
  && (!query.status || task.status === query.status)
  && (!query.search || String(task.title || '').toLowerCase().includes(String(query.search).toLowerCase()))
  && (!query.assignee || task.assignee === (query.assignee === 'me' ? userId : query.assignee))
  && (!query.reporter || task.reporter === (query.reporter === 'me' ? userId : query.reporter))
  && (query.overdue !== 'true' || isOverdue(task));

async function loadVisibleTasks(user) {
  const [tasks, projects] = await Promise.all([store.list('tasks'), store.list('projects')]);
  const visibleProjectIds = new Set(projects.filter((project) => canReadProject(user, project)).map((project) => project._id));
  return tasks.filter((task) => visibleProjectIds.has(task.project));
}

router.get('/', auth, async (req, res) => {
  try {
    let tasks = (await loadVisibleTasks(req.user))
      .filter((task) => matchesFilters(task, req.query, req.user._id))
      .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
    if (req.query.limit) tasks = tasks.slice(0, Math.max(0, parseInt(req.query.limit, 10) || 0));
    res.json(await Promise.all(tasks.map(hydrateTask)));
  } catch (err) {
    res.status(500).json({ message: 'Unable to load tasks' });
  }
});

router.get('/stats/summary', auth, async (req, res) => {
  try {
    const tasks = await loadVisibleTasks(req.user);
    const counts = tasks.reduce((result, task) => {
      result[task.status] = (result[task.status] || 0) + 1;
      return result;
    }, {});
    res.json(Object.entries(counts).sort((a, b) => b[1] - a[1]).map(([_id, count]) => ({ _id, count })));
  } catch (err) {
    res.status(500).json({ message: 'Unable to load task summary' });
  }
});

router.get('/export', auth, async (req, res) => {
  try {
    const tasks = (await loadVisibleTasks(req.user))
      .filter((task) => matchesFilters(task, req.query, req.user._id))
      .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
    const populated = await Promise.all(tasks.map(hydrateTask));
    const escape = (value) => `"${String(value == null ? '' : value).replace(/"/g, '""')}"`;
    const fields = ['Task ID', 'Title', 'Description', 'Project', 'Project Key', 'Reporter', 'Reporter Email', 'Assignee', 'Assignee Email', 'Status', 'Priority', 'Start Date', 'End Date', 'Created At', 'Updated At'];
    const rows = populated.map((task) => [
      task._id, task.title, task.description, task.project?.name, task.project?.key,
      task.reporter?.name, task.reporter?.email, task.assignee?.name, task.assignee?.email,
      task.status, task.priority, task.startDate?.slice(0, 10), task.endDate?.slice(0, 10),
      task.createdAt, task.updatedAt
    ]);
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename="tasks.csv"');
    res.send([fields, ...rows].map((row) => row.map(escape).join(',')).join('\r\n'));
  } catch (err) {
    res.status(500).json({ message: 'Unable to export tasks' });
  }
});

router.post('/', auth, async (req, res) => {
  try {
    const { title, description, project, assignee, status, priority, startDate, endDate } = req.body || {};
    if (!title || !project) return res.status(400).json({ message: 'Title and project required' });
    const projectRecord = await store.findById('projects', project);
    if (!canCreateWorkItem(req.user, projectRecord)) {
      return res.status(403).json({ message: 'You cannot create tasks in this project' });
    }
    if (!['super_admin', 'admin', 'manager', 'employee'].includes(req.user.role)) {
      return res.status(403).json({ message: 'Your role is read-only' });
    }
    if (req.user.role === 'employee' && assignee && assignee !== req.user._id) {
      return res.status(403).json({ message: 'Employees cannot assign tasks to other users' });
    }
    if (assignee && req.user.role !== 'employee') {
      const assigneeRecord = await store.findById('users', assignee);
      if (!assigneeRecord?.active
        || (projectRecord.owner !== assignee
          && !(projectRecord.members || []).map(String).includes(String(assignee)))) {
        return res.status(400).json({ message: 'The assignee must be a member of this project' });
      }
    }
    const task = await store.insert('tasks', {
      title, description: description || '', project, reporter: req.user._id,
      assignee: assignee || '', status: status || 'To do', priority: priority || 'Medium',
      startDate: startDate || '', endDate: endDate || ''
    });
    const response = await hydrateTask(task);
    if (assignee) {
      try {
        await queueAssignmentEmail({ kind: 'task', item: task, project: projectRecord, assigneeId: assignee, assignedBy: req.user._id });
        response.emailNotification = { queued: true };
      } catch (error) {
        console.error('Task was created, but its assignment email could not be queued:', error.name);
        response.emailNotification = {
          queued: false,
          message: 'Task saved, but the assignment email could not be queued. Check server logs.'
        };
      }
    }
    res.status(201).json(response);
  } catch (err) {
    res.status(500).json({ message: 'Unable to create task' });
  }
});

router.put('/:id', auth, async (req, res) => {
  try {
    const existing = await store.findById('tasks', req.params.id);
    if (!existing) return res.status(404).json({ message: 'Not found' });
    const project = await store.findById('projects', existing.project);
    if (!canUpdateWorkItem(req.user, existing, project)) {
      return res.status(403).json({ message: 'You cannot update this task' });
    }
    const update = {};
    const employeeFields = ['title', 'description', 'status', 'priority', 'startDate', 'endDate'];
    const managerFields = ['title', 'description', 'project', 'assignee', 'status', 'priority', 'startDate', 'endDate'];
    const allowedFields = req.user.role === 'employee'
      ? employeeFields
      : managerFields;
    if (Object.keys(req.body || {}).some((field) => !allowedFields.includes(field))) {
      return res.status(403).json({ message: 'This role cannot change one or more requested task fields' });
    }
    allowedFields
      .forEach((field) => { if (req.body?.[field] !== undefined) update[field] = req.body[field]; });
    if (update.project !== undefined) {
      const targetProject = await store.findById('projects', update.project);
      if (!canReadProject(req.user, targetProject)) {
        return res.status(403).json({ message: 'You cannot move a task to that project' });
      }
    }
    if (update.assignee) {
      const targetProjectId = update.project || existing.project;
      const assigneeRecord = await store.findById('users', update.assignee);
      const targetProject = update.project ? await store.findById('projects', targetProjectId) : project;
      if (!assigneeRecord?.active
        || (targetProject?.owner !== update.assignee
          && !(targetProject?.members || []).map(String).includes(String(update.assignee)))) {
        return res.status(400).json({ message: 'The assignee must be a member of this project' });
      }
    }
    const task = await store.update('tasks', req.params.id, update);
    if (!task) return res.status(404).json({ message: 'Not found' });
    const response = await hydrateTask(task);
    if (update.assignee && update.assignee !== existing.assignee) {
      try {
        const targetProject = update.project ? await store.findById('projects', update.project) : project;
        await queueAssignmentEmail({ kind: 'task', item: task, project: targetProject, assigneeId: update.assignee, assignedBy: req.user._id });
        response.emailNotification = { queued: true };
      } catch (error) {
        console.error('Task was updated, but its assignment email could not be queued:', error.name);
        response.emailNotification = {
          queued: false,
          message: 'Task saved, but the assignment email could not be queued. Check server logs.'
        };
      }
    }
    res.json(response);
  } catch (err) {
    res.status(500).json({ message: 'Unable to update task' });
  }
});

router.delete('/:id', auth, async (req, res) => {
  try {
    const existing = await store.findById('tasks', req.params.id);
    if (!existing) return res.status(404).json({ message: 'Not found' });
    const project = await store.findById('projects', existing.project);
    if (!canManageProject(req.user, project)) {
      return res.status(403).json({ message: 'Only administrators and project managers can delete tasks' });
    }
    await store.remove('tasks', req.params.id);
    res.json({ message: 'Deleted' });
  } catch (err) {
    res.status(500).json({ message: 'Unable to delete task' });
  }
});

module.exports = router;
