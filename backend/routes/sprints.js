const router = require('express').Router();
const Sprint = require('../models/Sprint');
const { auth } = require('../middleware/auth');

router.get('/', auth, async (req, res) => {
  try {
    const { project } = req.query;
    const q = {};
    if (project) q.project = project;
    const sprints = await Sprint.find(q).sort({ startDate: -1 });
    res.json(sprints);
  } catch (err) { res.status(500).json({ message: err.message }); }
});

router.post('/', auth, async (req, res) => {
  try {
    const sprint = new Sprint(req.body);
    await sprint.save();
    res.status(201).json(sprint);
  } catch (err) { res.status(500).json({ message: err.message }); }
});

router.put('/:id', auth, async (req, res) => {
  try {
    const sprint = await Sprint.findByIdAndUpdate(req.params.id, req.body, { new: true });
    res.json(sprint);
  } catch (err) { res.status(500).json({ message: err.message }); }
});

router.delete('/:id', auth, async (req, res) => {
  try {
    await Sprint.findByIdAndDelete(req.params.id);
    res.json({ message: 'Deleted' });
  } catch (err) { res.status(500).json({ message: err.message }); }
});

module.exports = router;
