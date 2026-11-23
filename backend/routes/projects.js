const router = require('express').Router();
const { auth, adminOnly } = require('../middleware/auth');
const { store, hydrateProject } = require('../services/data');

router.get('/', auth, async (req, res) => {
  try {
    const projects = (await store.list('projects'))
      .filter((project) => req.user.role === 'admin'
        || project.owner === req.user._id
        || (project.members || []).includes(req.user._id))
      .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
    res.json(await Promise.all(projects.map(hydrateProject)));
  } catch (err) {
    res.status(500).json({ message: 'Unable to load projects' });
  }
});

router.post('/', auth, async (req, res) => {
  try {
    const { name, description, key, owner, members } = req.body || {};
    if (!name || !key) return res.status(400).json({ message: 'Name and key required' });
    const project = await store.insert('projects', {
      name,
      description: description || '',
      key: String(key).toUpperCase(),
      owner: owner || req.user._id,
      members: members || [],
      status: 'active'
    });
    res.status(201).json(await hydrateProject(project));
  } catch (err) {
    res.status(500).json({ message: 'Unable to create project' });
  }
});

router.put('/:id', auth, async (req, res) => {
  try {
    const existing = await store.findById('projects', req.params.id);
    if (!existing) return res.status(404).json({ message: 'Not found' });
    const allowed = ['name', 'description', 'key', 'owner', 'members', 'status'];
    const update = {};
    allowed.forEach((field) => {
      if (req.body?.[field] !== undefined) update[field] = field === 'key'
        ? String(req.body[field]).toUpperCase()
        : req.body[field];
    });
    const project = await store.update('projects', req.params.id, update);
    res.json(await hydrateProject(project));
  } catch (err) {
    res.status(500).json({ message: 'Unable to update project' });
  }
});

router.delete('/:id', auth, adminOnly, async (req, res) => {
  try {
    await store.remove('projects', req.params.id);
    res.json({ message: 'Deleted' });
  } catch (err) {
    res.status(500).json({ message: 'Unable to delete project' });
  }
});

module.exports = router;
