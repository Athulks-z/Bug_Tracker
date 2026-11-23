const router = require('express').Router();
const { auth, adminOnly } = require('../middleware/auth');
const { isAdministrator, canReadProject, canManageProject } = require('../middleware/roles');
const { store, hydrateProject } = require('../services/data');
const {
  getProjectStakeholders,
  replaceProjectStakeholders,
  validateProjectStakeholders
} = require('../services/projectStakeholders');

async function hydrateProjectWithStakeholders(project) {
  const result = await hydrateProject(project);
  if (result) result.stakeholders = await getProjectStakeholders(project._id);
  return result;
}

router.get('/', auth, async (req, res) => {
  try {
    const projects = (await store.list('projects'))
      .filter((project) => canReadProject(req.user, project))
      .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
    res.json(await Promise.all(projects.map(hydrateProjectWithStakeholders)));
  } catch (err) {
    res.status(500).json({ message: 'Unable to load projects' });
  }
});

router.post('/', auth, adminOnly, async (req, res) => {
  try {
    const { name, description, key, owner, members, stakeholders } = req.body || {};
    if (!name || !key) return res.status(400).json({ message: 'Name and key required' });
    if (members !== undefined && !Array.isArray(members)) {
      return res.status(400).json({ message: 'Project members must be an array' });
    }
    if (stakeholders !== undefined && !Array.isArray(stakeholders)) {
      return res.status(400).json({ message: 'Project stakeholders must be an array' });
    }
    if (stakeholders !== undefined && !await validateProjectStakeholders(stakeholders)) {
      return res.status(400).json({ message: 'One or more project stakeholders are missing or inactive' });
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
    if (stakeholders !== undefined) {
      await replaceProjectStakeholders(project._id, stakeholders, req.user._id);
    }
    res.status(201).json(await hydrateProjectWithStakeholders(project));
  } catch (err) {
    res.status(500).json({ message: 'Unable to create project' });
  }
});

router.put('/:id', auth, async (req, res) => {
  try {
    const existing = await store.findById('projects', req.params.id);
    if (!existing) return res.status(404).json({ message: 'Not found' });
    if (!canReadProject(req.user, existing)) return res.status(404).json({ message: 'Not found' });
    const { stakeholders } = req.body || {};
    if (stakeholders !== undefined && !Array.isArray(stakeholders)) {
      return res.status(400).json({ message: 'Project stakeholders must be an array' });
    }
    if (stakeholders !== undefined && !await validateProjectStakeholders(stakeholders)) {
      return res.status(400).json({ message: 'One or more project stakeholders are missing or inactive' });
    }
    const update = {};
    if (isAdministrator(req.user)) {
      ['name', 'description', 'key', 'owner', 'members', 'status'].forEach((field) => {
        if (req.body?.[field] !== undefined) update[field] = field === 'key'
          ? String(req.body[field]).toUpperCase()
          : req.body[field];
      });
    } else if (canManageProject(req.user, existing)) {
      const requestedFields = Object.keys(req.body || {});
      if (requestedFields.some((field) => !['members', 'stakeholders'].includes(field))) {
        return res.status(403).json({ message: 'Managers may only update project membership and stakeholders' });
      }
      if (req.body.members !== undefined && !Array.isArray(req.body.members)) {
        return res.status(400).json({ message: 'Project members must be an array' });
      }
      if (req.body.members && existing.owner !== req.user._id
        && !req.body.members.map(String).includes(req.user._id)) {
        return res.status(400).json({ message: 'Managers cannot remove their own project access' });
      }
      if (req.body.members !== undefined) update.members = req.body.members;
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
    if (stakeholders !== undefined) {
      await replaceProjectStakeholders(req.params.id, stakeholders, req.user._id);
    }
    res.json(await hydrateProjectWithStakeholders(project));
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
