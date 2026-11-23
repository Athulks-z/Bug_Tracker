const router = require('express').Router();
const { auth } = require('../middleware/auth');
const {
  isAdministrator,
  isSuperAdministrator,
  canReadProject,
  canManageProject
} = require('../middleware/roles');
const { store, publicRecord } = require('../services/data');

router.get('/', auth, async (req, res) => {
  try {
    const accessibleProjectIds = new Set((await store.list('projects'))
      .filter((project) => canReadProject(req.user, project))
      .map((project) => project._id));
    const templates = (await store.list('templates'))
      .filter((template) => {
        if (isAdministrator(req.user) || !template.project) return true;
        return accessibleProjectIds.has(template.project);
      })
      .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
    res.json(templates.map(publicRecord));
  } catch (err) {
    res.status(500).json({ message: 'Unable to load templates' });
  }
});

router.post('/', auth, async (req, res) => {
  try {
    const { name, type, body, fields, project } = req.body || {};
    if (!name) return res.status(400).json({ message: 'Name required' });
    if (req.user.role !== 'super_admin' && req.user.role !== 'admin' && req.user.role !== 'manager') {
      return res.status(403).json({ message: 'Only administrators and project managers can manage templates' });
    }
    if (req.user.role === 'manager') {
      const projectRecord = await store.findById('projects', project);
      if (!canManageProject(req.user, projectRecord)) {
        return res.status(403).json({ message: 'Managers must create templates within a project they manage' });
      }
    } else if (project) {
      if (!await store.findById('projects', project)) {
        return res.status(400).json({ message: 'Project not found' });
      }
    } else if (!isSuperAdministrator(req.user)) {
      return res.status(403).json({ message: 'Only a super administrator can manage global templates' });
    }
    const template = await store.insert('templates', {
      name,
      project: project || '',
      type: type || 'bug',
      body: body || '',
      fields: fields || {},
      createdBy: req.user._id
    });
    res.status(201).json(template);
  } catch (err) {
    res.status(500).json({ message: 'Unable to create template' });
  }
});

router.put('/:id', auth, async (req, res) => {
  try {
    const existing = await store.findById('templates', req.params.id);
    if (!existing) return res.status(404).json({ message: 'Not found' });
    if (req.user.role === 'manager') {
      const project = existing.project ? await store.findById('projects', existing.project) : null;
      if (!canManageProject(req.user, project)) {
        return res.status(403).json({ message: 'Only administrators or the project manager can update this template' });
      }
    } else if (!isAdministrator(req.user) || (!existing.project && !isSuperAdministrator(req.user))) {
      return res.status(403).json({ message: 'Only administrators and project managers can manage templates' });
    }
    const update = {};
    ['name', 'type', 'body', 'fields', 'project'].forEach((field) => {
      if (req.body?.[field] !== undefined) update[field] = req.body[field];
    });
    if (update.project !== undefined && req.user.role === 'manager') {
      const project = await store.findById('projects', update.project);
      if (!canManageProject(req.user, project)) {
        return res.status(403).json({ message: 'You cannot move a template to that project' });
      }
    } else if (update.project !== undefined && !update.project && !isSuperAdministrator(req.user)) {
      return res.status(403).json({ message: 'Only a super administrator can move a template to global scope' });
    } else if (update.project) {
      const project = await store.findById('projects', update.project);
      if (!project) return res.status(400).json({ message: 'Project not found' });
    }
    const template = await store.update('templates', req.params.id, update);
    if (!template) return res.status(404).json({ message: 'Not found' });
    res.json(template);
  } catch (err) {
    res.status(500).json({ message: 'Unable to update template' });
  }
});

router.delete('/:id', auth, async (req, res) => {
  try {
    const existing = await store.findById('templates', req.params.id);
    if (!existing) return res.status(404).json({ message: 'Not found' });
    if (req.user.role === 'manager') {
      const project = existing.project ? await store.findById('projects', existing.project) : null;
      if (!canManageProject(req.user, project)) {
        return res.status(403).json({ message: 'Only administrators or the project manager can delete this template' });
      }
    } else if (!isAdministrator(req.user) || (!existing.project && !isSuperAdministrator(req.user))) {
      return res.status(403).json({ message: 'Only administrators and project managers can manage templates' });
    }
    await store.remove('templates', req.params.id);
    res.json({ message: 'Deleted' });
  } catch (err) {
    res.status(500).json({ message: 'Unable to delete template' });
  }
});

module.exports = router;
