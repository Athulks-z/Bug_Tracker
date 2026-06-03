const router = require('express').Router();
const fs = require('fs');
const path = require('path');
const Issue = require('../models/Issue');
const { auth } = require('../middleware/auth');
const notify = require('../utils/notify');

const UPLOAD_DIR = path.join(__dirname, '..', '..', 'uploads', 'issues');
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });

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
        .populate('activity.user', 'name email')
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

router.get('/stats/overview', auth, async (req, res) => {
  try {
    const total = await Issue.countDocuments();
    const open = await Issue.countDocuments({ status: { $in: ['Open','Triaged','Assigned','In Progress'] } });
    const resolved = await Issue.countDocuments({ status: 'Resolved' });
    const closed = await Issue.countDocuments({ status: 'Closed' });

    // average resolution time (resolvedAt - createdAt)
    const agg = await Issue.aggregate([
      { $match: { resolvedAt: { $exists: true } } },
      { $project: { diff: { $divide: [{ $subtract: ["$resolvedAt", "$createdAt"] }, 1000 * 60 * 60 * 24] } } },
      { $group: { _id: null, avgDays: { $avg: "$diff" } } }
    ]);
    const avgResolutionDays = agg[0]?.avgDays || 0;

    const reopenedCount = await Issue.countDocuments({ reopenedCount: { $gt: 0 } });
    const reopenedPercent = total ? Math.round((reopenedCount / total) * 100) : 0;

    // top projects
    const byProject = await Issue.aggregate([
      { $group: { _id: '$project', count: { $sum: 1 } } },
      { $sort: { count: -1 } },
      { $limit: 5 }
    ]);

    // top assignees
    const byAssignee = await Issue.aggregate([
      { $group: { _id: '$assignee', count: { $sum: 1 } } },
      { $sort: { count: -1 } },
      { $limit: 5 }
    ]);

    res.json({ total, open, resolved, closed, avgResolutionDays, reopenedPercent, byProject, byAssignee });
  } catch (err) { res.status(500).json({ message: err.message }); }
});

// Advanced search: simple parser for 'key:value' tokens and free text
router.get('/search', auth, async (req, res) => {
  try {
    const { q } = req.query;
    if (!q) return res.json([]);
    const parts = q.split(/\s+/);
    const filter = {};
    const textParts = [];
    parts.forEach(p => {
      const m = p.match(/^([^:]+):(.+)$/);
      if (m) {
        const k = m[1].toLowerCase();
        const v = m[2];
        if (k === 'status') filter.status = v;
        if (k === 'assignee') filter.assignee = v;
        if (k === 'project') filter.project = v;
        if (k === 'severity') filter.severity = v;
      } else {
        textParts.push(p);
      }
    });
    if (textParts.length) filter.title = { $regex: textParts.join(' '), $options: 'i' };
    const issues = await Issue.find(filter).populate('reporter','name email').populate('assignee','name email').populate('project','name key');
    res.json(issues);
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
    const issue = new Issue({ title, description, project, reporter: req.user._id, assignee, status, severity });
    issue.activity = [{ user: req.user._id, action: 'created', details: `Issue created by ${req.user.name || req.user._id}` }];
    await issue.save();
    const populated = await Issue.findById(issue._id)
      .populate('reporter', 'name email')
      .populate('assignee', 'name email')
      .populate('project', 'name key')
      .populate('activity.user', 'name email')
      .populate('comments.author', 'name');
    res.status(201).json(populated);
  } catch (err) { res.status(500).json({ message: err.message }); }
});

router.put('/:id', auth, async (req, res) => {
  try {
    const issue = await Issue.findById(req.params.id);
    if (!issue) return res.status(404).json({ message: 'Not found' });

    const before = { status: issue.status, assignee: issue.assignee ? issue.assignee.toString() : null };

    // apply changes from body
    const fields = ['title','description','project','assignee','status','severity','dueDate','foundInVersion','fixedInVersion','targetRelease','sprint','estimatedHours'];
    fields.forEach(f => { if (req.body[f] !== undefined) issue[f] = req.body[f]; });

    // record activity for key changes
    if (req.body.status && req.body.status !== before.status) {
      issue.activity.push({ user: req.user._id, action: 'status_changed', details: `${before.status} -> ${req.body.status}` });
      if (req.body.status === 'Resolved') issue.resolvedAt = new Date();
      if (req.body.status === 'Reopened') issue.reopenedCount = (issue.reopenedCount || 0) + 1;
      try { notify.sendNotification({ type: 'issue_status_changed', issue: issue._id, user: req.user._id, details: `${before.status} -> ${req.body.status}` }); } catch(e){}
    }
    if (req.body.assignee && req.body.assignee !== before.assignee) {
      issue.activity.push({ user: req.user._id, action: 'assignee_changed', details: `${before.assignee || 'Unassigned'} -> ${req.body.assignee}` });
      try { notify.sendNotification({ type: 'issue_assignee_changed', issue: issue._id, user: req.user._id, details: `${before.assignee || 'Unassigned'} -> ${req.body.assignee}` }); } catch(e){}
    }

    // timeLog entry support
    if (req.body.timeLog) {
        issue.timeLogs.push({ user: req.user._id, hours: req.body.timeLog.hours, note: req.body.timeLog.note || '' });
        issue.activity.push({ user: req.user._id, action: 'timelog', details: `Logged ${req.body.timeLog.hours}h` });
        try { notify.sendNotification({ type: 'issue_timelog', issue: issue._id, user: req.user._id, details: `Logged ${req.body.timeLog.hours}h` }); } catch(e){}
    }

    await issue.save();
    const populated = await Issue.findById(issue._id)
      .populate('reporter', 'name email')
      .populate('assignee', 'name email')
      .populate('project', 'name key')
      .populate('activity.user', 'name email')
      .populate('comments.author', 'name');
    res.json(populated);
  } catch (err) { res.status(500).json({ message: err.message }); }
});

// Attach file (accepts JSON body with { filename, data } where data is base64 or data URI)
router.post('/:id/attachments', auth, async (req, res) => {
  try {
    const issue = await Issue.findById(req.params.id);
    if (!issue) return res.status(404).json({ message: 'Not found' });
    const { filename, data } = req.body;
    if (!filename || !data) return res.status(400).json({ message: 'filename and data required' });

    // strip data uri prefix if present
    const matches = data.match(/^data:(.+);base64,(.+)$/);
    const base64 = matches ? matches[2] : data;
    const buffer = Buffer.from(base64, 'base64');
    const safeName = `${Date.now()}-${filename.replace(/[^a-zA-Z0-9.\-]/g, '_')}`;
    const outPath = path.join(UPLOAD_DIR, safeName);
    await fs.promises.writeFile(outPath, buffer);

    const attachment = { filename, path: `/uploads/issues/${safeName}`, uploadedBy: req.user._id };
    issue.attachments.push(attachment);
    issue.activity.push({ user: req.user._id, action: 'attachment_added', details: filename });
    await issue.save();
    const populated = await Issue.findById(issue._id)
      .populate('reporter', 'name email')
      .populate('assignee', 'name email')
      .populate('project', 'name key')
      .populate('activity.user', 'name email')
      .populate('comments.author', 'name');
    res.json(populated);
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
