const router = require('express').Router();
const User = require('../models/User');
const Task = require('../models/Task');
const { auth, adminOnly } = require('../middleware/auth');

// GET /api/users — all users (auth required)
router.get('/', auth, async (req, res) => {
  try {
    const { available, search, role } = req.query;
    const q = {};
    if (search) {
      q.$or = [
        { name: { $regex: search, $options: 'i' } },
        { email: { $regex: search, $options: 'i' } }
      ];
    }
    if (role) q.role = role;
    if (available === 'true') {
      const busyTasks = await Task.find({ assignee: { $ne: null }, status: { $ne: 'Completed' } }).select('assignee');
      const busyIds = busyTasks.map(t => t.assignee.toString());
      q._id = { $nin: busyIds };
    }

    const users = await User.find(q)
      .select('-password')
      .populate('reportingManager', 'name email')
      .populate('assignedProjects', 'name key')
      .sort({ createdAt: -1 });
    res.json(users);
  } catch (err) { res.status(500).json({ message: err.message }); }
});

// POST /api/users — admin creates user
router.post('/', auth, adminOnly, async (req, res) => {
  try {
    const { name, email, password, role, jobTitle, domain, phone, skills, reportingManager, assignedProjects } = req.body;
    if (!name || !email || !password) return res.status(400).json({ message: 'All fields required' });
    if (await User.findOne({ email })) return res.status(400).json({ message: 'Email already exists' });
    const user = await User.create({
      name,
      email,
      password,
      role: role || 'member',
      jobTitle: jobTitle || '',
      domain: domain || 'Other',
      phone: phone || '',
      skills: skills || '',
      reportingManager: reportingManager || undefined,
      assignedProjects: assignedProjects || []
    });
    const populated = await User.findById(user._id)
      .select('-password')
      .populate('reportingManager', 'name email')
      .populate('assignedProjects', 'name key');
    res.status(201).json(populated);
  } catch (err) { res.status(500).json({ message: err.message }); }
});

// PUT /api/users/:id — admin updates user
router.put('/:id', auth, adminOnly, async (req, res) => {
  try {
    const { name, email, role, active, password, jobTitle, domain, phone, skills, reportingManager, assignedProjects } = req.body;
    const update = { name, email, role, active, jobTitle, domain, phone, skills, reportingManager, assignedProjects };
    if (password) {
      const bcrypt = require('bcryptjs');
      update.password = await bcrypt.hash(password, 10);
    }
    const user = await User.findByIdAndUpdate(req.params.id, update, { new: true })
      .select('-password')
      .populate('reportingManager', 'name email')
      .populate('assignedProjects', 'name key');
    if (!user) return res.status(404).json({ message: 'User not found' });
    res.json(user);
  } catch (err) { res.status(500).json({ message: err.message }); }
});

// DELETE /api/users/:id — admin deletes user
router.delete('/:id', auth, adminOnly, async (req, res) => {
  try {
    if (req.params.id === req.user._id.toString())
      return res.status(400).json({ message: 'Cannot delete yourself' });
    await User.findByIdAndDelete(req.params.id);
    res.json({ message: 'Deleted' });
  } catch (err) { res.status(500).json({ message: err.message }); }
});

module.exports = router;
