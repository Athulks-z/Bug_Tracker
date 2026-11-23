const { store } = require('../services/data');

async function sendNotification({ type, issue, user, details }) {
  return store.insert('notifications', {
    type,
    issue,
    user,
    details,
    read: false
  });
}

module.exports = { sendNotification };
