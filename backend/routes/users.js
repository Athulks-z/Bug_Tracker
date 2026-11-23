const router = require('express').Router();
const bcrypt = require('bcryptjs');
const { auth, adminOnly } = require('../middleware/auth');
const {
  ROLE_CODES,
  isAdministrator,
  isSuperAdministrator,
  isManager,
  canManageProject,
  projectIds
} = require('../middleware/roles');
const { isStrongPassword } = require('../utils/passwordPolicy');
const { store, hydrateUser } = require('../services/data');

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

router.get('/', auth, async (req, res) => {
  try {
    const { available, search, role } = req.query;
    const searchText = String(search || '').toLowerCase();
    if (available === 'true' && req.query.assignable === 'true' && isManager(req.user)) {
      const project = await store.findById('projects', String(req.query.project || ''));
      if (!canManageProject(req.user, project)) {
        return res.status(403).json({ message: 'You cannot manage members of this project' });
      }
      const members = await store.list('users');
      return res.json(members.filter((user) => user.active).map(({ _id, name, role, active }) => ({
        _id, name, role, active
      })));
    }
    const visibleProjectIds = projectIds(req.user);
    if (!isAdministrator(req.user)) {
      for (const project of await store.list('projects')) {
        if (project.owner === req.user._id || (project.members || []).includes(req.user._id)) {
          visibleProjectIds.add(project._id);
        }
      }
    }
    const busyIds = available === 'true'
      ? new Set((await store.list('tasks'))
        .filter((task) => task.assignee && task.status !== 'Completed')
        .map((task) => task.assignee))
      : null;
    const users = (await store.list('users'))
      .filter((user) => isAdministrator(req.user)
        || user._id === req.user._id
        || (user.assignedProjects || []).some((id) => visibleProjectIds.has(String(id))))
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
    if (typeof email !== 'string' || !EMAIL_PATTERN.test(email.trim())) {
      return res.status(400).json({ message: 'Enter a valid email address' });
    }
    if (!isStrongPassword(password)) return res.status(400).json({ message: 'Password must be at least 10 characters and include uppercase and lowercase letters and a number' });
    const assignedRole = role || 'employee';
    if (!ROLE_CODES.includes(assignedRole)) {
      return res.status(400).json({ message: 'Invalid role' });
    }
    if (!isSuperAdministrator(req.user) && assignedRole === 'super_admin') {
      return res.status(403).json({ message: 'Only a super administrator can assign the super administrator role' });
    }
    if (assignedProjects !== undefined && !Array.isArray(assignedProjects)) {
      return res.status(400).json({ message: 'Assigned projects must be an array' });
    }
    if (reportingManager && !(await store.findById('users', reportingManager))) {
      return res.status(400).json({ message: 'Reporting manager not found' });
    }
    if (assignedProjects?.length) {
      const knownProjects = new Set((await store.list('projects')).map((project) => project._id));
      if (assignedProjects.some((id) => !knownProjects.has(String(id)))) {
        return res.status(400).json({ message: 'One or more assigned projects do not exist' });
      }
    }
    const normalizedEmail = String(email).trim().toLowerCase();
    if (await store.findOne('users', (user) => user.email === normalizedEmail)) {
      return res.status(400).json({ message: 'Email already exists' });
    }
    const user = await store.insert('users', {
      name: String(name).trim(),
      email: normalizedEmail,
      password: await bcrypt.hash(password, 10),
      role: assignedRole,
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
    if (!isSuperAdministrator(req.user) && existing.role === 'super_admin') {
      return res.status(403).json({ message: 'Only a super administrator can manage a super administrator account' });
    }
    const { name, email, role, active, password, jobTitle, domain, phone, skills, reportingManager, assignedProjects } = req.body || {};
    if (email !== undefined && (typeof email !== 'string' || !EMAIL_PATTERN.test(email.trim()))) {
      return res.status(400).json({ message: 'Enter a valid email address' });
    }
    if (role !== undefined && !ROLE_CODES.includes(role)) {
      return res.status(400).json({ message: 'Invalid role' });
    }
    if (!isSuperAdministrator(req.user) && role === 'super_admin') {
      return res.status(403).json({ message: 'Only a super administrator can assign the super administrator role' });
    }
    if (assignedProjects !== undefined && !Array.isArray(assignedProjects)) {
      return res.status(400).json({ message: 'Assigned projects must be an array' });
    }
    if (reportingManager && !(await store.findById('users', reportingManager))) {
      return res.status(400).json({ message: 'Reporting manager not found' });
    }
    if (assignedProjects?.length) {
      const knownProjects = new Set((await store.list('projects')).map((project) => project._id));
      if (assignedProjects.some((id) => !knownProjects.has(String(id)))) {
        return res.status(400).json({ message: 'One or more assigned projects do not exist' });
      }
    }
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
    if (existing.role === 'super_admin'
      && (update.role !== 'super_admin' || update.active === false)) {
      const activeSuperAdmins = (await store.list('users'))
        .filter((user) => user.role === 'super_admin' && user.active);
      if (activeSuperAdmins.length <= 1) {
        return res.status(400).json({ message: 'At least one active super administrator must remain' });
      }
    }
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
    const existing = await store.findById('users', req.params.id);
    if (existing?.role === 'super_admin') {
      if (!isSuperAdministrator(req.user)) {
        return res.status(403).json({ message: 'Only a super administrator can delete a super administrator account' });
      }
      const activeSuperAdmins = (await store.list('users'))
        .filter((user) => user.role === 'super_admin' && user.active);
      if (existing.active && activeSuperAdmins.length <= 1) {
        return res.status(400).json({ message: 'At least one active super administrator must remain' });
      }
    }
    await store.remove('users', req.params.id);
    res.json({ message: 'Deleted' });
  } catch (err) {
    res.status(500).json({ message: 'Unable to delete user' });
  }
});

module.exports = router;
