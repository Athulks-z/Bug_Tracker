// Lightweight notification stub — extend with email / websocket later
const Notification = require('../models/Notification');

async function sendNotification({ type, issue, user, details }) {
  try {
    // store in notifications collection for in-app consumption
    if (Notification) {
      await Notification.create({ type, issue, user, details, read: false });
    }
  } catch (err) {
    // ignore storage errors for now
  }
  // placeholder for email/websocket integrations
  console.log('Notify:', { type, issue, user, details });
}

module.exports = { sendNotification };
