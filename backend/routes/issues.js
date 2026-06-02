const router = require('express').Router();
const Issue = require('../models/Issue');
const { auth } = require('../middleware/auth');

router.get('/', auth, async (req, res) => {
  try {
    const { project, status, severity, search, assignee, reporter, limit } = req.query;
    const q = {};
    if (project) q.project = project;
    if (status) q.status = status;
    if (severity) q.severity = severity;
    if (assignee) q.assignee = assignee === 'me' ? req.user._id : assignee;
    if (reporter) q.reporter = reporter === 'me' ? req.user._id : reporter;
    if (search) q.title = { $regex: search, $options: 'i' };
    const query = Issue.find(q)
      .populate('reporter', 'name email')
      .populate('assignee', 'name email')
      .populate('project', 'name key')
      .populate('comments.author', 'name')
      .sort({ createdAt: -1 });
    if (limit) query.limit(parseInt(limit, 10));
    const issues = await query;
    res.json(issues);
  } catch (err) { res.status(500).json({ message: err.message }); }
});

router.get('/stats/summary', auth, async (req, res) => {
  try {
    const summary = await Issue.aggregate([
      { $match: {} },
      { $group: { _id: '$status', count: { $sum: 1 } } },
      { $sort: { count: -1 } }
    ]);
    res.json(summary);
  } catch (err) { res.status(500).json({ message: err.message }); }
});

router.get('/export', auth, async (req, res) => {
  try {
    const { project } = req.query;
    const q = {};
    if (project) q.project = project;
    const issues = await Issue.find(q)
      .populate('reporter', 'name email')
      .populate('assignee', 'name email')
      .populate('project', 'name key')
      .sort({ createdAt: -1 });

    const fields = [
      'Issue Number', 'Title', 'Description', 'Project', 'Project Key', 'Status', 'Severity', 'Reporter', 'Reporter Email', 'Assignee', 'Assignee Email', 'Due Date', 'Created At', 'Updated At'
    ];

    const escape = (value) => {
      const str = value == null ? '' : String(value);
      return `"${str.replace(/"/g, '""')}"`;
    };

    const rows = issues.map(issue => [
      issue.issueNumber,
      issue.title,
      issue.description,
      issue.project?.name,
      issue.project?.key,
      issue.status,
      issue.severity,
      issue.reporter?.name,
      issue.reporter?.email,
      issue.assignee?.name,
      issue.assignee?.email,
      issue.dueDate ? issue.dueDate.toISOString().slice(0, 10) : '',
      issue.createdAt ? issue.createdAt.toISOString() : '',
      issue.updatedAt ? issue.updatedAt.toISOString() : ''
    ]);

    const csv = [fields.map(escape).join(','), ...rows.map(row => row.map(escape).join(','))].join('\r\n');
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename="issues.csv"');
    res.send(csv);
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
