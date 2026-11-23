const router = require('express').Router();
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const { auth } = require('../middleware/auth');
const { isStrongPassword } = require('../utils/passwordPolicy');
const { store, publicUser, hydrateUser } = require('../services/data');

const sign = (id) => jwt.sign(
  { id },
  process.env.JWT_SECRET,
  { expiresIn: process.env.JWT_EXPIRES_IN || '12h' }
);

router.get('/config', async (req, res) => {
  try {
    const users = await store.list('users');
    res.json({
      allowSelfRegistration: users.length === 0 || process.env.ALLOW_SELF_REGISTRATION === 'true'
    });
  } catch (err) {
    res.status(500).json({ message: 'Unable to load public configuration' });
  }
});

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
    const users = await store.list('users');
    if (users.some((user) => user.email === normalizedEmail)) {
      return res.status(400).json({ message: 'Email already exists' });
    }
    const allowSelfRegistration = process.env.ALLOW_SELF_REGISTRATION === 'true';
    if (users.length > 0 && !allowSelfRegistration) {
      return res.status(403).json({ message: 'Self-registration is disabled' });
    }
    const userData = {
      name: name.trim(),
      email: normalizedEmail,
      password: await bcrypt.hash(password, 10),
      jobTitle: jobTitle || '',
      domain: domain || 'Other',
      phone: phone || '',
      skills: skills || '',
      assignedProjects: [],
      active: true
    };
    let user;
    try {
      user = await store.insert('users', {
        ...userData,
        role: users.length === 0 ? 'super_admin' : 'employee',
        ...(users.length === 0 ? { bootstrapAdmin: true } : {})
      });
    } catch (err) {
      if (err.code === 'DUPLICATE_EMAIL') {
        return res.status(400).json({ message: 'Email already exists' });
      }
      if (err.code !== 'BOOTSTRAP_ADMIN_EXISTS' || !allowSelfRegistration) {
        if (err.code === 'BOOTSTRAP_ADMIN_EXISTS') {
          return res.status(403).json({ message: 'Self-registration is disabled' });
        }
        throw err;
      }
      user = await store.insert('users', { ...userData, role: 'employee' });
    }
    res.status(201).json({ token: sign(user._id), user: publicUser(user) });
  } catch (err) {
    if (err.code === 'DUPLICATE_EMAIL') {
      return res.status(400).json({ message: 'Email already exists' });
    }
    res.status(500).json({ message: 'Unable to register' });
  }
});

router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body || {};
    if (typeof email !== 'string' || typeof password !== 'string') {
      return res.status(400).json({ message: 'Email and password are required' });
    }
    const user = await store.findOne('users', (item) => item.email === email.trim().toLowerCase());
    if (!user || !await bcrypt.compare(password, user.password)) {
      return res.status(401).json({ message: 'Invalid credentials' });
    }
    if (!user.active) return res.status(403).json({ message: 'Account disabled' });
    res.json({ token: sign(user._id), user: await hydrateUser(user) });
  } catch (err) {
    res.status(500).json({ message: 'Unable to sign in' });
  }
});

router.get('/me', auth, (req, res) => res.json(req.user));

router.put('/me', auth, async (req, res) => {
  try {
    const { name, email, phone, jobTitle, domain, skills, reportingManager, assignedProjects, avatar, password, currentPassword } = req.body || {};
    if (Object.prototype.hasOwnProperty.call(req.body || {}, 'role')) {
      return res.status(403).json({ message: 'Only an administrator can change a user role' });
    }
    if (reportingManager !== undefined || assignedProjects !== undefined) {
      return res.status(403).json({ message: 'Project access and reporting relationships are managed by an administrator' });
    }
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
    const currentUser = await store.findById('users', req.user._id);
    const update = {
      name: name === undefined ? currentUser.name : name.trim(),
      email: email === undefined ? currentUser.email : email.trim().toLowerCase(),
      phone: phone === undefined ? currentUser.phone : phone,
      jobTitle: jobTitle === undefined ? currentUser.jobTitle : jobTitle,
      domain: domain === undefined ? currentUser.domain : domain,
      skills: skills === undefined ? currentUser.skills : skills,
      avatar: avatar === undefined ? currentUser.avatar : avatar
    };
    if (update.email !== currentUser.email
      && await store.findOne('users', (user) => user.email === update.email && user._id !== currentUser._id)) {
      return res.status(400).json({ message: 'Email already exists' });
    }
    if (password) {
      if (!currentPassword || !await bcrypt.compare(currentPassword, currentUser.password)) {
        return res.status(400).json({ message: 'Current password is incorrect' });
      }
      if (!isStrongPassword(password)) {
        return res.status(400).json({ message: 'Password must be at least 10 characters and include uppercase and lowercase letters and a number' });
      }
      update.password = await bcrypt.hash(password, 10);
    }
    const user = await store.update('users', req.user._id, update);
    if (!user) return res.status(404).json({ message: 'User not found' });
    res.json(await hydrateUser(user));
  } catch (err) {
    if (err.code === 'DUPLICATE_EMAIL') {
      return res.status(400).json({ message: 'Email already exists' });
    }
    res.status(500).json({ message: 'Unable to update profile' });
  }
});

module.exports = router;
