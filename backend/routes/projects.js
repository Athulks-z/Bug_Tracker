const router = require('express').Router();
const { auth, adminOnly } = require('../middleware/auth');
const { isAdministrator, canReadProject, canManageProject } = require('../middleware/roles');
const { store, hydrateProject } = require('../services/data');

router.get('/', auth, async (req, res) => {
  try {
    const projects = (await store.list('projects'))
      .filter((project) => canReadProject(req.user, project))
      .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
    res.json(await Promise.all(projects.map(hydrateProject)));
  } catch (err) {
    res.status(500).json({ message: 'Unable to load projects' });
  }
});

router.post('/', auth, adminOnly, async (req, res) => {
  try {
    const { name, description, key, owner, members } = req.body || {};
    if (!name || !key) return res.status(400).json({ message: 'Name and key required' });
    if (members !== undefined && !Array.isArray(members)) {
      return res.status(400).json({ message: 'Project members must be an array' });
    }
    const userIds = new Set((await store.list('users')).map((user) => user._id));
    if ((members || []).some((id) => !userIds.has(String(id)))) {
      return res.status(400).json({ message: 'One or more project members do not exist' });
    }
    if (owner && !userIds.has(String(owner))) {
      return res.status(400).json({ message: 'Project owner not found' });
    }
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
    if (!canReadProject(req.user, existing)) return res.status(404).json({ message: 'Not found' });
    const allowed = ['name', 'description', 'key', 'owner', 'members', 'status'];
    const update = {};
    if (isAdministrator(req.user)) {
      allowed.forEach((field) => {
        if (req.body?.[field] !== undefined) update[field] = field === 'key'
          ? String(req.body[field]).toUpperCase()
          : req.body[field];
      });
    } else if (canManageProject(req.user, existing)) {
      const requestedFields = Object.keys(req.body || {});
      if (requestedFields.some((field) => field !== 'members')) {
        return res.status(403).json({ message: 'Managers may only update project membership' });
      }
      if (!Array.isArray(req.body?.members)) {
        return res.status(400).json({ message: 'Project members must be an array' });
      }
      if (existing.owner !== req.user._id && !req.body.members.map(String).includes(req.user._id)) {
        return res.status(400).json({ message: 'Managers cannot remove their own project access' });
      }
      update.members = req.body.members;
    } else {
      return res.status(403).json({ message: 'Insufficient permissions' });
    }
    if (update.members !== undefined) {
      if (!Array.isArray(update.members)) {
        return res.status(400).json({ message: 'Project members must be an array' });
      }
      const users = new Set((await store.list('users')).map((user) => user._id));
      if (update.members.some((userId) => !users.has(String(userId)))) {
        return res.status(400).json({ message: 'One or more project members do not exist' });
      }
    }
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
