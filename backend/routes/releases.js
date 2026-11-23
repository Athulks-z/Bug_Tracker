const router = require('express').Router();
const { auth } = require('../middleware/auth');
const { canReadProject, canManageProject } = require('../middleware/roles');
const { store, publicRecord } = require('../services/data');

router.get('/', auth, async (req, res) => {
  try {
    const accessibleProjectIds = new Set((await store.list('projects'))
      .filter((project) => canReadProject(req.user, project))
      .map((project) => project._id));
    const releases = (await store.list('releases'))
      .filter((release) => accessibleProjectIds.has(release.project))
      .filter((release) => !req.query.project || release.project === req.query.project)
      .sort((a, b) => String(b.releaseDate || '').localeCompare(String(a.releaseDate || '')));
    res.json(releases.map(publicRecord));
  } catch (err) {
    res.status(500).json({ message: 'Unable to load releases' });
  }
});

router.post('/', auth, async (req, res) => {
  try {
    const { name, project, version, description, releaseDate, status } = req.body || {};
    const projectRecord = await store.findById('projects', project);
    if (!canManageProject(req.user, projectRecord)) {
      return res.status(403).json({ message: 'Only administrators and project managers can manage releases' });
    }
    const release = await store.insert('releases', {
      name: name || '',
      project: project || '',
      version: version || '',
      description: description || '',
      releaseDate: releaseDate || '',
      status: status || 'Planned'
    });
    res.status(201).json(release);
  } catch (err) {
    res.status(500).json({ message: 'Unable to create release' });
  }
});

router.put('/:id', auth, async (req, res) => {
  try {
    const existing = (await store.list('releases')).find((release) => release._id === req.params.id);
    if (!existing) return res.status(404).json({ message: 'Not found' });
    const currentProject = await store.findById('projects', existing.project);
    if (!canManageProject(req.user, currentProject)) {
      return res.status(403).json({ message: 'Only administrators and project managers can manage releases' });
    }
    const update = {};
    ['name', 'project', 'version', 'description', 'releaseDate', 'status']
      .forEach((field) => { if (req.body?.[field] !== undefined) update[field] = req.body[field]; });
    if (update.project !== undefined) {
      const targetProject = await store.findById('projects', update.project);
      if (!canManageProject(req.user, targetProject)) {
        return res.status(403).json({ message: 'You cannot move a release to that project' });
      }
    }
    const release = await store.update('releases', req.params.id, update);
    if (!release) return res.status(404).json({ message: 'Not found' });
    res.json(release);
  } catch (err) {
    res.status(500).json({ message: 'Unable to update release' });
  }
});

router.delete('/:id', auth, async (req, res) => {
  try {
    const existing = (await store.list('releases')).find((release) => release._id === req.params.id);
    if (!existing) return res.status(404).json({ message: 'Not found' });
    const project = await store.findById('projects', existing.project);
    if (!canManageProject(req.user, project)) {
      return res.status(403).json({ message: 'Only administrators and project managers can manage releases' });
    }
    await store.remove('releases', req.params.id);
    res.json({ message: 'Deleted' });
  } catch (err) {
    res.status(500).json({ message: 'Unable to delete release' });
  }
});

module.exports = router;
