const mongoose = require('mongoose');

const NotificationSchema = new mongoose.Schema({
  type: String,
  issue: { type: mongoose.Schema.Types.ObjectId, ref: 'Issue' },
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  details: String,
  read: { type: Boolean, default: false }
}, { timestamps: true });

module.exports = mongoose.model('Notification', NotificationSchema);
