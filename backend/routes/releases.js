const router = require('express').Router();
const Release = require('../models/Release');
const { auth } = require('../middleware/auth');

router.get('/', auth, async (req, res) => {
  try {
    const { project } = req.query;
    const q = {};
    if (project) q.project = project;
    const items = await Release.find(q).sort({ releaseDate: -1 });
    res.json(items);
  } catch (err) { res.status(500).json({ message: err.message }); }
});

router.post('/', auth, async (req, res) => {
  try {
    const r = new Release(req.body);
    await r.save();
    res.status(201).json(r);
  } catch (err) { res.status(500).json({ message: err.message }); }
});

router.put('/:id', auth, async (req, res) => {
  try {
    const r = await Release.findByIdAndUpdate(req.params.id, req.body, { new: true });
    res.json(r);
  } catch (err) { res.status(500).json({ message: err.message }); }
});

router.delete('/:id', auth, async (req, res) => {
  try {
    await Release.findByIdAndDelete(req.params.id);
    res.json({ message: 'Deleted' });
  } catch (err) { res.status(500).json({ message: err.message }); }
});

module.exports = router;
