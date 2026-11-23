const router = require('express').Router();
const { auth } = require('../middleware/auth');
const { canReadProject, canManageProject } = require('../middleware/roles');
const { store, publicRecord } = require('../services/data');

router.get('/', auth, async (req, res) => {
  try {
    const accessibleProjectIds = new Set((await store.list('projects'))
      .filter((project) => canReadProject(req.user, project))
      .map((project) => project._id));
    const sprints = (await store.list('sprints'))
      .filter((sprint) => accessibleProjectIds.has(sprint.project))
      .filter((sprint) => !req.query.project || sprint.project === req.query.project)
      .sort((a, b) => String(b.startDate || '').localeCompare(String(a.startDate || '')));
    res.json(sprints.map(publicRecord));
  } catch (err) {
    res.status(500).json({ message: 'Unable to load sprints' });
  }
});

router.post('/', auth, async (req, res) => {
  try {
    const { name, project, startDate, endDate, goal, status } = req.body || {};
    const projectRecord = await store.findById('projects', project);
    if (!canManageProject(req.user, projectRecord)) {
      return res.status(403).json({ message: 'Only administrators and project managers can manage sprints' });
    }
    const sprint = await store.insert('sprints', {
      name: name || '',
      project: project || '',
      startDate: startDate || '',
      endDate: endDate || '',
      goal: goal || '',
      status: status || 'Planned'
    });
    res.status(201).json(sprint);
  } catch (err) {
    res.status(500).json({ message: 'Unable to create sprint' });
  }
});

router.put('/:id', auth, async (req, res) => {
  try {
    const existing = (await store.list('sprints')).find((sprint) => sprint._id === req.params.id);
    if (!existing) return res.status(404).json({ message: 'Not found' });
    const currentProject = await store.findById('projects', existing.project);
    if (!canManageProject(req.user, currentProject)) {
      return res.status(403).json({ message: 'Only administrators and project managers can manage sprints' });
    }
    const update = {};
    ['name', 'project', 'startDate', 'endDate', 'goal', 'status']
      .forEach((field) => { if (req.body?.[field] !== undefined) update[field] = req.body[field]; });
    if (update.project !== undefined) {
      const targetProject = await store.findById('projects', update.project);
      if (!canManageProject(req.user, targetProject)) {
        return res.status(403).json({ message: 'You cannot move a sprint to that project' });
      }
    }
    const sprint = await store.update('sprints', req.params.id, update);
    if (!sprint) return res.status(404).json({ message: 'Not found' });
    res.json(sprint);
  } catch (err) {
    res.status(500).json({ message: 'Unable to update sprint' });
  }
});

router.delete('/:id', auth, async (req, res) => {
  try {
    const existing = (await store.list('sprints')).find((sprint) => sprint._id === req.params.id);
    if (!existing) return res.status(404).json({ message: 'Not found' });
    const project = await store.findById('projects', existing.project);
    if (!canManageProject(req.user, project)) {
      return res.status(403).json({ message: 'Only administrators and project managers can manage sprints' });
    }
    await store.remove('sprints', req.params.id);
    res.json({ message: 'Deleted' });
  } catch (err) {
    res.status(500).json({ message: 'Unable to delete sprint' });
  }
});

module.exports = router;
