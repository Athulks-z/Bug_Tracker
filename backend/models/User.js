const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const userSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true },
  email: { type: String, required: true, unique: true, lowercase: true },
  password: { type: String, required: true, minlength: 6 },
  role: { type: String, enum: ['admin', 'member'], default: 'member' },
  jobTitle: { type: String, default: '' },
  domain: { type: String, enum: ['Firmware', 'Hardware', 'Project Manager', 'Tester', 'Other'], default: 'Other' },
  phone: { type: String, default: '' },
  skills: { type: String, default: '' },
  reportingManager: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  assignedProjects: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Project' }],
  avatar: { type: String, default: '' },
  active: { type: Boolean, default: true },
}, { timestamps: true });

userSchema.pre('save', async function(next) {
  if (!this.isModified('password')) return next();
  this.password = await bcrypt.hash(this.password, 10);
  next();
});

userSchema.methods.comparePassword = function(password) {
  return bcrypt.compare(password, this.password);
};

userSchema.methods.toJSON = function() {
  const obj = this.toObject();
  delete obj.password;
  return obj;
};

module.exports = mongoose.model('User', userSchema);
