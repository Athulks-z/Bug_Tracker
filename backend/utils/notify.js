const { notify } = require('../services/notificationService');

async function sendNotification({ type, issue, user, details, actorUserId }) {
  return notify({
    userId: user,
    actorUserId,
    type,
    title: String(type || 'Notification').replace(/_/g, ' '),
    message: details || '',
    link: issue ? `/tasks/${issue}` : null,
    entityType: issue ? 'task' : null,
    entityId: issue || null
  });
}

module.exports = { sendNotification };
