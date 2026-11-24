const router = require('express').Router();
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const pool = require('../config/db');
const { auth } = require('../middleware/auth');
const { buildTaskVisibilityFilter } = require('../middleware/taskVisibility');
const {
  canReadProject,
  canCreateWorkItem,
  canCreateBacklog,
  canUpdateWorkItem,
  canManageProject
} = require('../middleware/roles');
const { store, hydrateTask } = require('../services/data');
const {
  queryTasks,
  findVisibleTask,
  findVisibleAttachment,
  queryTaskCounts,
  queryTaskDashboard
} = require('../services/taskQueries');
const { queueAssignmentEmail, queueTaskBlockedEmail } = require('../services/emailService');
const notify = require('../utils/notify');
const {
  sanitizeTaskDescription,
  validateAttachmentFilename,
  startDateOrToday,
  validateCustomTypeName
} = require('../utils/taskValidation');

const UPLOAD_DIR = path.join(__dirname, '..', '..', 'uploads', 'tasks');
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const MAX_ATTACHMENT_MB = Number(process.env.MAX_ATTACHMENT_MB || 10);
const MAX_ATTACHMENTS_PER_TASK = Number(process.env.MAX_ATTACHMENTS_PER_TASK || 10);

async function validateTaskType(typeValue, customTypeName) {
  const normalizedType = String(typeValue || '').trim().toLowerCase();
  if (!normalizedType) throw Object.assign(new Error('Type is required'), { status: 400 });
  const { rows } = await pool.query(
    `SELECT wt.value
     FROM public.work_types wt
     JOIN public.work_type_kinds wtk ON wtk.type_value=wt.value
     WHERE wt.value=$1 AND wt.active=true AND wtk.kind='task'`,
    [normalizedType]
  );
  if (!rows.length) throw Object.assign(new Error('Invalid task type'), { status: 400 });
  const customValidation = validateCustomTypeName(normalizedType, customTypeName);
  if (!customValidation.valid) throw Object.assign(new Error(customValidation.message), { status: 400 });
  return { typeValue: customValidation.type, customTypeName: customValidation.customTypeName };
}

async function addBlockedEmailNotification(response, task, project, user) {
  try {
    response.blockedEmailNotification = {
      queued: await queueTaskBlockedEmail({
        task,
        project,
        blockedBy: user.name || user.email
      })
    };
  } catch (error) {
    console.error('Task was saved, but its blocked notification could not be queued:', error.name);
    response.blockedEmailNotification = {
      queued: false,
      message: 'Task saved, but the stakeholder notification could not be queued. Check server logs.'
    };
  }
}

router.get('/', auth, async (req, res) => {
  try {
    const result = await queryTasks(req.user, req.query);
    res.setHeader('X-Total-Count', String(result.total));
    res.json(result.items);
  } catch (err) {
    console.error('Unable to query visible tasks:', err.message);
    res.status(500).json({ message: 'Unable to load tasks' });
  }
});

router.get('/stats/summary', auth, async (req, res) => {
  try {
    const visibility = buildTaskVisibilityFilter(req.user);
    const { rows } = await pool.query(
      `SELECT w.status AS _id, count(*)::int AS count
       FROM public.work_items w
       JOIN public.tasks t ON t.work_item_id=w.id
       WHERE ${visibility.clause} AND t.is_backlog=false
       GROUP BY w.status ORDER BY count DESC`,
      visibility.values
    );
    res.json(rows);
  } catch (err) {
    console.error('Unable to query visible task summary:', err.message);
    res.status(500).json({ message: 'Unable to load task summary' });
  }
});

router.get('/stats/count', auth, async (req, res) => {
  try {
    res.json({ total: await queryTaskCounts(req.user, req.query) });
  } catch (err) {
    console.error('Unable to query visible task count:', err.message);
    res.status(500).json({ message: 'Unable to load task count' });
  }
});

router.get('/dashboard', auth, async (req, res) => {
  try {
    res.json(await queryTaskDashboard(req.user, req.query));
  } catch (err) {
    console.error('Unable to query visible task dashboard:', err.message);
    res.status(500).json({ message: 'Unable to load dashboard' });
  }
});

router.get('/types', auth, async (req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT value, label, icon, active, sort_order
      FROM public.work_types
      WHERE active=true
      ORDER BY CASE WHEN value='other' THEN 1 ELSE 0 END,
               sort_order, lower(label)
    `);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ message: 'Unable to load task types' });
  }
});

router.get('/export', auth, async (req, res) => {
  try {
    const firstPage = await queryTasks(req.user, { ...req.query, limit:200, page:1 });
    const populated = [...firstPage.items];
    for (let page = 2; populated.length < firstPage.total; page += 1) {
      const result = await queryTasks(req.user, { ...req.query, limit:200, page });
      if (!result.items.length) break;
      populated.push(...result.items);
    }
    const escape = (value) => `"${String(value == null ? '' : value).replace(/"/g, '""')}"`;
    const fields = ['Task ID', 'Title', 'Description', 'Type', 'Custom Type', 'Project', 'Project Key', 'Reporter', 'Reporter Email', 'Assignee', 'Assignee Email', 'Status', 'Priority', 'Start Date', 'End Date', 'Created At', 'Updated At'];
    const rows = populated.map((task) => [
      task._id, task.title, task.description,
      task.type === 'other' ? (task.customTypeName ? `Other: ${task.customTypeName}` : 'Other') : task.type,
      task.customTypeName || '', task.project?.name, task.project?.key,
      task.reporter?.name, task.reporter?.email, task.assignee?.name, task.assignee?.email,
      task.status, task.priority, task.startDate?.slice(0, 10), task.endDate?.slice(0, 10),
      task.createdAt, task.updatedAt
    ]);
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename="tasks.csv"');
    res.send([fields, ...rows].map((row) => row.map(escape).join(',')).join('\r\n'));
  } catch (err) {
    res.status(500).json({ message: 'Unable to export tasks' });
  }
});

router.get('/attachments/:id/download', auth, async (req, res) => {
  try {
    const attachment = await findVisibleAttachment(req.user, req.params.id);
    if (!attachment) return res.status(404).json({ message: 'Attachment not found' });
    const storageKey = String(attachment.storage_key || '');
    const filePath = storageKey.startsWith('/uploads/')
      ? path.join(__dirname, '..', '..', 'uploads', storageKey.replace(/^\/uploads\//, ''))
      : storageKey;
    if (!fs.existsSync(filePath)) return res.status(404).json({ message: 'Attachment file not found' });
    res.setHeader('Content-Type', attachment.mime || 'application/octet-stream');
    res.setHeader('Content-Disposition', `attachment; filename="${attachment.filename.replace(/["\r\n]/g, '_')}"`);
    res.sendFile(path.resolve(filePath));
  } catch (err) {
    res.status(500).json({ message: 'Unable to download attachment' });
  }
});

router.get('/:id', auth, async (req, res) => {
  try {
    const task = await findVisibleTask(req.user, req.params.id);
    if (!task) return res.status(404).json({ message: 'Not found' });
    res.json(await hydrateTask(task));
  } catch (err) {
    res.status(500).json({ message: 'Unable to load task' });
  }
});

router.post('/', auth, async (req, res) => {
  try {
    const { title, description, type, customTypeName, project, assignee, status, priority, startDate, endDate,
      severity, foundInVersion, fixedInVersion, targetRelease, sprint, estimatedHours, milestone,
      mode } = req.body || {};
    if (mode !== undefined && !['task','backlog'].includes(mode)) {
      return res.status(400).json({ message:'Mode must be task or backlog' });
    }
    const isBacklog = mode === 'backlog';
    if (!title || !project) return res.status(400).json({ message: 'Title and project required' });
    const validatedType = await validateTaskType(type, customTypeName);
    const projectRecord = await store.findById('projects', project);
    if (projectRecord?.status === 'closed') {
      return res.status(409).json({ message:'Closed projects are read-only' });
    }
    if (isBacklog ? !canCreateBacklog(req.user, projectRecord) : !canCreateWorkItem(req.user, projectRecord)) {
      return res.status(403).json({ message: 'You cannot create tasks in this project' });
    }
    if (!isBacklog && !['super_admin', 'admin', 'manager', 'employee'].includes(req.user.role)) {
      return res.status(403).json({ message: 'Your role is read-only' });
    }
    if (assignee) {
      const assigneeRecord = await store.findById('users', assignee);
      if (!assigneeRecord?.active) {
        return res.status(400).json({ message: 'The assignee must be an active user' });
      }
    }
    if (milestone) {
      const { rowCount } = await pool.query(
        'SELECT 1 FROM public.milestones WHERE id=$1 AND project_id=$2',
        [String(milestone), String(project)]
      );
      if (!rowCount) return res.status(400).json({ message:'Milestone must belong to this project' });
    }
    const task = await store.insert('tasks', {
      title, description: sanitizeTaskDescription(description), project, reporter: req.user._id,
      assignee: assignee || '', status: isBacklog ? 'Backlog' : (status || 'To do'), priority: priority || 'Medium',
      type: validatedType.typeValue, customTypeName: validatedType.customTypeName,
      startDate: isBacklog ? (startDate || '') : startDateOrToday(startDate),
      endDate: endDate || '', severity: severity || '', foundInVersion: foundInVersion || '',
      fixedInVersion: fixedInVersion || '', targetRelease: targetRelease || '',
      sprint: sprint || '', milestone:milestone || '', estimatedHours: estimatedHours || 0,
      isBacklog, attachments: [],
      comments: [], activity: [{ user: req.user._id, action: 'created', details: `Task created by ${req.user.name || req.user._id}`, createdAt: new Date().toISOString() }],
      timeLogs: [], reopenedCount: 0
    });
    const response = await hydrateTask(task);
    if (assignee && !isBacklog) {
      try {
        const queued = await queueAssignmentEmail({ kind: 'task', item: task, project: projectRecord, assigneeId: assignee, assignedBy: req.user._id });
        response.emailNotification = {
          queued,
          ...(queued ? {} : { message: 'Task was reassigned before its notification could be queued.' })
        };
      } catch (error) {
        console.error('Task was created, but its assignment email could not be queued:', error.name);
        response.emailNotification = {
          queued: false,
          message: 'Task saved, but the assignment email could not be queued. Check server logs.'
        };
      }
    }
    if (!isBacklog && task.status === 'Blocked') {
      await addBlockedEmailNotification(response, task, projectRecord, req.user);
    }
    res.status(201).json(response);
  } catch (err) {
    res.status(500).json({ message: 'Unable to create task' });
  }
});

router.put('/:id', auth, async (req, res) => {
  try {
    const existing = await findVisibleTask(req.user, req.params.id);
    if (!existing) return res.status(404).json({ message: 'Not found' });
    const project = await store.findById('projects', existing.project);
    if (project?.status === 'closed') return res.status(409).json({ message:'Tasks in closed projects are read-only' });
    if (!canUpdateWorkItem(req.user, existing, project)) {
      return res.status(403).json({ message: 'You cannot update this task' });
    }
    const update = {};
    const employeeFields = ['title', 'description', 'assignee', 'status', 'priority', 'startDate', 'endDate', 'milestone'];
    const managerFields = ['title', 'description', 'type', 'customTypeName', 'project', 'assignee', 'status', 'priority', 'startDate', 'endDate', 'severity', 'foundInVersion', 'fixedInVersion', 'targetRelease', 'sprint', 'estimatedHours', 'milestone'];
    const allowedFields = req.user.role === 'employee'
      ? employeeFields
      : managerFields;
    if (Object.keys(req.body || {}).some((field) => !allowedFields.includes(field))) {
      return res.status(403).json({ message: 'This role cannot change one or more requested task fields' });
    }
    if (req.body?.description !== undefined) {
      req.body.description = sanitizeTaskDescription(req.body.description);
    }
    if (req.body?.type !== undefined || req.body?.customTypeName !== undefined) {
      const validatedType = await validateTaskType(
        req.body.type === undefined ? existing.type : req.body.type,
        req.body.customTypeName === undefined
          ? (req.body.type === undefined ? existing.customTypeName : '')
          : req.body.customTypeName
      );
      req.body.type = validatedType.typeValue;
      req.body.customTypeName = validatedType.customTypeName;
    }
    allowedFields
      .forEach((field) => { if (req.body?.[field] !== undefined) update[field] = req.body[field]; });
    if (update.startDate === undefined || update.startDate === '') {
      update.startDate = startDateOrToday(existing.startDate);
    }
    if (update.project !== undefined) {
      const targetProject = await store.findById('projects', update.project);
      if (targetProject?.status === 'closed') return res.status(409).json({ message:'Closed projects are read-only' });
      if (!canReadProject(req.user, targetProject)) {
        return res.status(403).json({ message: 'You cannot move a task to that project' });
      }
    }
    if (update.milestone) {
      const milestoneProject = update.project || existing.project;
      const { rowCount } = await pool.query(
        'SELECT 1 FROM public.milestones WHERE id=$1 AND project_id=$2',
        [String(update.milestone), String(milestoneProject)]
      );
      if (!rowCount) return res.status(400).json({ message:'Milestone must belong to this project' });
    }
    if (update.assignee) {
      const assigneeRecord = await store.findById('users', update.assignee);
      if (!assigneeRecord?.active) {
        return res.status(400).json({ message: 'The assignee must be an active user' });
      }
    }
    const task = await store.update('tasks', req.params.id, update);
    if (!task) return res.status(404).json({ message: 'Not found' });
    const response = await hydrateTask(task);
    if (update.assignee && update.assignee !== existing.assignee) {
      try {
        const targetProject = update.project ? await store.findById('projects', update.project) : project;
        const queued = await queueAssignmentEmail({ kind: 'task', item: task, project: targetProject, assigneeId: update.assignee, assignedBy: req.user._id });
        response.emailNotification = {
          queued,
          ...(queued ? {} : { message: 'Task was reassigned before its notification could be queued.' })
        };
      } catch (error) {
        console.error('Task was updated, but its assignment email could not be queued:', error.name);
        response.emailNotification = {
          queued: false,
          message: 'Task saved, but the assignment email could not be queued. Check server logs.'
        };
      }
    }
    if (task.status === 'Blocked' && existing.status !== 'Blocked') {
      const taskProject = update.project
        ? await store.findById('projects', task.project)
        : project;
      await addBlockedEmailNotification(response, task, taskProject, req.user);
    }
    res.json(response);
  } catch (err) {
    res.status(500).json({ message: 'Unable to update task' });
  }
});

router.post('/:id/attachments', auth, async (req, res) => {
  try {
    const task = await findVisibleTask(req.user, req.params.id);
    if (!task) return res.status(404).json({ message: 'Not found' });
    const project = await store.findById('projects', task.project);
    if (project?.status === 'closed') return res.status(409).json({ message:'Tasks in closed projects are read-only' });
    if (!canUpdateWorkItem(req.user, task, project)) return res.status(403).json({ message: 'You cannot attach files to this task' });
    const { filename, data, mime } = req.body || {};
    if (typeof filename !== 'string' || !filename.trim() || typeof data !== 'string') {
      return res.status(400).json({ message: 'filename and data are required' });
    }
    const filenameCheck = validateAttachmentFilename(filename);
    if (!filenameCheck.valid) return res.status(400).json({ message: filenameCheck.message });
    const { originalName, extension } = filenameCheck;
    const matches = data.match(/^data:([^;,]+)?(?:;[^,]*)?,(.+)$/);
    const contentType = String(mime || (matches ? matches[1] : '') || 'application/octet-stream');
    if (!/^[\w!#$&^.+-]+\/[\w!#$&^.+-]+$/.test(contentType)) {
      return res.status(400).json({ message: 'Invalid MIME type' });
    }
    const buffer = Buffer.from(matches ? matches[2] : data, 'base64');
    if (!buffer.length) return res.status(400).json({ message: 'Attachment is empty' });
    if (buffer.length > MAX_ATTACHMENT_MB * 1024 * 1024) {
      return res.status(400).json({ message: `Attachments must be ${MAX_ATTACHMENT_MB} MB or smaller` });
    }
    if ((task.attachments || []).length >= MAX_ATTACHMENTS_PER_TASK) {
      return res.status(400).json({ message: `A maximum of ${MAX_ATTACHMENTS_PER_TASK} attachments is allowed` });
    }
    const storedName = `${crypto.randomUUID()}${extension ? `.${extension}` : ''}`;
    await fs.promises.writeFile(path.join(UPLOAD_DIR, storedName), buffer, { flag: 'wx' });
    const attachment = {
      filename: originalName,
      mime: contentType,
      size: buffer.length,
      path: `/uploads/tasks/${storedName}`,
      uploadedBy: req.user._id,
      createdAt: new Date().toISOString()
    };
    const saved = await store.update('tasks', task._id, {
      attachments: [...(task.attachments || []), attachment],
      activity: [...(task.activity || []), {
        user: req.user._id,
        action: 'attachment_added',
        details: originalName,
        createdAt: new Date().toISOString()
      }]
    });
    res.status(201).json(await hydrateTask(saved));
  } catch (err) {
    res.status(500).json({ message: 'Unable to add attachment' });
  }
});

router.delete('/attachments/:id', auth, async (req, res) => {
  try {
    const attachment = await findVisibleAttachment(req.user, req.params.id);
    if (!attachment) return res.status(404).json({ message: 'Attachment not found' });
    const task = await findVisibleTask(req.user, attachment.work_item_id);
    const project = await store.findById('projects', attachment.project_id);
    if (project?.status === 'closed') return res.status(409).json({ message:'Tasks in closed projects are read-only' });
    const canDelete = canManageProject(req.user, project)
      || String(task?.assignee?._id || task?.assignee || '') === String(req.user._id)
      || String(attachment.uploaded_by_user_id) === String(req.user._id);
    if (!canDelete) return res.status(403).json({ message: 'You cannot delete this attachment' });
    const remaining = (task.attachments || []).filter((item) => item._id !== req.params.id);
    const saved = await store.update('tasks', task._id, {
      attachments: remaining,
      activity: [...(task.activity || []), {
        user: req.user._id,
        action: 'attachment_removed',
        details: attachment.filename,
        createdAt: new Date().toISOString()
      }]
    });
    const storageKey = String(attachment.storage_key || '');
    const filePath = storageKey.startsWith('/uploads/')
      ? path.join(__dirname, '..', '..', 'uploads', storageKey.replace(/^\/uploads\//, ''))
      : storageKey;
    if (filePath && fs.existsSync(filePath)) await fs.promises.unlink(filePath);
    res.json(await hydrateTask(saved));
  } catch (err) {
    res.status(500).json({ message: 'Unable to delete attachment' });
  }
});

router.post('/:id/reject', auth, async (req, res) => {
  try {
    const task = await findVisibleTask(req.user, req.params.id);
    if (!task) return res.status(404).json({ message: 'Not found' });
    const project = await store.findById('projects', task.project);
    if (project?.status === 'closed') return res.status(409).json({ message:'Tasks in closed projects are read-only' });
    if (!canUpdateWorkItem(req.user, task, project)) return res.status(403).json({ message: 'You cannot reject this task' });
    const remarks = String(req.body?.closingRemarks || '').trim();
    if (remarks.length < 3) return res.status(400).json({ message: 'Closing remarks must be at least 3 characters' });
    const previousStatus = task.status || 'Open';
    const saved = await store.update('tasks', task._id, {
      status: 'Rejected',
      rejectedBy: req.user._id,
      rejectedAt: new Date().toISOString(),
      closingRemarks: remarks,
      rejectReason: remarks,
      previousStatus,
      activity: [...(task.activity || []), {
        user: req.user._id,
        action: 'rejected',
        details: remarks,
        createdAt: new Date().toISOString()
      }]
    });
    await notify.sendNotification({ type: 'task_rejected', issue: task._id, user: req.user._id, details: remarks });
    res.json(await hydrateTask(saved));
  } catch (err) {
    res.status(500).json({ message: 'Unable to reject task' });
  }
});

router.post('/:id/reopen', auth, async (req, res) => {
  try {
    const task = await findVisibleTask(req.user, req.params.id);
    if (!task) return res.status(404).json({ message: 'Not found' });
    const project = await store.findById('projects', task.project);
    if (project?.status === 'closed') return res.status(409).json({ message:'Tasks in closed projects are read-only' });
    if (!canUpdateWorkItem(req.user, task, project)) return res.status(403).json({ message: 'You cannot reopen this task' });
    const saved = await store.update('tasks', task._id, {
      status: 'Open',
      rejectedBy: '',
      rejectedAt: '',
      closingRemarks: '',
      rejectReason: '',
      reopenedCount: (task.reopenedCount || 0) + 1,
      activity: [...(task.activity || []), {
        user: req.user._id,
        action: 'reopened',
        details: 'Task reopened',
        createdAt: new Date().toISOString()
      }]
    });
    await notify.sendNotification({ type: 'task_reopened', issue: task._id, user: req.user._id, details: 'Task reopened' });
    res.json(await hydrateTask(saved));
  } catch (err) {
    res.status(500).json({ message: 'Unable to reopen task' });
  }
});

router.post('/:id/comments', auth, async (req, res) => {
  try {
    const task = await findVisibleTask(req.user, req.params.id);
    if (!task) return res.status(404).json({ message: 'Not found' });
    const project = await store.findById('projects', task.project);
    if (project?.status === 'closed') return res.status(409).json({ message:'Tasks in closed projects are read-only' });
    if (!canReadProject(req.user, project)) return res.status(403).json({ message: 'You cannot comment on this task' });
    const text = String(req.body?.text || '').trim();
    if (!text) return res.status(400).json({ message: 'Comment text is required' });
    const saved = await store.update('tasks', task._id, {
      comments: [...(task.comments || []), {
        author: req.user._id,
        text,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      }]
    });
    res.json(await hydrateTask(saved));
  } catch (err) {
    res.status(500).json({ message: 'Unable to add comment' });
  }
});

router.delete('/:id', auth, async (req, res) => {
  try {
    const existing = await findVisibleTask(req.user, req.params.id);
    if (!existing) return res.status(404).json({ message: 'Not found' });
    const project = await store.findById('projects', existing.project);
    if (project?.status === 'closed') return res.status(409).json({ message:'Tasks in closed projects are read-only' });
    if (!canManageProject(req.user, project)) {
      return res.status(403).json({ message: 'Only administrators and project managers can delete tasks' });
    }
    await store.remove('tasks', req.params.id);
    res.json({ message: 'Deleted' });
  } catch (err) {
    res.status(500).json({ message: 'Unable to delete task' });
  }
});

module.exports = router;
