const router = require('express').Router();
const { auth } = require('../middleware/auth');
const pool = require('../config/db');
const { buildTaskVisibilityFilter } = require('../middleware/taskVisibility');

router.get('/', auth, async (req, res) => {
  try {
    const visibility = buildTaskVisibilityFilter(req.user, 'w', 2);
    const { rows } = await pool.query(
      `SELECT n.id AS "_id",n.recipient_user_id AS "user",n.type,
        nr.work_item_id AS issue,COALESCE(n.details,'') AS details,
        (n.read_at IS NOT NULL) AS read,n.created_at AS "createdAt"
       FROM public.notifications n
       LEFT JOIN public.notification_resources nr ON nr.notification_id=n.id
       WHERE n.recipient_user_id=$1
         AND (nr.work_item_id IS NULL OR EXISTS (
           SELECT 1
           FROM public.work_items w
           JOIN public.tasks t ON t.work_item_id=w.id
           WHERE w.id=nr.work_item_id AND ${visibility.clause}
         ))
       ORDER BY n.created_at DESC,n.id LIMIT 100`,
      [req.user._id, ...visibility.values]
    );
    res.json(rows);
  } catch (err) {
    console.error('Unable to query visible notifications:', err.message);
    res.status(500).json({ message: 'Unable to load notifications' });
  }
});

router.put('/:id/read', auth, async (req, res) => {
  try {
    const visibility = buildTaskVisibilityFilter(req.user, 'w', 3);
    const { rows } = await pool.query(
      `UPDATE public.notifications n
       SET read_at=COALESCE(n.read_at,now())
       WHERE n.id=$1 AND n.recipient_user_id=$2
         AND (
           NOT EXISTS (
             SELECT 1 FROM public.notification_resources nr0
             WHERE nr0.notification_id=n.id AND nr0.work_item_id IS NOT NULL
           )
           OR EXISTS (
             SELECT 1
             FROM public.notification_resources nr
             JOIN public.work_items w ON w.id=nr.work_item_id
             JOIN public.tasks t ON t.work_item_id=w.id
             WHERE nr.notification_id=n.id AND ${visibility.clause}
           )
         )
       RETURNING n.id AS "_id",n.recipient_user_id AS "user",n.type,
         n.details,(n.read_at IS NOT NULL) AS read,n.created_at AS "createdAt"`,
      [req.params.id, req.user._id, ...visibility.values]
    );
    if (!rows.length) return res.status(404).json({ message: 'Notification not found' });
    res.json(rows[0]);
  } catch (err) {
    console.error('Unable to update notification visibility/read state:', err.message);
    res.status(500).json({ message: 'Unable to mark notification as read' });
  }
});

module.exports = router;
