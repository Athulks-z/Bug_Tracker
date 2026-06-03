const mongoose = require('mongoose');

const SprintSchema = new mongoose.Schema({
  name: String,
  project: { type: mongoose.Schema.Types.ObjectId, ref: 'Project' },
  startDate: Date,
  endDate: Date,
  goal: String,
  status: { type: String, enum: ['Planned','Active','Closed'], default: 'Planned' }
}, { timestamps: true });

module.exports = mongoose.model('Sprint', SprintSchema);
