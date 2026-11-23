const router = require('express').Router();
const fs = require('fs');
const path = require('path');
const { auth } = require('../middleware/auth');
const {
  canReadProject,
  canCreateWorkItem,
  canUpdateWorkItem,
  canManageProject
} = require('../middleware/roles');
const notify = require('../utils/notify');
const { store, hydrateIssue } = require('../services/data');
const { queueAssignmentEmail } = require('../services/emailService');

const UPLOAD_DIR = path.join(__dirname, '..', '..', 'uploads', 'issues');
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const matchesIssue = (issue, filters, userId) => (!filters.project || issue.project === filters.project)
  && (!filters.status || issue.status === filters.status)
  && (!filters.severity || issue.severity === filters.severity)
  && (!filters.assignee || issue.assignee === (filters.assignee === 'me' ? userId : filters.assignee))
  && (!filters.reporter || issue.reporter === (filters.reporter === 'me' ? userId : filters.reporter))
  && (!filters.search || String(issue.title || '').toLowerCase().includes(String(filters.search).toLowerCase()));

async function loadVisibleIssues(user) {
  const [issues, projects] = await Promise.all([store.list('issues'), store.list('projects')]);
  const visibleProjectIds = new Set(projects.filter((project) => canReadProject(user, project)).map((project) => project._id));
  return issues.filter((issue) => visibleProjectIds.has(issue.project));
}

router.get('/', auth, async (req, res) => {
  try {
    let issues = (await loadVisibleIssues(req.user))
      .filter((issue) => matchesIssue(issue, req.query, req.user._id))
      .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
    if (req.query.limit) issues = issues.slice(0, Math.max(0, parseInt(req.query.limit, 10) || 0));
    res.json(await Promise.all(issues.map(hydrateIssue)));
  } catch (err) {
    res.status(500).json({ message: 'Unable to load issues' });
  }
});

router.get('/stats/summary', auth, async (req, res) => {
  try {
    const counts = (await loadVisibleIssues(req.user)).reduce((result, issue) => {
      result[issue.status] = (result[issue.status] || 0) + 1;
      return result;
    }, {});
    res.json(Object.entries(counts).sort((a, b) => b[1] - a[1]).map(([_id, count]) => ({ _id, count })));
  } catch (err) {
    res.status(500).json({ message: 'Unable to load issue summary' });
  }
});

router.get('/stats/overview', auth, async (req, res) => {
  try {
    const issues = await loadVisibleIssues(req.user);
    const total = issues.length;
    const open = issues.filter((issue) => ['Open', 'Triaged', 'Assigned', 'In Progress'].includes(issue.status)).length;
    const resolved = issues.filter((issue) => issue.status === 'Resolved').length;
    const closed = issues.filter((issue) => issue.status === 'Closed').length;
    const resolutionTimes = issues
      .filter((issue) => issue.resolvedAt && issue.createdAt)
      .map((issue) => (new Date(issue.resolvedAt) - new Date(issue.createdAt)) / 86400000)
      .filter(Number.isFinite);
    const avgResolutionDays = resolutionTimes.length
      ? resolutionTimes.reduce((sum, days) => sum + days, 0) / resolutionTimes.length
      : 0;
    const reopenedCount = issues.filter((issue) => Number(issue.reopenedCount) > 0).length;
    const groupTop = (field) => {
      const counts = issues.reduce((result, issue) => {
        const id = issue[field] || null;
        const key = id || '';
        const current = result.get(key) || { _id: id, count: 0 };
        current.count += 1;
        result.set(key, current);
        return result;
      }, new Map());
      return [...counts.values()].sort((a, b) => b.count - a.count).slice(0, 5);
    };
    res.json({
      total, open, resolved, closed, avgResolutionDays,
      reopenedPercent: total ? Math.round((reopenedCount / total) * 100) : 0,
      byProject: groupTop('project'),
      byAssignee: groupTop('assignee')
    });
  } catch (err) {
    res.status(500).json({ message: 'Unable to load issue overview' });
  }
});

router.get('/search', auth, async (req, res) => {
  try {
    const query = typeof req.query.q === 'string' ? req.query.q : '';
    if (!query) return res.json([]);
    const filter = {};
    const textParts = [];
    query.split(/\s+/).forEach((part) => {
      const match = part.match(/^([^:]+):(.+)$/);
      if (!match) {
        textParts.push(part);
        return;
      }
      const field = { status: 'status', assignee: 'assignee', project: 'project', severity: 'severity' }[match[1].toLowerCase()];
      if (field) filter[field] = match[2];
    });
    if (textParts.length) filter.search = textParts.join(' ');
    const issues = (await loadVisibleIssues(req.user))
      .filter((issue) => matchesIssue(issue, filter, req.user._id))
      .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
    res.json(await Promise.all(issues.map(hydrateIssue)));
  } catch (err) {
    res.status(500).json({ message: 'Unable to search issues' });
  }
});

router.get('/export', auth, async (req, res) => {
  try {
    const issues = (await loadVisibleIssues(req.user))
      .filter((issue) => !req.query.project || issue.project === req.query.project)
      .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
    const populated = await Promise.all(issues.map(hydrateIssue));
    const fields = ['Issue Number', 'Title', 'Description', 'Project', 'Project Key', 'Status', 'Severity', 'Reporter', 'Reporter Email', 'Assignee', 'Assignee Email', 'Due Date', 'Created At', 'Updated At'];
    const escape = (value) => `"${String(value == null ? '' : value).replace(/"/g, '""')}"`;
    const rows = populated.map((issue) => [
      issue.issueNumber, issue.title, issue.description, issue.project?.name, issue.project?.key,
      issue.status, issue.severity, issue.reporter?.name, issue.reporter?.email,
      issue.assignee?.name, issue.assignee?.email, issue.dueDate?.slice(0, 10),
      issue.createdAt, issue.updatedAt
    ]);
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename="issues.csv"');
    res.send([fields, ...rows].map((row) => row.map(escape).join(',')).join('\r\n'));
  } catch (err) {
    res.status(500).json({ message: 'Unable to export issues' });
  }
});

router.post('/', auth, async (req, res) => {
  try {
    const { title, description, project, assignee, status, severity } = req.body || {};
    if (!title || !project) return res.status(400).json({ message: 'Title and project required' });
    const projectRecord = await store.findById('projects', project);
    if (!canCreateWorkItem(req.user, projectRecord)) {
      return res.status(403).json({ message: 'You cannot create issues in this project' });
    }
    if (req.user.role === 'trainee') {
      return res.status(403).json({ message: 'Your role is read-only' });
    }
    if (req.user.role === 'employee' && assignee && assignee !== req.user._id) {
      return res.status(403).json({ message: 'Employees cannot assign issues to other users' });
    }
    if (assignee && !['employee'].includes(req.user.role)) {
      const assigneeRecord = await store.findById('users', assignee);
      if (!assigneeRecord?.active
        || (projectRecord.owner !== assignee
          && !(projectRecord.members || []).map(String).includes(String(assignee)))) {
        return res.status(400).json({ message: 'The assignee must be a member of this project' });
      }
    }
    const issue = await store.insert('issues', {
      title,
      description: description || '',
      project,
      reporter: req.user._id,
      assignee: assignee || '',
      status: status || 'Open',
      severity: severity || 'Medium',
      estimatedHours: 0,
      timeLogs: [],
      attachments: [],
      comments: [],
      activity: [{ user: req.user._id, action: 'created', details: `Issue created by ${req.user.name || req.user._id}`, createdAt: new Date().toISOString() }],
      reopenedCount: 0
    });
    const response = await hydrateIssue(issue);
    if (assignee) {
      try {
        await queueAssignmentEmail({ kind: 'issue', item: issue, project: projectRecord, assigneeId: assignee, assignedBy: req.user._id });
        response.emailNotification = { queued: true };
      } catch (error) {
        console.error('Issue was created, but its assignment email could not be queued:', error.name);
        response.emailNotification = {
          queued: false,
          message: 'Issue saved, but the assignment email could not be queued. Check server logs.'
        };
      }
    }
    res.status(201).json(response);
  } catch (err) {
    res.status(500).json({ message: 'Unable to create issue' });
  }
});

router.put('/:id', auth, async (req, res) => {
  try {
    const issue = await store.findById('issues', req.params.id);
    if (!issue) return res.status(404).json({ message: 'Not found' });
    const project = await store.findById('projects', issue.project);
    if (!canUpdateWorkItem(req.user, issue, project)) {
      return res.status(403).json({ message: 'You cannot update this issue' });
    }
    const before = { status: issue.status, assignee: issue.assignee || null };
    const update = {};
    const employeeFields = ['title', 'description', 'status', 'severity', 'dueDate', 'timeLog'];
    const managerFields = ['title', 'description', 'project', 'assignee', 'status', 'severity', 'dueDate', 'foundInVersion', 'fixedInVersion', 'targetRelease', 'sprint', 'estimatedHours', 'timeLog'];
    const allowedFields = req.user.role === 'employee' ? employeeFields : managerFields;
    if (Object.keys(req.body || {}).some((field) => !allowedFields.includes(field))) {
      return res.status(403).json({ message: 'This role cannot change one or more requested issue fields' });
    }
    allowedFields.filter((field) => field !== 'timeLog')
      .forEach((field) => { if (req.body?.[field] !== undefined) update[field] = req.body[field]; });
    if (update.project !== undefined) {
      const targetProject = await store.findById('projects', update.project);
      if (!canReadProject(req.user, targetProject)) {
        return res.status(403).json({ message: 'You cannot move an issue to that project' });
      }
    }
    if (update.assignee) {
      const targetProjectId = update.project || issue.project;
      const assigneeRecord = await store.findById('users', update.assignee);
      const targetProject = update.project ? await store.findById('projects', targetProjectId) : project;
      if (!assigneeRecord?.active
        || (targetProject?.owner !== update.assignee
          && !(targetProject?.members || []).map(String).includes(String(update.assignee)))) {
        return res.status(400).json({ message: 'The assignee must be a member of this project' });
      }
    }
    update.activity = issue.activity || [];
    update.timeLogs = issue.timeLogs || [];
    if (req.body?.status && req.body.status !== before.status) {
      const details = `${before.status} -> ${req.body.status}`;
      update.activity.push({ user: req.user._id, action: 'status_changed', details, createdAt: new Date().toISOString() });
      if (req.body.status === 'Resolved') update.resolvedAt = new Date().toISOString();
      if (req.body.status === 'Reopened') update.reopenedCount = (issue.reopenedCount || 0) + 1;
      await notify.sendNotification({ type: 'issue_status_changed', issue: issue._id, user: req.user._id, details });
    }
    if (req.body?.assignee && req.body.assignee !== before.assignee) {
      const details = `${before.assignee || 'Unassigned'} -> ${req.body.assignee}`;
      update.activity.push({ user: req.user._id, action: 'assignee_changed', details, createdAt: new Date().toISOString() });
      await notify.sendNotification({ type: 'issue_assignee_changed', issue: issue._id, user: req.user._id, details });
    }
    if (req.body?.timeLog) {
      update.timeLogs.push({ user: req.user._id, hours: req.body.timeLog.hours, note: req.body.timeLog.note || '', date: new Date().toISOString() });
      const details = `Logged ${req.body.timeLog.hours}h`;
      update.activity.push({ user: req.user._id, action: 'timelog', details, createdAt: new Date().toISOString() });
      await notify.sendNotification({ type: 'issue_timelog', issue: issue._id, user: req.user._id, details });
    }
    const saved = await store.update('issues', issue._id, update);
    const response = await hydrateIssue(saved);
    if (update.assignee && update.assignee !== before.assignee) {
      try {
        const targetProject = update.project ? await store.findById('projects', update.project) : project;
        await queueAssignmentEmail({ kind: 'issue', item: saved, project: targetProject, assigneeId: update.assignee, assignedBy: req.user._id });
        response.emailNotification = { queued: true };
      } catch (error) {
        console.error('Issue was updated, but its assignment email could not be queued:', error.name);
        response.emailNotification = {
          queued: false,
          message: 'Issue saved, but the assignment email could not be queued. Check server logs.'
        };
      }
    }
    res.json(response);
  } catch (err) {
    res.status(500).json({ message: 'Unable to update issue' });
  }
});

router.post('/:id/attachments', auth, async (req, res) => {
  try {
    const issue = await store.findById('issues', req.params.id);
    if (!issue) return res.status(404).json({ message: 'Not found' });
    const project = await store.findById('projects', issue.project);
    if (!canManageProject(req.user, project)) {
      return res.status(403).json({ message: 'Only administrators and project managers can add attachments' });
    }
    const { filename, data } = req.body || {};
    if (!filename || !data) return res.status(400).json({ message: 'filename and data required' });
    const matches = data.match(/^data:(.+);base64,(.+)$/);
    const buffer = Buffer.from(matches ? matches[2] : data, 'base64');
    const safeName = `${Date.now()}-${filename.replace(/[^a-zA-Z0-9.\-]/g, '_')}`;
    await fs.promises.writeFile(path.join(UPLOAD_DIR, safeName), buffer);
    const update = {
      attachments: [...(issue.attachments || []), { filename, path: `/uploads/issues/${safeName}`, uploadedBy: req.user._id, createdAt: new Date().toISOString() }],
      activity: [...(issue.activity || []), { user: req.user._id, action: 'attachment_added', details: filename, createdAt: new Date().toISOString() }]
    };
    res.json(await hydrateIssue(await store.update('issues', issue._id, update)));
  } catch (err) {
    res.status(500).json({ message: 'Unable to add attachment' });
  }
});

router.delete('/:id', auth, async (req, res) => {
  try {
    const issue = await store.findById('issues', req.params.id);
    if (!issue) return res.status(404).json({ message: 'Not found' });
    const project = await store.findById('projects', issue.project);
    if (!canManageProject(req.user, project)) {
      return res.status(403).json({ message: 'Only administrators and project managers can delete issues' });
    }
    await store.remove('issues', req.params.id);
    res.json({ message: 'Deleted' });
  } catch (err) {
    res.status(500).json({ message: 'Unable to delete issue' });
  }
});

router.post('/:id/comments', auth, async (req, res) => {
  try {
    const issue = await store.findById('issues', req.params.id);
    if (!issue) return res.status(404).json({ message: 'Not found' });
    const project = await store.findById('projects', issue.project);
    if (!canReadProject(req.user, project) || req.user.role === 'trainee') {
      return res.status(403).json({ message: 'You cannot comment on this issue' });
    }
    if (typeof req.body?.text !== 'string' || !req.body.text.trim()) {
      return res.status(400).json({ message: 'Comment text required' });
    }
    const comment = { author: req.user._id, text: req.body.text, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
    res.json(await hydrateIssue(await store.update('issues', issue._id, {
      comments: [...(issue.comments || []), comment]
    })));
  } catch (err) {
    res.status(500).json({ message: 'Unable to add comment' });
  }
});

module.exports = router;
