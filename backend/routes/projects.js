const router = require('express').Router();
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { auth, adminOnly } = require('../middleware/auth');
const {
  isAdministrator, canCloseProject, canManageProject, canViewAllProjects, canCreateWorkItem
} = require('../middleware/roles');
const { store, hydrateProject, publicUser } = require('../services/data');
const {
  getProjectStakeholders,
  replaceProjectStakeholders,
  validateProjectStakeholders
} = require('../services/projectStakeholders');
const {
  queryVisibleProjects,
  findVisibleProject,
  projectProgress,
  listProjectBacklog
} = require('../services/projectQueries');
const pool = require('../config/db');
const { dateOnly } = require('../utils/dateOnly');
const { loadConfig } = require('../config');
const {
  sanitizeClosingRemarks,
  validateClosureLinks,
  validateClosureUpload
} = require('../utils/projectClosureValidation');
const {
  countOpenProjectTasks,
  getProjectClosureHistory,
  closeProject,
  reopenProject,
  findClosureAttachment
} = require('../services/projectClosures');

const config = loadConfig();
const CLOSURE_UPLOAD_DIR = path.join(__dirname, '..', '..', 'uploads', 'project-closures');
if (!fs.existsSync(CLOSURE_UPLOAD_DIR)) fs.mkdirSync(CLOSURE_UPLOAD_DIR, { recursive:true });

let projectStatusLabelsPromise;

function getProjectStatusLabels() {
  if (!projectStatusLabelsPromise) {
    projectStatusLabelsPromise = pool.query(
      'SELECT status,label FROM public.project_statuses WHERE active=true'
    ).then(({ rows }) => new Map(rows.map((row) => [row.status,row.label])))
      .catch((error) => {
        projectStatusLabelsPromise = null;
        throw error;
      });
  }
  return projectStatusLabelsPromise;
}

async function hydrateProjectWithStakeholders(project) {
  const result = await hydrateProject(project);
  if (!result) return null;
  result.stakeholders = await getProjectStakeholders(project._id);
  const statusLabels = await getProjectStatusLabels();
  result.statusLabel = statusLabels.get(result.status) || result.status;
  result.createdBy = publicUser(await store.findById('users', project.createdBy));
  const { rows:milestones } = await pool.query(
    `SELECT m.id,m.name,m.sort_order,m.due_date,m.owner_user_id,u.name AS owner_name
     FROM public.milestones m
     LEFT JOIN public.users u ON u.id=m.owner_user_id
     WHERE m.project_id=$1 ORDER BY m.sort_order,m.created_at,m.id`,
    [project._id]
  );
  result.milestones = milestones.map((milestone) => ({
    id:milestone.id,name:milestone.name,sortOrder:milestone.sort_order,
    dueDate:milestone.due_date ? dateOutput(milestone.due_date) : '',
    owner:milestone.owner_user_id || '',ownerName:milestone.owner_name || ''
  }));
  return result;
}

function validateMilestones(milestones) {
  if (!Array.isArray(milestones) || milestones.length < 1 || milestones.length > 20) {
    return 'Projects require between 1 and 20 milestones';
  }
  const names = milestones.map((item) => String(item?.name || '').trim());
  if (names.some((name) => !name || name.length > 100)) {
    return 'Milestone names are required and must be 100 characters or fewer';
  }
  if (milestones.some((item) => !validDate(item?.dueDate))) {
    return 'Milestone due dates must use YYYY-MM-DD format';
  }
  if (new Set(names.map((name) => name.toLowerCase())).size !== names.length) {
    return 'Milestone names must be unique within the project';
  }
  return '';
}

function validDate(value) {
  if (value === undefined || value === null || value === '') return true;
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function dateValue(value) {
  return value === undefined || value === null || value === '' ? null : value;
}

function dateOutput(value) {
  return dateOnly(value);
}

async function saveProjectMilestones(projectId, milestones) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const desiredIds = milestones.map((milestone) => String(milestone.id || '')).filter(Boolean);
    if (desiredIds.length) {
      const { rows } = await client.query(
        'SELECT id FROM public.milestones WHERE project_id=$1 AND id=ANY($2::text[])',
        [String(projectId), desiredIds]
      );
      if (rows.length !== desiredIds.length) throw new Error('Milestone does not belong to this project');
    }
    const retainedIds = [...desiredIds];
    const { rows:existingMilestones } = await client.query(
      'SELECT id,start_date FROM public.milestones WHERE project_id=$1',
      [String(projectId)]
    );
    const removedIds = existingMilestones.map((row) => row.id).filter((id) => !retainedIds.includes(id));
    if (removedIds.length) {
      const { rowCount } = await client.query(
        'SELECT 1 FROM public.work_items WHERE project_id=$1 AND milestone_id=ANY($2::text[]) LIMIT 1',
        [String(projectId), removedIds]
      );
      if (rowCount) {
        const error = new Error('Milestones with linked work items cannot be removed');
        error.code = 'MILESTONE_HAS_WORK_ITEMS';
        throw error;
      }
    }
    for (const [index, milestone] of milestones.entries()) {
      const name = String(milestone.name).trim();
      if (milestone.id) {
        const existing = existingMilestones.find((item) => item.id === String(milestone.id));
        if (existing?.start_date && milestone.dueDate
          && dateOutput(existing.start_date) > milestone.dueDate) {
          const error = new Error('Milestone due date must be on or after its start date');
          error.code = 'MILESTONE_DATE_ORDER';
          throw error;
        }
        await client.query(
          `UPDATE public.milestones
           SET name=$3,sort_order=$4,due_date=$5,owner_user_id=NULLIF($6,''),updated_at=now()
           WHERE project_id=$1 AND id=$2`,
          [String(projectId), String(milestone.id), name, index, dateValue(milestone.dueDate), String(milestone.owner || '')]
        );
      } else {
        const { rows } = await client.query(
          `INSERT INTO public.milestones (project_id,name,sort_order,status,due_date,owner_user_id)
           VALUES ($1,$2,$3,'not_started',$4,NULLIF($5,'')) RETURNING id`,
          [String(projectId), name, index, dateValue(milestone.dueDate), String(milestone.owner || '')]
        );
        retainedIds.push(rows[0].id);
      }
    }
    if (retainedIds.length) {
      await client.query(
        'DELETE FROM public.milestones WHERE project_id=$1 AND NOT (id=ANY($2::text[]))',
        [String(projectId), retainedIds]
      );
    } else {
      await client.query('DELETE FROM public.milestones WHERE project_id=$1', [String(projectId)]);
    }
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

async function validateActiveUsers(userIds) {
  const ids = [...new Set(userIds.map(String))];
  if (!ids.length) return true;
  const { rows } = await pool.query('SELECT id FROM public.users WHERE id=ANY($1::text[]) AND active', [ids]);
  return rows.length === ids.length;
}

router.get('/', auth, async (req, res) => {
  try {
    const result = await queryVisibleProjects(req.user, req.query);
    const projects = await Promise.all(result.ids.map(async (id) =>
      hydrateProjectWithStakeholders(await store.findById('projects', id))));
    res.setHeader('X-Total-Count', String(result.total));
    res.json(projects);
  } catch (err) {
    console.error('Unable to query visible projects:', err.message);
    res.status(500).json({ message: 'Unable to load projects' });
  }
});

router.post('/:id/closure-uploads', auth, async (req,res) => {
  let storageKey;
  try {
    const project = await store.findById('projects',req.params.id);
    if (!project || !await findVisibleProject(req.user,project._id)) return res.status(404).json({ message:'Not found' });
    if (!canCloseProject(req.user,project)) return res.status(403).json({ message:'You cannot close this project' });
    if (project.status === 'closed') return res.status(409).json({ message:'Closed projects cannot be changed' });
    const { filename,data,mime } = req.body || {};
    const validated = validateClosureUpload({
      filename,data,mime,maxBytes:config.maxAttachmentMb * 1024 * 1024
    });
    if (!validated.valid) return res.status(400).json({ message:validated.message });

    const expired = await pool.query(
      `DELETE FROM public.project_closure_uploads
       WHERE project_id=$1 AND expires_at<=now() RETURNING storage_key`,
      [String(project._id)]
    );
    await Promise.all(expired.rows.map((item) => removeClosureStorageFile(item.storage_key)));
    const countResult = await pool.query(
      `SELECT count(*)::int AS total FROM public.project_closure_uploads
       WHERE project_id=$1 AND uploaded_by_user_id=$2 AND expires_at>now()`,
      [String(project._id),String(req.user._id)]
    );
    if (countResult.rows[0].total >= config.maxAttachmentsPerTask) {
      return res.status(400).json({ message:`A maximum of ${config.maxAttachmentsPerTask} closure attachments is allowed` });
    }

    const storedName = `${crypto.randomUUID()}.${validated.extension}`;
    storageKey = `/uploads/project-closures/${storedName}`;
    await fs.promises.writeFile(closureStoragePath(storageKey),validated.buffer,{ flag:'wx' });
    const { rows } = await pool.query(
      `INSERT INTO public.project_closure_uploads
       (project_id,uploaded_by_user_id,filename,mime,size_bytes,storage_key)
       VALUES ($1,$2,$3,$4,$5,$6)
       RETURNING id,filename,mime,size_bytes`,
      [String(project._id),String(req.user._id),validated.originalName,validated.mime,validated.buffer.length,storageKey]
    );
    res.status(201).json({
      id:rows[0].id,filename:rows[0].filename,mime:rows[0].mime,sizeBytes:Number(rows[0].size_bytes)
    });
  } catch (error) {
    if (storageKey) await removeClosureStorageFile(storageKey);
    console.error('Unable to stage project closure attachment:',error.message);
    res.status(500).json({ message:'Unable to upload project closure attachment' });
  }
});

router.delete('/:id/closure-uploads/:uploadId', auth, async (req,res) => {
  try {
    const project = await store.findById('projects',req.params.id);
    if (!project || !await findVisibleProject(req.user,project._id)) return res.status(404).json({ message:'Not found' });
    if (!canCloseProject(req.user,project)) return res.status(403).json({ message:'You cannot close this project' });
    const { rows } = await pool.query(
      `DELETE FROM public.project_closure_uploads
       WHERE id=$1 AND project_id=$2 AND uploaded_by_user_id=$3
       RETURNING storage_key`,
      [String(req.params.uploadId),String(project._id),String(req.user._id)]
    );
    if (!rows.length) return res.status(404).json({ message:'Staged attachment not found' });
    await removeClosureStorageFile(rows[0].storage_key);
    res.json({ message:'Attachment removed' });
  } catch (error) {
    console.error('Unable to remove staged project closure attachment:',error.message);
    res.status(500).json({ message:'Unable to remove staged attachment' });
  }
});

router.post('/:id/close', auth, async (req,res) => {
  try {
    const project = await store.findById('projects',req.params.id);
    if (!project || !await findVisibleProject(req.user,project._id)) return res.status(404).json({ message:'Not found' });
    if (!canCloseProject(req.user,project)) return res.status(403).json({ message:'You cannot close this project' });
    if (project.status === 'closed') {
      const { getProjectClosureHistory:loadHistory } = require('../services/projectClosures');
      const history = await loadHistory(project._id);
      return res.json({ alreadyClosed:true,closure:history.find((item) => !item.reopenedAt) || history[0] });
    }
    const remarks = sanitizeClosingRemarks(req.body?.closingRemarks);
    if (!remarks.valid) return res.status(400).json({ message:remarks.message,field:'closingRemarks' });
    const validatedLinks = validateClosureLinks(req.body?.links);
    if (!validatedLinks.valid) return res.status(400).json({ message:validatedLinks.message,field:'links' });
    if (req.body?.uploadIds !== undefined
      && (!Array.isArray(req.body.uploadIds) || req.body.uploadIds.some((id) => typeof id !== 'string'))) {
      return res.status(400).json({ message:'Closure attachments are invalid' });
    }
    const result = await closeProject({
      projectId:project._id,user:req.user,
      closingRemarksHtml:remarks.closingRemarksHtml,
      closingRemarksText:remarks.plainText,
      links:validatedLinks.links,
      uploadIds:req.body?.uploadIds || [],
      blockWithOpenTasks:config.blockCloseWithOpenTasks
    });
    res.json(result);
  } catch (error) {
    if (error.status) return res.status(error.status).json({ message:error.message,code:error.code });
    console.error('Unable to close project:',error.message);
    res.status(500).json({ message:'Unable to close project' });
  }
});

router.post('/:id/reopen', auth, async (req,res) => {
  try {
    if (!canViewAllProjects(req.user)) return res.status(403).json({ message:'Only Managers and Admins can reopen projects' });
    if (!await findVisibleProject(req.user,req.params.id)) return res.status(404).json({ message:'Not found' });
    const remarks = sanitizeClosingRemarks(req.body?.reopeningRemarks);
    if (!remarks.valid) return res.status(400).json({ message:remarks.message,field:'reopeningRemarks' });
    const result = await reopenProject({
      projectId:req.params.id,user:req.user,reopeningRemarks:remarks.plainText
    });
    res.json(result);
  } catch (error) {
    if (error.status) return res.status(error.status).json({ message:error.message,code:error.code });
    console.error('Unable to reopen project:',error.message);
    res.status(500).json({ message:'Unable to reopen project' });
  }
});

router.get('/:id/closure-attachments/:attachmentId/download', auth, async (req,res) => {
  try {
    if (!await findVisibleProject(req.user,req.params.id)) return res.status(404).json({ message:'Not found' });
    const attachment = await findClosureAttachment(req.user,req.params.id,req.params.attachmentId);
    if (!attachment) return res.status(404).json({ message:'Attachment not found' });
    const filePath = closureStoragePath(attachment.storage_key);
    if (!fs.existsSync(filePath)) return res.status(404).json({ message:'Attachment file not found' });
    res.setHeader('Content-Type',attachment.mime || 'application/octet-stream');
    res.setHeader('X-Content-Type-Options','nosniff');
    res.setHeader('Content-Disposition',`attachment; filename="${String(attachment.filename).replace(/["\r\n]/g,'_')}"`);
    res.sendFile(filePath);
  } catch (error) {
    console.error('Unable to download project closure attachment:',error.message);
    res.status(500).json({ message:'Unable to download project closure attachment' });
  }
});

function closureStoragePath(storageKey) {
  const prefix = '/uploads/project-closures/';
  if (!String(storageKey).startsWith(prefix)) throw new Error('Invalid project closure storage key');
  const root = path.resolve(CLOSURE_UPLOAD_DIR);
  const filePath = path.resolve(root,String(storageKey).slice(prefix.length));
  if (!filePath.startsWith(`${root}${path.sep}`)) throw new Error('Invalid project closure storage path');
  return filePath;
}

async function removeClosureStorageFile(storageKey) {
  try {
    await fs.promises.unlink(closureStoragePath(storageKey));
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
}

router.post('/', auth, adminOnly, async (req, res) => {
  try {
    const {
      name, description, key, owner, members, stakeholders, milestones, status, priority,
      startDate, targetEndDate
    } = req.body || {};
    if (!String(name || '').trim() || !String(key || '').trim() || !owner) {
      return res.status(400).json({ message: 'Name, key, and project owner are required' });
    }
    const milestoneError = validateMilestones(milestones);
    if (milestoneError) return res.status(400).json({ message:milestoneError });
    if (!['planning','in_progress','active','on_hold','completed','cancelled'].includes(status)) {
      return res.status(400).json({ message:'A valid project status is required' });
    }
    if (!['High','Medium','Low'].includes(priority)) {
      return res.status(400).json({ message:'Project priority must be High, Medium, or Low' });
    }
    if (!validDate(startDate) || !validDate(targetEndDate)) {
      return res.status(400).json({ message:'Project dates must use YYYY-MM-DD format' });
    }
    if (startDate && targetEndDate && targetEndDate < startDate) {
      return res.status(400).json({ message:'Target end date must be on or after the start date' });
    }
    if (!Array.isArray(members) || !Array.isArray(stakeholders)) {
      return res.status(400).json({ message:'Project members and stakeholders must be arrays' });
    }
    if (!await validateActiveUsers([...members, owner, ...milestones.map((milestone) => milestone.owner).filter(Boolean)])) {
      return res.status(400).json({ message:'Owner and project members must be active users' });
    }
    if (!await validateProjectStakeholders(stakeholders)) {
      return res.status(400).json({ message:'One or more project stakeholders are missing or inactive' });
    }
    const project = await store.insert('projects', {
      name:String(name).trim(), description:description || '', key:String(key).trim().toUpperCase(),
      owner:String(owner), createdBy:req.user._id,
      members:[...new Set([...members.map(String), String(owner)])],
      status:status === 'in_progress' ? 'active' : status, priority,startDate,targetEndDate
    });
    await saveProjectMilestones(project._id, milestones);
    await replaceProjectStakeholders(project._id, stakeholders, req.user._id);
    res.status(201).json(await hydrateProjectWithStakeholders(await store.findById('projects', project._id)));
  } catch (err) {
    if (err.code === 'MILESTONE_HAS_WORK_ITEMS') return res.status(409).json({ message:err.message });
    if (err.code === 'MILESTONE_DATE_ORDER') return res.status(400).json({ message:err.message });
    if (err.code === '23505') return res.status(409).json({ message:'Project name or key already exists' });
    console.error('Unable to create project:', err.message);
    res.status(500).json({ message:'Unable to create project' });
  }
});

router.get('/:id/backlog', auth, async (req, res) => {
  try {
    const backlog = await listProjectBacklog(req.user, req.params.id);
    if (!backlog) return res.status(404).json({ message:'Not found' });
    res.json(backlog);
  } catch (err) {
    console.error('Unable to load project backlog:', err.message);
    res.status(500).json({ message:'Unable to load project backlog' });
  }
});

router.post('/:id/backlog/:taskId/move', auth, async (req, res) => {
  const client = await pool.connect();
  let transactionOpen = false;
  try {
    const project = await store.findById('projects', req.params.id);
    if (!project || !await findVisibleProject(req.user, project._id)) {
      return res.status(404).json({ message:'Not found' });
    }
    if (project.status === 'closed') return res.status(409).json({ message:'Closed projects are read-only' });
    if (!canManageProject(req.user, project) && !canViewAllProjects(req.user)
      && !canCreateWorkItem(req.user, project)) {
      return res.status(403).json({ message:'You cannot move backlog items in this project' });
    }
    const assignee = String(req.body?.assignee || '');
    const startDate = String(req.body?.startDate || '');
    const dueDate = String(req.body?.dueDate || '');
    const milestone = String(req.body?.milestone || '');
    const estimatedHours = req.body?.estimatedHours === '' || req.body?.estimatedHours === undefined
      ? null
      : Number(req.body.estimatedHours);
    if (!assignee || !startDate || !dueDate) {
      return res.status(400).json({ message:'Assignee, start date, and due date are required' });
    }
    if (!validDate(startDate) || !validDate(dueDate) || dueDate < startDate) {
      return res.status(400).json({ message:'Enter valid dates with due date on or after start date' });
    }
    if (estimatedHours !== null && (!Number.isFinite(estimatedHours) || estimatedHours < 0)) {
      return res.status(400).json({ message:'Estimated hours must be zero or greater' });
    }
    if (!await validateActiveUsers([assignee])) {
      return res.status(400).json({ message:'The assignee must be an active user' });
    }
    if (milestone) {
      const { rowCount } = await pool.query(
        'SELECT 1 FROM public.milestones WHERE id=$1 AND project_id=$2',
        [milestone, project._id]
      );
      if (!rowCount) return res.status(400).json({ message:'Milestone must belong to this project' });
    }
    await client.query('BEGIN');
    transactionOpen = true;
    const { rows:lockedProjectRows } = await client.query(
      'SELECT status FROM public.projects WHERE id=$1 FOR UPDATE',
      [project._id]
    );
    if (!lockedProjectRows.length || lockedProjectRows[0].status === 'closed') {
      await client.query('ROLLBACK');
      transactionOpen = false;
      return res.status(409).json({ message:'Closed projects are read-only' });
    }
    const { rows } = await client.query(
      `UPDATE public.work_items w
       SET assignee_user_id=$3,start_date=$4,due_date=$5,milestone_id=NULLIF($6,''),
           estimate_hours=COALESCE($7,w.estimate_hours),status='Open',updated_at=now()
       FROM public.tasks t
       WHERE w.id=$1 AND w.project_id=$2 AND t.work_item_id=w.id AND t.is_backlog=true
       RETURNING w.id,w.project_id,w.title,t.task_key`,
      [String(req.params.taskId), project._id, assignee, startDate, dueDate, milestone, estimatedHours]
    );
    if (!rows.length) {
      await client.query('ROLLBACK');
      transactionOpen = false;
      return res.status(404).json({ message:'Backlog item not found' });
    }
    const task = rows[0];
    await client.query(
      'UPDATE public.tasks SET is_backlog=false WHERE work_item_id=$1',
      [task.id]
    );
    await client.query(
      `INSERT INTO public.activity_log
       (work_item_id,project_id,actor_user_id,action,details)
       VALUES ($1,$2,$3,'moved_from_backlog',$4)`,
      [task.id, project._id, req.user._id, `Moved ${task.task_key} from backlog to Tasks`]
    );
    await client.query('COMMIT');
    transactionOpen = false;
    const { store:taskStore, hydrateTask } = require('../services/data');
    const saved = await taskStore.findById('tasks', task.id);
    const response = await hydrateTask(saved);
    try {
      response.emailNotification = {
        queued:await require('../services/emailService').queueAssignmentEmail({
          kind:'task',item:saved,project,assigneeId:assignee,assignedBy:req.user._id
        })
      };
    } catch (error) {
      console.error('Backlog item moved, but assignment email could not be queued:', error.name);
      response.emailNotification = { queued:false,message:'Task moved, but assignment email could not be queued.' };
    }
    res.json(response);
  } catch (err) {
    if (transactionOpen) {
      try {
        await client.query('ROLLBACK');
      } catch (rollbackError) {
        console.error('Backlog move rollback failed:', rollbackError.name);
      }
    }
    console.error('Unable to move backlog item:', err.message);
    res.status(500).json({ message:'Unable to move backlog item' });
  } finally {
    client.release();
  }
});

router.get('/:id', auth, async (req, res) => {
  try {
    if (!await findVisibleProject(req.user, req.params.id)) return res.status(404).json({ message:'Not found' });
    const project = await hydrateProjectWithStakeholders(await store.findById('projects', req.params.id));
    const progress = await projectProgress(req.user, req.params.id);
    const backlog = await listProjectBacklog(req.user, req.params.id);
    const [closureHistory,openTaskCount] = await Promise.all([
      getProjectClosureHistory(req.params.id),
      countOpenProjectTasks(pool,req.params.id)
    ]);
    res.json({
      ...project,...progress,backlog,closureHistory,openTaskCount,
      blockCloseWithOpenTasks:config.blockCloseWithOpenTasks,
      closureAttachmentLimits:{
        maxMb:config.maxAttachmentMb,
        maxFiles:config.maxAttachmentsPerTask
      },
      permissions:{ canClose:canCloseProject(req.user,project),canReopen:canViewAllProjects(req.user) }
    });
  } catch (err) {
    console.error('Unable to load project details:', err.message);
    res.status(500).json({ message:'Unable to load project details' });
  }
});

router.put('/:id', auth, async (req, res) => {
  try {
    const existing = await store.findById('projects', req.params.id);
    if (!existing) return res.status(404).json({ message:'Not found' });
    if (!await findVisibleProject(req.user, existing._id)) return res.status(404).json({ message:'Not found' });
    if (existing.status === 'closed') return res.status(409).json({ message:'Closed projects are read-only' });
    const { stakeholders } = req.body || {};
    if (stakeholders !== undefined && !await validateProjectStakeholders(stakeholders)) {
      return res.status(400).json({ message:'One or more project stakeholders are missing or inactive' });
    }
    const update = {};
    if (isAdministrator(req.user)) {
      ['name','description','key','owner','members','status','priority','startDate','targetEndDate'].forEach((field) => {
        if (req.body?.[field] !== undefined) update[field] = field === 'key'
          ? String(req.body[field]).trim().toUpperCase()
          : field === 'name'
            ? String(req.body[field]).trim()
          : req.body[field];
      });
      if (req.body?.milestones !== undefined) {
        const milestoneError = validateMilestones(req.body.milestones);
        if (milestoneError) return res.status(400).json({ message:milestoneError });
        if (!await validateActiveUsers(req.body.milestones.map((milestone) => milestone.owner).filter(Boolean))) {
          return res.status(400).json({ message:'Milestone owners must be active users' });
        }
      }
    } else if (canManageProject(req.user, existing)) {
      const requestedFields = Object.keys(req.body || {});
      if (requestedFields.some((field) => !['members','stakeholders'].includes(field))) {
        return res.status(403).json({ message:'Managers may only update project membership and stakeholders' });
      }
      if (req.body.members !== undefined && !Array.isArray(req.body.members)) {
        return res.status(400).json({ message:'Project members must be an array' });
      }
      if (req.body.members !== undefined) update.members = req.body.members;
    } else {
      return res.status(403).json({ message:'Insufficient permissions' });
    }
    if (update.status === 'in_progress') update.status = 'active';
    if (update.status !== undefined && !['planning','active','on_hold','completed','archived','cancelled'].includes(update.status)) {
      return res.status(400).json({ message:'Project status is invalid' });
    }
    if (update.priority !== undefined && !['High','Medium','Low'].includes(update.priority)) {
      return res.status(400).json({ message:'Project priority must be High, Medium, or Low' });
    }
    if (update.name !== undefined && !String(update.name).trim()) {
      return res.status(400).json({ message:'Project name is required' });
    }
    if (update.key !== undefined && !String(update.key).trim()) {
      return res.status(400).json({ message:'Project key is required' });
    }
    if (update.owner !== undefined && !await validateActiveUsers([update.owner])) {
      return res.status(400).json({ message:'Project owner must be an active user' });
    }
    if (!validDate(update.startDate) || !validDate(update.targetEndDate)) {
      return res.status(400).json({ message:'Project dates must use YYYY-MM-DD format' });
    }
    const effectiveStartDate = update.startDate === undefined ? existing.startDate : update.startDate;
    const effectiveTargetEndDate = update.targetEndDate === undefined ? existing.targetEndDate : update.targetEndDate;
    if (effectiveStartDate && effectiveTargetEndDate && effectiveTargetEndDate < effectiveStartDate) {
      return res.status(400).json({ message:'Target end date must be on or after the start date' });
    }
    if (update.startDate !== undefined) update.startDate = update.startDate === '' ? null : update.startDate;
    if (update.targetEndDate !== undefined) update.targetEndDate = update.targetEndDate === '' ? null : update.targetEndDate;
    if (update.members !== undefined) {
      if (!Array.isArray(update.members) || !await validateActiveUsers([...update.members, update.owner || existing.owner])) {
        return res.status(400).json({ message:'Project members and owner must be active users' });
      }
      update.members = [...new Set([...update.members.map(String), String(update.owner || existing.owner)])];
    }
    const project = await store.update('projects', req.params.id, update);
    if (req.body?.milestones !== undefined) await saveProjectMilestones(req.params.id, req.body.milestones);
    if (stakeholders !== undefined) await replaceProjectStakeholders(req.params.id, stakeholders, req.user._id);
    res.json(await hydrateProjectWithStakeholders(await store.findById('projects', project._id)));
  } catch (err) {
    if (err.message?.includes('Closed projects are read-only')) {
      return res.status(409).json({ message:'Closed projects are read-only' });
    }
    if (err.code === 'MILESTONE_HAS_WORK_ITEMS') return res.status(409).json({ message:err.message });
    if (err.code === 'MILESTONE_DATE_ORDER') return res.status(400).json({ message:err.message });
    if (err.code === '23505') return res.status(409).json({ message:'Project name or key already exists' });
    console.error('Unable to update project:', err.message);
    res.status(500).json({ message:'Unable to update project' });
  }
});

router.delete('/:id', auth, adminOnly, async (req, res) => {
  try {
    if (!await findVisibleProject(req.user, req.params.id)) return res.status(404).json({ message:'Not found' });
    const project = await store.findById('projects',req.params.id);
    if (project?.status === 'closed') return res.status(409).json({ message:'Reopen the project before deleting it' });
    await store.remove('projects', req.params.id);
    res.json({ message:'Deleted' });
  } catch (err) {
    console.error('Unable to delete project:', err.message);
    res.status(500).json({ message:'Unable to delete project' });
  }
});

module.exports = router;
