const mongoose = require('mongoose');

const templateSchema = new mongoose.Schema({
  name: { type: String, required: true },
  type: { type: String, enum: ['bug','feature','task'], default: 'bug' },
  body: { type: String, default: '' },
  fields: { type: Object, default: {} },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' }
}, { timestamps: true });

module.exports = mongoose.model('IssueTemplate', templateSchema);
