const jwt = require('jsonwebtoken');
const { store, hydrateUser } = require('../services/data');
const { requireAdministrator } = require('./roles');

const auth = async (req, res, next) => {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ message: 'No token' });
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const user = await store.findById('users', decoded.id);
    if (!user || !user.active) return res.status(401).json({ message: 'Unauthorized' });
    req.user = await hydrateUser(user);
    next();
  } catch (err) {
    if (err.name === 'JsonWebTokenError' || err.name === 'TokenExpiredError') {
      return res.status(401).json({ message: 'Invalid token' });
    }
    next(err);
  }
};

const adminOnly = requireAdministrator;

module.exports = { auth, adminOnly };
