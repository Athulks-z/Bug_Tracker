const router = require('express').Router();
const Project = require('../models/Project');
const { auth, adminOnly } = require('../middleware/auth');

router.get('/', auth, async (req, res) => {
  try {
    const q = req.user.role === 'admin' ? {} : { members: req.user._id };
    const projects = await Project.find(q).populate('owner', 'name email').populate('members', 'name email').sort({ createdAt: -1 });
    res.json(projects);
  } catch (err) { res.status(500).json({ message: err.message }); }
});

router.post('/', auth, async (req, res) => {
  try {
    const { name, description, key, members } = req.body;
    if (!name || !key) return res.status(400).json({ message: 'Name and key required' });
    const project = await Project.create({ name, description, key: key.toUpperCase(), owner: req.user._id, members: members || [] });
    res.status(201).json(await project.populate(['owner', 'members']));
  } catch (err) { res.status(500).json({ message: err.message }); }
});

router.put('/:id', auth, async (req, res) => {
  try {
    const project = await Project.findByIdAndUpdate(req.params.id, req.body, { new: true }).populate(['owner', 'members']);
    if (!project) return res.status(404).json({ message: 'Not found' });
    res.json(project);
  } catch (err) { res.status(500).json({ message: err.message }); }
});

router.delete('/:id', auth, adminOnly, async (req, res) => {
  try {
    await Project.findByIdAndDelete(req.params.id);
    res.json({ message: 'Deleted' });
  } catch (err) { res.status(500).json({ message: err.message }); }
});

module.exports = router;
