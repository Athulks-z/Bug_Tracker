const router = require('express').Router();
const { auth } = require('../middleware/auth');
const { store, publicRecord } = require('../services/data');

router.get('/', auth, async (req, res) => {
  try {
    const releases = (await store.list('releases'))
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
    const update = {};
    ['name', 'project', 'version', 'description', 'releaseDate', 'status']
      .forEach((field) => { if (req.body?.[field] !== undefined) update[field] = req.body[field]; });
    const release = await store.update('releases', req.params.id, update);
    if (!release) return res.status(404).json({ message: 'Not found' });
    res.json(release);
  } catch (err) {
    res.status(500).json({ message: 'Unable to update release' });
  }
});

router.delete('/:id', auth, async (req, res) => {
  try {
    await store.remove('releases', req.params.id);
    res.json({ message: 'Deleted' });
  } catch (err) {
    res.status(500).json({ message: 'Unable to delete release' });
  }
});

module.exports = router;
