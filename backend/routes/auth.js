const router = require('express').Router();
const jwt = require('jsonwebtoken');
const User = require('../models/User');
const { auth } = require('../middleware/auth');
const { isStrongPassword } = require('../utils/passwordPolicy');

const sign = (id) => jwt.sign(
  { id },
  process.env.JWT_SECRET,
  { expiresIn: process.env.JWT_EXPIRES_IN || '12h' }
);

router.get('/config', async (req, res) => {
  try {
    const hasUsers = await User.exists({});
    res.json({
      allowSelfRegistration: !hasUsers || process.env.ALLOW_SELF_REGISTRATION === 'true'
    });
  } catch {
    res.status(500).json({ message: 'Unable to load public configuration' });
  }
});

// POST /api/auth/register (first user becomes admin)
router.post('/register', async (req, res) => {
  try {
    const { name, email, password, jobTitle, domain, phone, skills } = req.body || {};
    if (typeof name !== 'string' || typeof email !== 'string' || typeof password !== 'string'
      || !name.trim() || !email.trim() || !password) {
      return res.status(400).json({ message: 'Name, email, and password are required' });
    }
    if ([jobTitle, domain, phone, skills].some((value) => value !== undefined && typeof value !== 'string')) {
      return res.status(400).json({ message: 'Optional profile fields must be strings' });
    }
    if (name.trim().length > 120 || email.trim().length > 254
      || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      return res.status(400).json({ message: 'Enter a valid name and email address' });
    }
    if (!isStrongPassword(password)) {
      return res.status(400).json({ message: 'Password must be at least 10 characters and include uppercase and lowercase letters and a number' });
    }
    const normalizedEmail = email.trim().toLowerCase();
    if (await User.findOne({ email: normalizedEmail })) return res.status(400).json({ message: 'Email already exists' });
    const count = await User.countDocuments();
    const allowSelfRegistration = process.env.ALLOW_SELF_REGISTRATION === 'true';
    if (count > 0 && !allowSelfRegistration) {
      return res.status(403).json({ message: 'Self-registration is disabled' });
    }

    const userData = {
      name: name.trim(),
      email: normalizedEmail,
      jobTitle: jobTitle || '',
      domain: domain || 'Other',
      phone: phone || '',
      skills: skills || ''
    };
    let user;
    try {
      user = await User.create({
        ...userData,
        password,
        role: count === 0 ? 'admin' : 'member',
        ...(count === 0 ? { bootstrapAdmin: true } : {})
      });
    } catch (err) {
      const duplicateBootstrapAdmin = err.code === 11000
        && (err.keyPattern?.bootstrapAdmin || err.message.includes('bootstrapAdmin_1'));
      if (!duplicateBootstrapAdmin) throw err;
      if (!allowSelfRegistration) {
        return res.status(403).json({ message: 'Self-registration is disabled' });
      }
      user = await User.create({ ...userData, password, role: 'member' });
    }
    res.status(201).json({ token: sign(user._id), user });
  } catch (err) {
    if (err.name === 'ValidationError') {
      return res.status(400).json({ message: err.message });
    }
    res.status(500).json({ message: 'Unable to register' });
  }
});

// POST /api/auth/login
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body || {};
    if (typeof email !== 'string' || typeof password !== 'string') {
      return res.status(400).json({ message: 'Email and password are required' });
    }
    const user = await User.findOne({ email: email.trim().toLowerCase() });
    if (!user || !await user.comparePassword(password))
      return res.status(401).json({ message: 'Invalid credentials' });
    if (!user.active) return res.status(403).json({ message: 'Account disabled' });
    res.json({ token: sign(user._id), user });
  } catch (err) {
    res.status(500).json({ message: 'Unable to sign in' });
  }
});

// GET /api/auth/me
router.get('/me', auth, (req, res) => res.json(req.user));

// PUT /api/auth/me
router.put('/me', auth, async (req, res) => {
  try {
    const { name, email, phone, jobTitle, domain, skills, reportingManager, assignedProjects, avatar, password, currentPassword } = req.body || {};
    if (name !== undefined && (typeof name !== 'string' || !name.trim() || name.trim().length > 120)) {
      return res.status(400).json({ message: 'Name must be between 1 and 120 characters' });
    }
    if (email !== undefined && (typeof email !== 'string' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim()))) {
      return res.status(400).json({ message: 'Enter a valid email address' });
    }
    if ([phone, jobTitle, domain, skills, avatar].some((value) => value !== undefined && typeof value !== 'string')) {
      return res.status(400).json({ message: 'Profile fields must be strings' });
    }
    if (assignedProjects !== undefined && !Array.isArray(assignedProjects)) {
      return res.status(400).json({ message: 'Assigned projects must be an array' });
    }
    if ((password !== undefined && typeof password !== 'string')
      || (currentPassword !== undefined && typeof currentPassword !== 'string')) {
      return res.status(400).json({ message: 'Password fields must be strings' });
    }
    const update = {
      name,
      email: email?.trim().toLowerCase(),
      phone,
      jobTitle,
      domain,
      skills,
      reportingManager,
      assignedProjects,
      avatar
    };
    if (password) {
      const currentUser = await User.findById(req.user._id);
      if (!currentPassword || !currentUser || !await currentUser.comparePassword(currentPassword)) {
        return res.status(400).json({ message: 'Current password is incorrect' });
      }
      if (!isStrongPassword(password)) {
        return res.status(400).json({ message: 'Password must be at least 10 characters and include uppercase and lowercase letters and a number' });
      }
      const bcrypt = require('bcryptjs');
      update.password = await bcrypt.hash(password, 10);
    }
    const user = await User.findByIdAndUpdate(req.user._id, update, { new: true })
      .select('-password')
      .populate('reportingManager', 'name email')
      .populate('assignedProjects', 'name key');
    if (!user) return res.status(404).json({ message: 'User not found' });
    res.json(user);
  } catch (err) {
    res.status(500).json({ message: 'Unable to update profile' });
  }
});

module.exports = router;
