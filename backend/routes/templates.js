const router = require('express').Router();
const IssueTemplate = require('../models/IssueTemplate');
const { auth, adminOnly } = require('../middleware/auth');

router.get('/', auth, async (req, res) => {
  try {
    const templates = await IssueTemplate.find().sort({ createdAt: -1 });
    res.json(templates);
  } catch (err) { res.status(500).json({ message: err.message }); }
});

router.post('/', auth, async (req, res) => {
  try {
    const { name, type, body, fields } = req.body;
    if (!name) return res.status(400).json({ message: 'Name required' });
    const t = await IssueTemplate.create({ name, type, body, fields, createdBy: req.user._id });
    res.status(201).json(t);
  } catch (err) { res.status(500).json({ message: err.message }); }
});

router.put('/:id', auth, async (req, res) => {
  try {
    const t = await IssueTemplate.findByIdAndUpdate(req.params.id, req.body, { new: true });
    if (!t) return res.status(404).json({ message: 'Not found' });
    res.json(t);
  } catch (err) { res.status(500).json({ message: err.message }); }
});

router.delete('/:id', auth, async (req, res) => {
  try {
    await IssueTemplate.findByIdAndDelete(req.params.id);
    res.json({ message: 'Deleted' });
  } catch (err) { res.status(500).json({ message: err.message }); }
});

module.exports = router;
