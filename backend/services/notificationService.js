const { randomUUID } = require('crypto');
const pool = require('../config/db');
const { getSettings } = require('./settingsService');

const STORAGE_ALERT_INTERVAL_MS = 60 * 60 * 1000;
const STORAGE_ALERT_ROLES = ['admin', 'super_admin'];

async function insertNotification(client, notification) {
  const {
    userId, actorUserId, type, title, message, link, entityType, entityId,
    projectId, idempotencyKey
  } = notification;
  if (!userId || String(userId) === String(actorUserId || '')) return false;

  const id = randomUUID().replace(/-/g, '');
  const snapshot = JSON.stringify({ title, message, link, entityType, entityId });
  const { rows } = await client.query(
    `INSERT INTO public.notifications
     (id,recipient_user_id,actor_user_id,type,details,title,message,link,
      entity_type,entity_id,resource_snapshot,idempotency_key)
     VALUES ($1,$2,NULLIF($3,''),$4,$5,$6,$7,$8,$9,$10,$11::jsonb,$12)
     ON CONFLICT (idempotency_key) DO NOTHING
     RETURNING id`,
    [
      id, String(userId), String(actorUserId || ''), type, message, title, message, link || null,
      entityType || null, entityId ? String(entityId) : null, snapshot, idempotencyKey || null
    ]
  );
  if (!rows.length) return false;

  if (entityType === 'task' && entityId && projectId) {
    await client.query(
      `INSERT INTO public.notification_resources
       (notification_id,project_scope_id,work_item_id)
       VALUES ($1,$2,$3)`,
      [rows[0].id, String(projectId), String(entityId)]
    );
  } else if (entityType === 'project' && entityId) {
    await client.query(
      `INSERT INTO public.notification_resources
       (notification_id,project_scope_id,target_project_id)
       VALUES ($1,$2,$2)`,
      [rows[0].id, String(entityId)]
    );
  }
  return true;
}

async function notifyRecipients({
  recipients, actorUserId, type, title, message, link, entityType, entityId,
  projectId, idempotencyKey, client: transactionClient
}) {
  let client = transactionClient || null;
  const ownsClient = !transactionClient;
  let savepoint = false;
  try {
    if (!(await getSettings()).inAppNotificationsEnabled) return 0;
    if (!client) client = await pool.connect();
    if (ownsClient) await client.query('BEGIN');
    else {
      await client.query('SAVEPOINT notification_delivery');
      savepoint = true;
    }

    const seen = new Set();
    let created = 0;
    for (const recipient of recipients || []) {
      const userId = String(typeof recipient === 'object' ? recipient.userId || recipient.id || '' : recipient || '');
      if (!userId || seen.has(userId) || userId === String(actorUserId || '')) continue;
      seen.add(userId);
      if (await insertNotification(client, {
        userId, actorUserId, type, title, message, link, entityType, entityId, projectId,
        idempotencyKey: idempotencyKey ? `${idempotencyKey}:${userId}` : null
      })) created += 1;
    }
    if (ownsClient) await client.query('COMMIT');
    else if (savepoint) await client.query('RELEASE SAVEPOINT notification_delivery');
    return created;
  } catch (error) {
    if (ownsClient) {
      try { await client.query('ROLLBACK'); } catch (rollbackError) {
        console.error('Unable to roll back notification delivery:', rollbackError.name);
      }
    } else if (savepoint) {
      try {
        await client.query('ROLLBACK TO SAVEPOINT notification_delivery');
        await client.query('RELEASE SAVEPOINT notification_delivery');
      } catch (rollbackError) {
        console.error('Unable to roll back notification savepoint:', rollbackError.name);
      }
    }
    console.error('In-app notification delivery failed:', error.name);
    return 0;
  } finally {
    if (ownsClient && client) client.release();
  }
}

async function notify(notification) {
  const { userId, ...details } = notification;
  return notifyRecipients({ ...details, recipients: [userId] });
}

async function notifyTaskStakeholders({
  taskId, actorUserId, type, title, message, idempotencyKey
}) {
  try {
    const { rows } = await pool.query(
      `SELECT w.id,w.project_id,w.reporter_user_id,w.assignee_user_id,
              p.owner_user_id
       FROM public.work_items w
       JOIN public.projects p ON p.id=w.project_id
       WHERE w.id=$1 AND w.kind='task'`,
      [String(taskId)]
    );
    if (!rows.length) return 0;
    const task = rows[0];
    const stakeholders = await pool.query(
      'SELECT user_id FROM public.project_stakeholders WHERE project_id=$1',
      [task.project_id]
    );
    return notifyRecipients({
      recipients: [
        task.reporter_user_id, task.assignee_user_id, task.owner_user_id,
        ...stakeholders.rows.map((row) => row.user_id)
      ],
      actorUserId,
      type,
      title,
      message,
      link: `/tasks/${task.id}`,
      entityType: 'task',
      entityId: task.id,
      projectId: task.project_id,
      idempotencyKey
    });
  } catch (error) {
    console.error('Unable to prepare task notifications:', error.name);
    return 0;
  }
}

async function cleanupReadNotifications() {
  const result = await pool.query(
    `DELETE FROM public.notifications
     WHERE read_at IS NOT NULL AND read_at < now() - interval '30 days'`
  );
  return result.rowCount;
}

async function checkStorageThreshold(readStorageStats, now = new Date()) {
  if (typeof readStorageStats !== 'function') {
    throw new TypeError('A storage statistics provider is required');
  }
  const stats = await readStorageStats();
  if (!stats.limitBytes || stats.limitBytes <= 0
    || stats.totalUsedBytes / stats.limitBytes < 0.8) return 0;

  const { rows } = await pool.query(
    `SELECT id FROM public.users
     WHERE active AND role_code = ANY($1::text[])
     ORDER BY id`,
    [STORAGE_ALERT_ROLES]
  );
  const day = now.toISOString().slice(0, 10);
  const percentUsed = Math.floor(stats.totalUsedBytes / stats.limitBytes * 100);
  return notifyRecipients({
    recipients: rows.map((row) => row.id),
    type: 'storage_limit_warning',
    title: 'Storage usage is high',
    message: `Task Tracker storage is at ${percentUsed}% of its configured limit. Please review database and uploaded-file storage.`,
    link: '/settings',
    idempotencyKey: `storage-capacity:${day}`
  });
}

function startStorageAlertMonitor(readStorageStats) {
  const runCheck = () => checkStorageThreshold(readStorageStats).catch((error) => {
    console.error('Storage threshold check failed:', error.name);
  });
  void runCheck();
  return setInterval(runCheck, STORAGE_ALERT_INTERVAL_MS);
}

function startNotificationCleanup() {
  const runCleanup = () => cleanupReadNotifications().catch((error) => {
    console.error('Read notification cleanup failed:', error.name);
  });
  void runCleanup();
  return setInterval(runCleanup, 24 * 60 * 60 * 1000);
}

module.exports = {
  notify, notifyRecipients, notifyTaskStakeholders,
  cleanupReadNotifications, checkStorageThreshold,
  startStorageAlertMonitor, startNotificationCleanup
};
