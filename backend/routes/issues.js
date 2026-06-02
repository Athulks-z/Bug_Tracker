const router = require('express').Router();
const Issue = require('../models/Issue');
const { auth } = require('../middleware/auth');

router.get('/', auth, async (req, res) => {
  try {
    const { project, status, severity, search } = req.query;
    const q = {};
    if (project) q.project = project;
    if (status) q.status = status;
    if (severity) q.severity = severity;
    if (search) q.title = { $regex: search, $options: 'i' };
    const issues = await Issue.find(q)
      .populate('reporter', 'name email')
      .populate('assignee', 'name email')
      .populate('project', 'name key')
      .populate('comments.author', 'name')
      .sort({ createdAt: -1 });
    res.json(issues);
  } catch (err) { res.status(500).json({ message: err.message }); }
});

router.post('/', auth, async (req, res) => {
  try {
    const { title, description, project, assignee, status, severity } = req.body;
    if (!title || !project) return res.status(400).json({ message: 'Title and project required' });
    const issue = await Issue.create({ title, description, project, reporter: req.user._id, assignee, status, severity });
    const populated = await issue.populate(['reporter', 'assignee', 'project']);
    res.status(201).json(populated);
  } catch (err) { res.status(500).json({ message: err.message }); }
});

router.put('/:id', auth, async (req, res) => {
  try {
    const issue = await Issue.findByIdAndUpdate(req.params.id, req.body, { new: true })
      .populate('reporter', 'name email').populate('assignee', 'name email').populate('project', 'name key');
    if (!issue) return res.status(404).json({ message: 'Not found' });
    res.json(issue);
  } catch (err) { res.status(500).json({ message: err.message }); }
});

router.delete('/:id', auth, async (req, res) => {
  try {
    await Issue.findByIdAndDelete(req.params.id);
    res.json({ message: 'Deleted' });
  } catch (err) { res.status(500).json({ message: err.message }); }
});

// POST comment
router.post('/:id/comments', auth, async (req, res) => {
  try {
    const issue = await Issue.findById(req.params.id);
    if (!issue) return res.status(404).json({ message: 'Not found' });
    issue.comments.push({ author: req.user._id, text: req.body.text });
    await issue.save();
    await issue.populate('comments.author', 'name');
    res.json(issue);
  } catch (err) { res.status(500).json({ message: err.message }); }
});

module.exports = router;
