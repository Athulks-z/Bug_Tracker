const router = require('express').Router();
const { auth } = require('../middleware/auth');
const pool = require('../config/db');

function notificationShape(row) {
  return {
    id: row.id,
    _id: row.id,
    type: row.type,
    title: row.title || String(row.type || 'Notification').replace(/_/g, ' '),
    message: row.message || row.details || '',
    link: row.link || null,
    entityType: row.entity_type || null,
    entityId: row.entity_id || null,
    isRead: Boolean(row.read_at),
    readAt: row.read_at,
    createdAt: row.created_at
  };
}

router.get('/unread-count', auth, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT count(*)::int AS count
       FROM public.notifications
       WHERE recipient_user_id=$1 AND read_at IS NULL`,
      [req.user._id]
    );
    res.json({ count: rows[0].count });
  } catch (error) {
    console.error('Unable to count unread notifications:', error.name);
    res.status(500).json({ message: 'Unable to load unread notification count' });
  }
});

router.get('/', auth, async (req, res) => {
  const page = Math.max(1, Number.parseInt(req.query.page, 10) || 1);
  const limit = Math.min(100, Math.max(1, Number.parseInt(req.query.limit, 10) || 20));
  const filter = req.query.filter || 'all';
  if (!['all', 'unread'].includes(filter)) {
    return res.status(400).json({ message: 'Filter must be all or unread' });
  }
  try {
    const values = [req.user._id];
    const filterClause = filter === 'unread' ? ' AND read_at IS NULL' : '';
    const offset = (page - 1) * limit;
    values.push(limit, offset);
    const [listResult, countResult] = await Promise.all([
      pool.query(
        `SELECT id,type,details,title,message,link,entity_type,entity_id,read_at,created_at
         FROM public.notifications
         WHERE recipient_user_id=$1${filterClause}
         ORDER BY created_at DESC,id DESC
         LIMIT $2 OFFSET $3`,
        values
      ),
      pool.query(
        `SELECT count(*)::int AS count
         FROM public.notifications
         WHERE recipient_user_id=$1 AND read_at IS NULL`,
        [req.user._id]
      )
    ]);
    res.json({
      items: listResult.rows.map(notificationShape),
      unreadCount: countResult.rows[0].count,
      page,
      limit
    });
  } catch (error) {
    console.error('Unable to query notifications:', error.name);
    res.status(500).json({ message: 'Unable to load notifications' });
  }
});

async function markOneRead(req, res) {
  try {
    const { rows } = await pool.query(
      `UPDATE public.notifications
       SET read_at=COALESCE(read_at,now())
       WHERE id=$1 AND recipient_user_id=$2
       RETURNING id,type,details,title,message,link,entity_type,entity_id,read_at,created_at`,
      [req.params.id, req.user._id]
    );
    if (!rows.length) {
      const exists = await pool.query('SELECT 1 FROM public.notifications WHERE id=$1', [req.params.id]);
      return res.status(exists.rowCount ? 403 : 404).json({
        message: exists.rowCount ? 'You cannot modify another user’s notification' : 'Notification not found'
      });
    }
    return res.json(notificationShape(rows[0]));
  } catch (error) {
    console.error('Unable to mark notification as read:', error.name);
    return res.status(500).json({ message: 'Unable to mark notification as read' });
  }
}

router.patch('/read-all', auth, async (req, res) => {
  try {
    const result = await pool.query(
      `UPDATE public.notifications SET read_at=now()
       WHERE recipient_user_id=$1 AND read_at IS NULL`,
      [req.user._id]
    );
    res.json({ updatedCount: result.rowCount });
  } catch (error) {
    console.error('Unable to mark all notifications as read:', error.name);
    res.status(500).json({ message: 'Unable to mark notifications as read' });
  }
});

router.patch('/:id/read', auth, markOneRead);
router.put('/:id/read', auth, markOneRead);

router.delete('/clear-read', auth, async (req, res) => {
  try {
    const result = await pool.query(
      `DELETE FROM public.notifications
       WHERE recipient_user_id=$1 AND read_at IS NOT NULL`,
      [req.user._id]
    );
    res.json({ deletedCount: result.rowCount });
  } catch (error) {
    console.error('Unable to clear read notifications:', error.name);
    res.status(500).json({ message: 'Unable to clear read notifications' });
  }
});

router.delete('/:id', auth, async (req, res) => {
  try {
    const result = await pool.query(
      `DELETE FROM public.notifications
       WHERE id=$1 AND recipient_user_id=$2
       RETURNING id`,
      [req.params.id, req.user._id]
    );
    if (!result.rowCount) {
      const exists = await pool.query('SELECT 1 FROM public.notifications WHERE id=$1', [req.params.id]);
      return res.status(exists.rowCount ? 403 : 404).json({
        message: exists.rowCount ? 'You cannot modify another user’s notification' : 'Notification not found'
      });
    }
    res.json({ deleted: true });
  } catch (error) {
    console.error('Unable to delete notification:', error.name);
    res.status(500).json({ message: 'Unable to delete notification' });
  }
});

module.exports = router;
