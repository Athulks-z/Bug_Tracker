const router = require('express').Router();
const jwt = require('jsonwebtoken');
const User = require('../models/User');
const { auth } = require('../middleware/auth');

const sign = (id) => jwt.sign({ id }, process.env.JWT_SECRET, { expiresIn: '7d' });

// POST /api/auth/register (first user becomes admin)
router.post('/register', async (req, res) => {
  try {
    const { name, email, password, jobTitle, domain, phone, skills } = req.body;
    if (!name || !email || !password) return res.status(400).json({ message: 'All fields required' });
    if (await User.findOne({ email })) return res.status(400).json({ message: 'Email already exists' });
    const count = await User.countDocuments();
    const user = await User.create({
      name,
      email,
      password,
      role: count === 0 ? 'admin' : 'member',
      jobTitle: jobTitle || '',
      domain: domain || 'Other',
      phone: phone || '',
      skills: skills || ''
    });
    res.status(201).json({ token: sign(user._id), user });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// POST /api/auth/login
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    const user = await User.findOne({ email });
    if (!user || !await user.comparePassword(password))
      return res.status(401).json({ message: 'Invalid credentials' });
    if (!user.active) return res.status(403).json({ message: 'Account disabled' });
    res.json({ token: sign(user._id), user });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// GET /api/auth/me
router.get('/me', auth, (req, res) => res.json(req.user));

module.exports = router;
