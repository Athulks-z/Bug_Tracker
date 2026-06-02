const router = require('express').Router();
const Task = require('../models/Task');
const { auth } = require('../middleware/auth');

router.get('/', auth, async (req, res) => {
  try {
    const { project, status, search, assignee, reporter, limit, overdue } = req.query;
    const q = {};
    if (project) q.project = project;
    if (status) q.status = status;
    if (search) q.title = { $regex: search, $options: 'i' };
    if (assignee) q.assignee = assignee === 'me' ? req.user._id : assignee;
    if (reporter) q.reporter = reporter === 'me' ? req.user._id : reporter;
    if (overdue === 'true') {
      q.endDate = { $lt: new Date() };
      q.status = { $ne: 'Completed' };
    }
    const query = Task.find(q)
      .populate('reporter', 'name email')
      .populate('assignee', 'name email')
      .populate('project', 'name key')
      .sort({ createdAt: -1 });
    if (limit) query.limit(parseInt(limit, 10));
    const tasks = await query;
    res.json(tasks);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

router.get('/stats/summary', auth, async (req, res) => {
  try {
    const q = {};
    if (req.user.role !== 'admin') q.$or = [
      { assignee: req.user._id },
      { reporter: req.user._id }
    ];
    const summary = await Task.aggregate([
      { $match: q },
      { $group: { _id: '$status', count: { $sum: 1 } } },
      { $sort: { count: -1 } }
    ]);
    res.json(summary);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

router.post('/', auth, async (req, res) => {
  try {
    const { title, description, project, assignee, status, priority, startDate, endDate } = req.body;
    if (!title || !project) return res.status(400).json({ message: 'Title and project required' });
    const task = await Task.create({
      title,
      description,
      project,
      reporter: req.user._id,
      assignee,
      status,
      priority,
      startDate,
      endDate
    });
    const populated = await Task.findById(task._id)
      .populate('reporter', 'name email')
      .populate('assignee', 'name email')
      .populate('project', 'name key');
    res.status(201).json(populated);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

router.put('/:id', auth, async (req, res) => {
  try {
    const task = await Task.findByIdAndUpdate(req.params.id, req.body, { new: true })
      .populate('reporter', 'name email')
      .populate('assignee', 'name email')
      .populate('project', 'name key');
    if (!task) return res.status(404).json({ message: 'Not found' });
    res.json(task);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

router.delete('/:id', auth, async (req, res) => {
  try {
    await Task.findByIdAndDelete(req.params.id);
    res.json({ message: 'Deleted' });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

module.exports = router;
