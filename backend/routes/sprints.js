const router = require('express').Router();
const { auth } = require('../middleware/auth');
const { store, publicRecord } = require('../services/data');

router.get('/', auth, async (req, res) => {
  try {
    const sprints = (await store.list('sprints'))
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
    const update = {};
    ['name', 'project', 'startDate', 'endDate', 'goal', 'status']
      .forEach((field) => { if (req.body?.[field] !== undefined) update[field] = req.body[field]; });
    const sprint = await store.update('sprints', req.params.id, update);
    if (!sprint) return res.status(404).json({ message: 'Not found' });
    res.json(sprint);
  } catch (err) {
    res.status(500).json({ message: 'Unable to update sprint' });
  }
});

router.delete('/:id', auth, async (req, res) => {
  try {
    await store.remove('sprints', req.params.id);
    res.json({ message: 'Deleted' });
  } catch (err) {
    res.status(500).json({ message: 'Unable to delete sprint' });
  }
});

module.exports = router;
