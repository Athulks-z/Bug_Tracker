const router = require('express').Router();
const Notification = require('../models/Notification');
const { auth } = require('../middleware/auth');

router.get('/', auth, async (req, res) => {
  try {
    const notes = await Notification.find({ user: req.user._id }).sort({ createdAt: -1 }).limit(100);
    res.json(notes);
  } catch (err) { res.status(500).json({ message: err.message }); }
});

router.put('/:id/read', auth, async (req, res) => {
  try {
    const n = await Notification.findByIdAndUpdate(req.params.id, { read: true }, { new: true });
    res.json(n);
  } catch (err) { res.status(500).json({ message: err.message }); }
});

module.exports = router;
