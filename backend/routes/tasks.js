const router = require('express').Router();
const { auth } = require('../middleware/auth');
const { store, hydrateTask } = require('../services/data');

const isOverdue = (task) => task.endDate && new Date(task.endDate) < new Date() && task.status !== 'Completed';
const matchesFilters = (task, query, userId) => (!query.project || task.project === query.project)
  && (!query.status || task.status === query.status)
  && (!query.search || String(task.title || '').toLowerCase().includes(String(query.search).toLowerCase()))
  && (!query.assignee || task.assignee === (query.assignee === 'me' ? userId : query.assignee))
  && (!query.reporter || task.reporter === (query.reporter === 'me' ? userId : query.reporter))
  && (query.overdue !== 'true' || isOverdue(task));

router.get('/', auth, async (req, res) => {
  try {
    let tasks = (await store.list('tasks'))
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
    const tasks = (await store.list('tasks')).filter((task) => req.user.role === 'admin'
      || task.assignee === req.user._id
      || task.reporter === req.user._id);
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
    const tasks = (await store.list('tasks'))
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
    const task = await store.insert('tasks', {
      title, description: description || '', project, reporter: req.user._id,
      assignee: assignee || '', status: status || 'To do', priority: priority || 'Medium',
      startDate: startDate || '', endDate: endDate || ''
    });
    res.status(201).json(await hydrateTask(task));
  } catch (err) {
    res.status(500).json({ message: 'Unable to create task' });
  }
});

router.put('/:id', auth, async (req, res) => {
  try {
    const update = {};
    ['title', 'description', 'project', 'reporter', 'assignee', 'status', 'priority', 'startDate', 'endDate']
      .forEach((field) => { if (req.body?.[field] !== undefined) update[field] = req.body[field]; });
    const task = await store.update('tasks', req.params.id, update);
    if (!task) return res.status(404).json({ message: 'Not found' });
    res.json(await hydrateTask(task));
  } catch (err) {
    res.status(500).json({ message: 'Unable to update task' });
  }
});

router.delete('/:id', auth, async (req, res) => {
  try {
    await store.remove('tasks', req.params.id);
    res.json({ message: 'Deleted' });
  } catch (err) {
    res.status(500).json({ message: 'Unable to delete task' });
  }
});

module.exports = router;
