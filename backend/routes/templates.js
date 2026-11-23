const router = require('express').Router();
const { auth } = require('../middleware/auth');
const { store, publicRecord } = require('../services/data');

router.get('/', auth, async (req, res) => {
  try {
    const templates = (await store.list('templates'))
      .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
    res.json(templates.map(publicRecord));
  } catch (err) {
    res.status(500).json({ message: 'Unable to load templates' });
  }
});

router.post('/', auth, async (req, res) => {
  try {
    const { name, type, body, fields } = req.body || {};
    if (!name) return res.status(400).json({ message: 'Name required' });
    const template = await store.insert('templates', {
      name,
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
    const update = {};
    ['name', 'type', 'body', 'fields'].forEach((field) => {
      if (req.body?.[field] !== undefined) update[field] = req.body[field];
    });
    const template = await store.update('templates', req.params.id, update);
    if (!template) return res.status(404).json({ message: 'Not found' });
    res.json(template);
  } catch (err) {
    res.status(500).json({ message: 'Unable to update template' });
  }
});

router.delete('/:id', auth, async (req, res) => {
  try {
    await store.remove('templates', req.params.id);
    res.json({ message: 'Deleted' });
  } catch (err) {
    res.status(500).json({ message: 'Unable to delete template' });
  }
});

module.exports = router;
