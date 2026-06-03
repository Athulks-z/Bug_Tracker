const mongoose = require('mongoose');

const ReleaseSchema = new mongoose.Schema({
  name: String,
  project: { type: mongoose.Schema.Types.ObjectId, ref: 'Project' },
  version: String,
  description: String,
  releaseDate: Date,
  status: { type: String, enum: ['Planned','Released','Deprecated'], default: 'Planned' }
}, { timestamps: true });

module.exports = mongoose.model('Release', ReleaseSchema);
