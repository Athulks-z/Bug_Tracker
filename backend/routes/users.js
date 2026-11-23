const router = require('express').Router();
const bcrypt = require('bcryptjs');
const { auth, adminOnly } = require('../middleware/auth');
const { isStrongPassword } = require('../utils/passwordPolicy');
const { store, hydrateUser } = require('../services/data');

router.get('/', auth, async (req, res) => {
  try {
    const { available, search, role } = req.query;
    const searchText = String(search || '').toLowerCase();
    const busyIds = available === 'true'
      ? new Set((await store.list('tasks'))
        .filter((task) => task.assignee && task.status !== 'Completed')
        .map((task) => task.assignee))
      : null;
    const users = (await store.list('users'))
      .filter((user) => !role || user.role === role)
      .filter((user) => !searchText || `${user.name} ${user.email}`.toLowerCase().includes(searchText))
      .filter((user) => !busyIds || !busyIds.has(user._id))
      .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
    res.json(await Promise.all(users.map(hydrateUser)));
  } catch (err) {
    res.status(500).json({ message: 'Unable to load users' });
  }
});

router.post('/', auth, adminOnly, async (req, res) => {
  try {
    const { name, email, password, role, jobTitle, domain, phone, skills, reportingManager, assignedProjects } = req.body || {};
    if (!name || !email || !password) return res.status(400).json({ message: 'All fields required' });
    if (!isStrongPassword(password)) return res.status(400).json({ message: 'Password must be at least 10 characters and include uppercase and lowercase letters and a number' });
    const normalizedEmail = String(email).trim().toLowerCase();
    if (await store.findOne('users', (user) => user.email === normalizedEmail)) {
      return res.status(400).json({ message: 'Email already exists' });
    }
    const user = await store.insert('users', {
      name: String(name).trim(),
      email: normalizedEmail,
      password: await bcrypt.hash(password, 10),
      role: role || 'member',
      jobTitle: jobTitle || '',
      domain: domain || 'Other',
      phone: phone || '',
      skills: skills || '',
      reportingManager: reportingManager || '',
      assignedProjects: assignedProjects || [],
      active: true
    });
    res.status(201).json(await hydrateUser(user));
  } catch (err) {
    if (err.code === 'DUPLICATE_EMAIL') {
      return res.status(400).json({ message: 'Email already exists' });
    }
    res.status(500).json({ message: 'Unable to create user' });
  }
});

router.put('/:id', auth, adminOnly, async (req, res) => {
  try {
    const existing = await store.findById('users', req.params.id);
    if (!existing) return res.status(404).json({ message: 'User not found' });
    const { name, email, role, active, password, jobTitle, domain, phone, skills, reportingManager, assignedProjects } = req.body || {};
    if (password && !isStrongPassword(password)) return res.status(400).json({ message: 'Password must be at least 10 characters and include uppercase and lowercase letters and a number' });
    const normalizedEmail = email === undefined ? existing.email : String(email).trim().toLowerCase();
    if (normalizedEmail !== existing.email
      && await store.findOne('users', (user) => user.email === normalizedEmail && user._id !== existing._id)) {
      return res.status(400).json({ message: 'Email already exists' });
    }
    const update = {
      name: name === undefined ? existing.name : name,
      email: normalizedEmail,
      role: role === undefined ? existing.role : role,
      active: active === undefined ? existing.active : active,
      jobTitle: jobTitle === undefined ? existing.jobTitle : jobTitle,
      domain: domain === undefined ? existing.domain : domain,
      phone: phone === undefined ? existing.phone : phone,
      skills: skills === undefined ? existing.skills : skills,
      reportingManager: reportingManager === undefined ? existing.reportingManager : reportingManager,
      assignedProjects: assignedProjects === undefined ? existing.assignedProjects : assignedProjects
    };
    if (password) update.password = await bcrypt.hash(password, 10);
    const user = await store.update('users', req.params.id, update);
    res.json(await hydrateUser(user));
  } catch (err) {
    if (err.code === 'DUPLICATE_EMAIL') {
      return res.status(400).json({ message: 'Email already exists' });
    }
    res.status(500).json({ message: 'Unable to update user' });
  }
});

router.delete('/:id', auth, adminOnly, async (req, res) => {
  try {
    if (req.params.id === req.user._id) {
      return res.status(400).json({ message: 'Cannot delete yourself' });
    }
    await store.remove('users', req.params.id);
    res.json({ message: 'Deleted' });
  } catch (err) {
    res.status(500).json({ message: 'Unable to delete user' });
  }
});

module.exports = router;
