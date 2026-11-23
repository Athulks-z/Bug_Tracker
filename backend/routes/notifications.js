const router = require('express').Router();
const { auth } = require('../middleware/auth');
const { store, publicRecord } = require('../services/data');

router.get('/', auth, async (req, res) => {
  try {
    const notifications = (await store.list('notifications'))
      .filter((notification) => notification.user === req.user._id)
      .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))
      .slice(0, 100);
    res.json(notifications.map(publicRecord));
  } catch (err) {
    res.status(500).json({ message: 'Unable to load notifications' });
  }
});

router.put('/:id/read', auth, async (req, res) => {
  try {
    const notification = await store.findById('notifications', req.params.id);
    if (!notification || notification.user !== req.user._id) {
      return res.status(404).json({ message: 'Notification not found' });
    }
    res.json(await store.update('notifications', req.params.id, { read: true }));
  } catch (err) {
    res.status(500).json({ message: 'Unable to mark notification as read' });
  }
});

module.exports = router;
