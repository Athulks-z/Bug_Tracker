const mongoose = require('mongoose');

const commentSchema = new mongoose.Schema({
  author: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  text: { type: String, required: true },
}, { timestamps: true });

const timeLogSchema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  hours: { type: Number, required: true },
  note: { type: String, default: '' },
  date: { type: Date, default: Date.now }
}, { _id: false });

const attachmentSchema = new mongoose.Schema({
  filename: String,
  path: String,
  uploadedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  createdAt: { type: Date, default: Date.now }
}, { _id: false });

const activitySchema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  action: String,
  details: String,
  createdAt: { type: Date, default: Date.now }
}, { _id: false });

const issueSchema = new mongoose.Schema({
  title: { type: String, required: true, trim: true },
  description: { type: String, default: '' },
  project: { type: mongoose.Schema.Types.ObjectId, ref: 'Project', required: true },
  reporter: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  assignee: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  status: {
    type: String,
    enum: ['Open','Triaged','Assigned','In Progress','Code Review','QA Testing','Resolved','Closed','Reopened'],
    default: 'Open'
  },
  severity: {
    type: String,
    enum: ['Showstopper','Critical','Major','Medium','Low','None'],
    default: 'Medium'
  },
  dueDate: { type: Date },
  issueNumber: { type: Number },
  foundInVersion: { type: String, default: '' },
  fixedInVersion: { type: String, default: '' },
  targetRelease: { type: String, default: '' },
  sprint: { type: String, default: '' },
  estimatedHours: { type: Number, default: 0 },
  timeLogs: [timeLogSchema],
  attachments: [attachmentSchema],
  comments: [commentSchema],
  activity: [activitySchema],
  reopenedCount: { type: Number, default: 0 },
  resolvedAt: { type: Date },
}, { timestamps: true });

issueSchema.pre('save', async function(next) {
  if (this.isNew) {
    const count = await this.constructor.countDocuments({ project: this.project });
    this.issueNumber = count + 1;
  }
  next();
});

module.exports = mongoose.model('Issue', issueSchema);
