const mongoose = require('mongoose');

const commentSchema = new mongoose.Schema({
  author: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  text: { type: String, required: true },
}, { timestamps: true });

const issueSchema = new mongoose.Schema({
  title: { type: String, required: true, trim: true },
  description: { type: String, default: '' },
  project: { type: mongoose.Schema.Types.ObjectId, ref: 'Project', required: true },
  reporter: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  assignee: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  status: {
    type: String,
    enum: ['Open', 'To do', 'In progress', 'Reopen', 'Closed'],
    default: 'Open'
  },
  severity: {
    type: String,
    enum: ['Showstopper', 'Major', 'Medium', 'Low', 'None'],
    default: 'Medium'
  },
  issueNumber: { type: Number },
  comments: [commentSchema],
}, { timestamps: true });

issueSchema.pre('save', async function(next) {
  if (this.isNew) {
    const count = await this.constructor.countDocuments({ project: this.project });
    this.issueNumber = count + 1;
  }
  next();
});

module.exports = mongoose.model('Issue', issueSchema);
