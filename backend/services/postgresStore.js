const { randomUUID } = require('crypto');
const pool = require('../config/db');

const COLLECTIONS = new Set([
  'users',
  'projects',
  'issues',
  'tasks',
  'sprints',
  'releases',
  'templates',
  'notifications'
]);

function storeError(message, code) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function normalizeDatabaseError(error) {
  if (error.code === '23505' && error.constraint === 'users_email_lower_unique') {
    return storeError('Email already exists', 'DUPLICATE_EMAIL');
  }
  if (error.code === '23505' && error.constraint === 'users_bootstrap_admin_unique') {
    return storeError('A bootstrap admin already exists', 'BOOTSTRAP_ADMIN_EXISTS');
  }
  return error;
}

function idFor(record) {
  return String(record._id || randomUUID().replace(/-/g, ''));
}

function timestamp(value, fallback) {
  if (!value) return fallback;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) throw new TypeError(`Invalid timestamp: ${value}`);
  return parsed;
}

function dateValue(value) {
  if (!value) return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) throw new TypeError(`Invalid date: ${value}`);
  return parsed.toISOString().slice(0, 10);
}

function dateOutput(value) {
  if (!value) return '';
  return value instanceof Date ? value.toISOString().slice(0, 10) : String(value).slice(0, 10);
}

function roleCode(role, bootstrapAdmin) {
  if (role === 'admin') return bootstrapAdmin ? 'super_admin' : 'admin';
  if (role === 'member') return 'employee';
  if (['super_admin', 'manager', 'employee', 'trainee'].includes(role)) return role;
  throw new TypeError(`Unsupported user role: ${role}`);
}

function legacyRole(roleCodeValue) {
  return roleCodeValue;
}

function projectStatus(status) {
  const normalized = String(status || 'active').trim().toLowerCase().replace(/[\s-]+/g, '_');
  if (normalized === 'onhold') return 'on_hold';
  if (['planning', 'active', 'on_hold', 'completed', 'archived', 'cancelled'].includes(normalized)) {
    return normalized;
  }
  throw new TypeError(`Unsupported project status: ${status}`);
}

function jsonValue(value, fallback) {
  return JSON.stringify(value === undefined || value === null ? fallback : value);
}

function arrayValue(value, field) {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) throw new TypeError(`${field} must be an array`);
  return value;
}

async function loadRecords(client, collection) {
  if (collection === 'users') {
    const { rows } = await client.query('SELECT * FROM public.users ORDER BY created_at, id');
    const memberships = await client.query(
      'SELECT user_id, project_id FROM public.project_members WHERE active ORDER BY project_id, user_id'
    );
    const projectsByUser = new Map();
    for (const row of memberships.rows) {
      if (!projectsByUser.has(row.user_id)) projectsByUser.set(row.user_id, []);
      projectsByUser.get(row.user_id).push(row.project_id);
    }
    return rows.map((row) => ({
      _id: row.id,
      name: row.name,
      email: row.email,
      password: row.password_hash,
      role: legacyRole(row.role_code),
      bootstrapAdmin: row.bootstrap_admin,
      department: row.department_id,
      reportingManager: row.reporting_manager_id || '',
      jobTitle: row.job_title || '',
      domain: row.domain || '',
      phone: row.phone || '',
      skills: row.skills || '',
      avatar: row.avatar || '',
      active: row.active,
      assignedProjects: projectsByUser.get(row.id) || [],
      createdAt: row.created_at.toISOString(),
      updatedAt: row.updated_at.toISOString()
    }));
  }

  if (collection === 'projects') {
    const { rows } = await client.query('SELECT * FROM public.projects ORDER BY created_at, id');
    const members = await client.query(
      'SELECT project_id, user_id FROM public.project_members WHERE active ORDER BY project_id, user_id'
    );
    const membersByProject = new Map();
    for (const row of members.rows) {
      if (!membersByProject.has(row.project_id)) membersByProject.set(row.project_id, []);
      membersByProject.get(row.project_id).push(row.user_id);
    }
    return rows.map((row) => ({
      _id: row.id,
      name: row.name,
      key: row.key,
      prefix: row.key,
      description: row.description_text ?? row.description_html ?? '',
      owner: row.owner_user_id,
      members: membersByProject.get(row.id) || [],
      status: row.status,
      createdAt: row.created_at.toISOString(),
      updatedAt: row.updated_at.toISOString()
    }));
  }

  if (collection === 'issues' || collection === 'tasks') {
    const kind = collection === 'issues' ? 'issue' : 'task';
    const subtype = collection;
    const { rows } = await client.query(
      `SELECT w.*, s.*
       FROM public.work_items w
       JOIN public.${subtype} s ON s.work_item_id = w.id
       WHERE w.kind = $1
       ORDER BY w.created_at, w.id`,
      [kind]
    );
    const records = rows.map((row) => ({
      _id: row.id,
      title: row.title,
      description: row.description_text ?? row.description_html ?? '',
      project: row.project_id,
      reporter: row.reporter_user_id,
      assignee: row.assignee_user_id || '',
      status: row.status,
      priority: row.priority || '',
      startDate: dateOutput(row.start_date),
      endDate: dateOutput(row.due_date),
      dueDate: dateOutput(row.due_date),
      estimatedHours: row.estimate_hours === null ? 0 : Number(row.estimate_hours),
      rejectedBy: row.rejected_by_user_id || '',
      rejectedAt: row.rejected_at ? row.rejected_at.toISOString() : '',
      closingRemarks: row.closing_remarks || '',
      rejectReason: row.reject_reason || '',
      completedAt: row.completed_at ? row.completed_at.toISOString() : '',
      createdAt: row.created_at.toISOString(),
      updatedAt: row.updated_at.toISOString()
    }));

    if (collection === 'tasks') {
      return records.map((record, index) => ({
        ...record,
        type: rows[index].task_type,
        parentTask: rows[index].parent_task_id || ''
      }));
    }

    const ids = records.map((record) => record._id);
    if (!ids.length) return [];
    const comments = await client.query(
      'SELECT * FROM public.comments WHERE work_item_id = ANY($1::text[]) ORDER BY created_at, id',
      [ids]
    );
    const activity = await client.query(
      'SELECT * FROM public.activity_log WHERE work_item_id = ANY($1::text[]) ORDER BY created_at, id',
      [ids]
    );
    const timeEntries = await client.query(
      'SELECT * FROM public.time_entries WHERE work_item_id = ANY($1::text[]) ORDER BY created_at, id',
      [ids]
    );
    const attachments = await client.query(
      'SELECT * FROM public.attachments WHERE work_item_id = ANY($1::text[]) ORDER BY created_at, id',
      [ids]
    );
    const byItem = (rowsToGroup, itemId, convert) => rowsToGroup
      .filter((row) => row.work_item_id === itemId)
      .map(convert);
    return records.map((record, index) => {
      const row = rows[index];
      return {
        ...record,
        issueNumber: row.issue_number,
        type: row.issue_type,
        issueType: row.issue_type,
        severity: row.severity || '',
        foundInVersion: row.found_in_version || '',
        fixedInVersion: row.fixed_in_version || '',
        targetRelease: row.target_release_id || '',
        sprint: row.sprint_id || '',
        reopenedCount: row.reopened_count,
        resolvedAt: row.resolved_at ? row.resolved_at.toISOString() : '',
        comments: byItem(comments.rows, record._id, (item) => ({
          _id: item.id,
          author: item.author_user_id,
          text: item.body_text,
          createdAt: item.created_at.toISOString(),
          updatedAt: item.updated_at.toISOString()
        })),
        activity: byItem(activity.rows, record._id, (item) => ({
          _id: item.id,
          user: item.actor_user_id || '',
          action: item.action,
          details: item.details || '',
          createdAt: item.created_at.toISOString()
        })),
        timeLogs: byItem(timeEntries.rows, record._id, (item) => ({
          _id: item.id,
          user: item.user_id,
          hours: Number(item.hours),
          note: item.note || '',
          date: dateOutput(item.work_date),
          createdAt: item.created_at.toISOString()
        })),
        attachments: byItem(attachments.rows, record._id, (item) => ({
          _id: item.id,
          filename: item.filename,
          path: item.storage_key,
          uploadedBy: item.uploaded_by_user_id,
          createdAt: item.created_at.toISOString(),
          size: Number(item.size_bytes),
          mime: item.mime || ''
        }))
      };
    });
  }

  if (collection === 'sprints' || collection === 'releases') {
    const { rows } = await client.query(`SELECT * FROM public.${collection} ORDER BY created_at, id`);
    return rows.map((row) => (collection === 'sprints' ? {
      _id: row.id,
      project: row.project_id,
      name: row.name,
      startDate: dateOutput(row.start_date),
      endDate: dateOutput(row.end_date),
      goal: row.goal || '',
      status: row.status,
      createdAt: row.created_at.toISOString(),
      updatedAt: row.updated_at.toISOString()
    } : {
      _id: row.id,
      project: row.project_id,
      name: row.name,
      version: row.version || '',
      description: row.description_text ?? row.description_html ?? '',
      releaseDate: dateOutput(row.release_date),
      status: row.status,
      createdAt: row.created_at.toISOString(),
      updatedAt: row.updated_at.toISOString()
    }));
  }

  if (collection === 'templates') {
    const { rows } = await client.query('SELECT * FROM public.templates ORDER BY created_at, id');
    return rows.map((row) => ({
      _id: row.id,
      project: row.project_id || '',
      name: row.name,
      type: row.type,
      body: row.body_text ?? row.body_html ?? '',
      fields: row.fields,
      createdBy: row.created_by_user_id,
      createdAt: row.created_at.toISOString(),
      updatedAt: row.updated_at.toISOString()
    }));
  }

  const { rows } = await client.query(
    `SELECT n.*, nr.project_scope_id, nr.target_project_id, nr.work_item_id
     FROM public.notifications n
     LEFT JOIN public.notification_resources nr ON nr.notification_id = n.id
     ORDER BY n.created_at, n.id`
  );
  return rows.map((row) => ({
    _id: row.id,
    user: row.recipient_user_id,
    type: row.type,
    issue: row.work_item_id || '',
    details: row.details || '',
    read: Boolean(row.read_at),
    createdAt: row.created_at.toISOString()
  }));
}

async function saveUser(client, record, createdAt, updatedAt) {
  const id = idFor(record);
  const email = String(record.email || '').trim().toLowerCase();
  await client.query(
    `INSERT INTO public.users
      (id, name, email, password_hash, role_code, reporting_manager_id, job_title, domain, phone, skills, avatar, active, bootstrap_admin, created_at, updated_at)
     VALUES ($1,$2,$3,$4,$5,NULLIF($6,''),NULLIF($7,''),NULLIF($8,''),NULLIF($9,''),NULLIF($10,''),NULLIF($11,''),$12,$13,$14,$15)
     ON CONFLICT (id) DO UPDATE SET
      name=EXCLUDED.name, email=EXCLUDED.email, password_hash=EXCLUDED.password_hash,
      role_code=EXCLUDED.role_code, reporting_manager_id=EXCLUDED.reporting_manager_id,
      job_title=EXCLUDED.job_title, domain=EXCLUDED.domain, phone=EXCLUDED.phone,
      skills=EXCLUDED.skills, avatar=EXCLUDED.avatar, active=EXCLUDED.active,
      bootstrap_admin=EXCLUDED.bootstrap_admin, updated_at=EXCLUDED.updated_at`,
    [id, record.name || '', email, record.password || '', roleCode(record.role || 'member', record.bootstrapAdmin),
      record.reportingManager || '', record.jobTitle || '', record.domain || '', record.phone || '',
      record.skills || '', record.avatar || '', record.active !== false, Boolean(record.bootstrapAdmin), createdAt, updatedAt]
  );
  if (record.assignedProjects !== undefined && record.assignedProjects !== null) {
    const projects = [...new Set(arrayValue(record.assignedProjects, 'assignedProjects').map(String))];
    await client.query(
      'DELETE FROM public.project_members WHERE user_id=$1 AND NOT (project_id=ANY($2::text[]))',
      [id, projects]
    );
    for (const projectId of projects) {
      await client.query(
        `INSERT INTO public.project_members (project_id,user_id,project_role)
         VALUES ($1,$2,'member') ON CONFLICT (project_id,user_id) DO NOTHING`,
        [projectId, id]
      );
    }
  }
}

async function saveRecord(client, collection, record) {
  const id = idFor(record);
  const now = new Date();
  const createdAt = timestamp(record.createdAt, now);
  const updatedAt = timestamp(record.updatedAt, now);

  if (collection === 'users') {
    await saveUser(client, record, createdAt, updatedAt);
    if (record.reportingManager) {
      await client.query('UPDATE public.users SET reporting_manager_id = $2 WHERE id = $1', [id, record.reportingManager]);
    } else if (record.reportingManager !== undefined) {
      await client.query('UPDATE public.users SET reporting_manager_id = NULL WHERE id = $1', [id]);
    }
    return {
      ...record,
      _id: id,
      email: String(record.email || '').trim().toLowerCase(),
      role: legacyRole(roleCode(record.role || 'member', record.bootstrapAdmin)),
      createdAt: createdAt.toISOString(),
      updatedAt: updatedAt.toISOString()
    };
  }

  if (collection === 'projects') {
    const status = projectStatus(record.status);
    const key = String(record.key || record.prefix || '').trim().toUpperCase();
    if (!record.name || !key) throw new TypeError('Projects require a name and key');
    await client.query(
      `INSERT INTO public.projects (id,name,key,description_text,owner_user_id,status,created_at,updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
       ON CONFLICT (id) DO UPDATE SET name=EXCLUDED.name,key=EXCLUDED.key,
        description_text=EXCLUDED.description_text,owner_user_id=EXCLUDED.owner_user_id,
        status=EXCLUDED.status,updated_at=EXCLUDED.updated_at`,
      [id, record.name, key,
        record.description || '', record.owner || '', status, createdAt, updatedAt]
    );
    await client.query('DELETE FROM public.project_members WHERE project_id = $1', [id]);
    const members = [...new Set(arrayValue(record.members, 'members').map(String))];
    for (const userId of members) {
      await client.query(
        `INSERT INTO public.project_members (project_id,user_id,project_role)
         VALUES ($1,$2,CASE WHEN $2=$3 THEN 'lead' ELSE 'member' END)`,
        [id, userId, record.owner || '']
      );
    }
    return { ...record, _id: id, status, createdAt: createdAt.toISOString(), updatedAt: updatedAt.toISOString() };
  }

  if (collection === 'issues' || collection === 'tasks') {
    const kind = collection === 'issues' ? 'issue' : 'task';
    const issueType = String(record.issueType || record.type || 'other').toLowerCase();
    const taskType = String(record.taskType || record.type || 'task').toLowerCase();
    const projectId = String(record.project || '');
    const reporterId = String(record.reporter || '');
    const assigneeId = String(record.assignee || '');
    const previous = await client.query('SELECT project_id FROM public.work_items WHERE id=$1', [id]);
    if (previous.rows[0] && previous.rows[0].project_id !== projectId) {
      await client.query(`DELETE FROM public.${collection} WHERE work_item_id=$1`, [id]);
      if (collection === 'issues') {
        await client.query('DELETE FROM public.activity_log WHERE work_item_id=$1', [id]);
        await client.query('DELETE FROM public.attachments WHERE work_item_id=$1', [id]);
      }
    }
    await client.query(
      `INSERT INTO public.work_items
       (id,project_id,kind,title,description_text,reporter_user_id,assignee_user_id,status,priority,start_date,due_date,estimate_hours,sprint_id,created_at,updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,NULLIF($7,''),$8,NULLIF($9,''),$10,$11,NULLIF($12,0),NULLIF($13,''),$14,$15)
       ON CONFLICT (id) DO UPDATE SET project_id=EXCLUDED.project_id,title=EXCLUDED.title,
       description_text=EXCLUDED.description_text,reporter_user_id=EXCLUDED.reporter_user_id,
       assignee_user_id=EXCLUDED.assignee_user_id,status=EXCLUDED.status,priority=EXCLUDED.priority,
       start_date=EXCLUDED.start_date,due_date=EXCLUDED.due_date,estimate_hours=EXCLUDED.estimate_hours,sprint_id=EXCLUDED.sprint_id,
       updated_at=EXCLUDED.updated_at`,
      [id, projectId, kind, record.title || '', record.description || '', reporterId, assigneeId,
        record.status || 'To do', record.priority || '', dateValue(record.startDate),
        dateValue(record.dueDate || record.endDate), Number(record.estimatedHours || 0),
        record.sprint || '', createdAt, updatedAt]
    );
    if (collection === 'issues') {
      await client.query(
        `INSERT INTO public.issues
         (work_item_id,project_id,issue_number,issue_type,severity,found_in_version,fixed_in_version,target_release_id,reopened_count,resolved_at)
         VALUES ($1,$2,$3,$4,NULLIF($5,''),NULLIF($6,''),NULLIF($7,''),NULLIF($8,''),$9,$10)
         ON CONFLICT (work_item_id) DO UPDATE SET project_id=EXCLUDED.project_id,
          issue_number=EXCLUDED.issue_number,issue_type=EXCLUDED.issue_type,severity=EXCLUDED.severity,
          found_in_version=EXCLUDED.found_in_version,fixed_in_version=EXCLUDED.fixed_in_version,
          target_release_id=EXCLUDED.target_release_id,reopened_count=EXCLUDED.reopened_count,
          resolved_at=EXCLUDED.resolved_at`,
        [id, projectId, Number(record.issueNumber || 0), issueType, record.severity || '',
          record.foundInVersion || '', record.fixedInVersion || '', record.targetRelease || '',
          Number(record.reopenedCount || 0), timestamp(record.resolvedAt, null)]
      );
      await replaceIssueChildren(client, id, projectId, record);
    } else {
      await client.query(
        `INSERT INTO public.tasks (work_item_id,project_id,task_type,parent_task_id)
         VALUES ($1,$2,$3,NULLIF($4,'')) ON CONFLICT (work_item_id) DO UPDATE SET
         project_id=EXCLUDED.project_id,task_type=EXCLUDED.task_type,parent_task_id=EXCLUDED.parent_task_id`,
        [id, projectId, taskType, record.parentTask || '']
      );
    }
    return { ...record, _id: id, createdAt: createdAt.toISOString(), updatedAt: updatedAt.toISOString() };
  }

  if (collection === 'sprints' || collection === 'releases') {
    const projectId = String(record.project || '');
    if (collection === 'sprints') {
      await client.query(
        `INSERT INTO public.sprints (id,project_id,name,start_date,end_date,goal,status,created_at,updated_at)
         VALUES ($1,$2,$3,$4,$5,NULLIF($6,''),$7,$8,$9)
         ON CONFLICT (id) DO UPDATE SET project_id=EXCLUDED.project_id,name=EXCLUDED.name,
         start_date=EXCLUDED.start_date,end_date=EXCLUDED.end_date,goal=EXCLUDED.goal,
         status=EXCLUDED.status,updated_at=EXCLUDED.updated_at`,
        [id, projectId, record.name || '', dateValue(record.startDate), dateValue(record.endDate),
          record.goal || '', record.status || 'Planned', createdAt, updatedAt]
      );
    } else {
      await client.query(
        `INSERT INTO public.releases (id,project_id,name,version,description_text,release_date,status,created_at,updated_at)
         VALUES ($1,$2,$3,NULLIF($4,''),$5,$6,$7,$8,$9)
         ON CONFLICT (id) DO UPDATE SET project_id=EXCLUDED.project_id,name=EXCLUDED.name,
         version=EXCLUDED.version,description_text=EXCLUDED.description_text,release_date=EXCLUDED.release_date,
         status=EXCLUDED.status,updated_at=EXCLUDED.updated_at`,
        [id, projectId, record.name || '', record.version || '', record.description || '',
          dateValue(record.releaseDate), record.status || 'Planned', createdAt, updatedAt]
      );
    }
    return { ...record, _id: id, createdAt: createdAt.toISOString(), updatedAt: updatedAt.toISOString() };
  }

  if (collection === 'templates') {
    await client.query(
      `INSERT INTO public.templates (id,project_id,name,type,body_text,fields,created_by_user_id,created_at,updated_at)
       VALUES ($1,NULLIF($2,''),$3,$4,$5,$6::jsonb,$7,$8,$9)
       ON CONFLICT (id) DO UPDATE SET project_id=EXCLUDED.project_id,name=EXCLUDED.name,
        type=EXCLUDED.type,body_text=EXCLUDED.body_text,fields=EXCLUDED.fields,
        created_by_user_id=EXCLUDED.created_by_user_id,updated_at=EXCLUDED.updated_at`,
      [id, record.project || '', record.name || '', record.type || 'other', record.body || '',
        jsonValue(record.fields, []), record.createdBy || '', createdAt, updatedAt]
    );
    return { ...record, _id: id, createdAt: createdAt.toISOString(), updatedAt: updatedAt.toISOString() };
  }

  if (collection === 'notifications') {
    const issueId = String(record.issue || '');
    const issueResult = issueId
      ? await client.query('SELECT id,project_id FROM public.work_items WHERE id=$1 AND kind=$2', [issueId, 'issue'])
      : { rows: [] };
    if (issueId && !issueResult.rows[0]) {
      throw storeError('Referenced issue does not exist', 'INVALID_ISSUE_REFERENCE');
    }
    await client.query(
      `INSERT INTO public.notifications (id,recipient_user_id,type,details,read_at,created_at)
       VALUES ($1,$2,$3,$4,$5,$6)
       ON CONFLICT (id) DO UPDATE SET recipient_user_id=EXCLUDED.recipient_user_id,
        type=EXCLUDED.type,details=EXCLUDED.details,read_at=EXCLUDED.read_at`,
      [id, record.user || '', record.type || 'general', record.details || '',
        record.read ? updatedAt : null, createdAt]
    );
    await client.query('DELETE FROM public.notification_resources WHERE notification_id=$1', [id]);
    if (issueResult.rows[0]) {
      await client.query(
        'INSERT INTO public.notification_resources (notification_id,project_scope_id,work_item_id) VALUES ($1,$2,$3)',
        [id, issueResult.rows[0].project_id, issueId]
      );
    }
    return { ...record, _id: id, read: Boolean(record.read), createdAt: createdAt.toISOString() };
  }
  throw new Error(`Unknown PostgreSQL collection "${collection}"`);
}

async function replaceIssueChildren(client, issueId, projectId, record) {
  await client.query('DELETE FROM public.comments WHERE work_item_id=$1', [issueId]);
  for (const comment of arrayValue(record.comments, 'comments')) {
    await client.query(
      `INSERT INTO public.comments (id,work_item_id,author_user_id,body_text,created_at,updated_at)
       VALUES ($1,$2,$3,$4,$5,$6)`,
      [comment._id || randomUUID().replace(/-/g, ''), issueId, comment.author || '',
        comment.text || '', timestamp(comment.createdAt, new Date()), timestamp(comment.updatedAt, new Date())]
    );
  }

  await client.query('DELETE FROM public.activity_log WHERE work_item_id=$1', [issueId]);
  for (const activity of arrayValue(record.activity, 'activity')) {
    await client.query(
      `INSERT INTO public.activity_log (id,work_item_id,project_id,actor_user_id,action,details,created_at)
       VALUES ($1,$2,$3,NULLIF($4,''),$5,$6,$7)`,
      [activity._id || randomUUID().replace(/-/g, ''), issueId, projectId, activity.user || '',
        activity.action || 'updated', activity.details || '', timestamp(activity.createdAt, new Date())]
    );
  }

  await client.query('DELETE FROM public.time_entries WHERE work_item_id=$1', [issueId]);
  for (const entry of arrayValue(record.timeLogs, 'timeLogs')) {
    const hours = Number(entry.hours);
    if (!Number.isFinite(hours) || hours <= 0) throw new TypeError('Time entry hours must be greater than zero');
    if (!entry.date) throw new TypeError('Time entries require a work date');
    await client.query(
      `INSERT INTO public.time_entries (id,work_item_id,user_id,hours,note,work_date,created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [entry._id || randomUUID().replace(/-/g, ''), issueId, entry.user || '', hours,
        entry.note || '', dateValue(entry.date),
        timestamp(entry.createdAt || entry.date, new Date())]
    );
  }

  await client.query('DELETE FROM public.attachments WHERE work_item_id=$1', [issueId]);
  for (const attachment of arrayValue(record.attachments, 'attachments')) {
    if (!attachment.path || !attachment.filename || !attachment.uploadedBy) {
      throw new TypeError('Attachments require a path, filename, and uploader');
    }
    await client.query(
      `INSERT INTO public.attachments
       (id,project_id,work_item_id,filename,size_bytes,storage_key,status,uploaded_by_user_id,scan_status,created_at,linked_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$10)`,
      [attachment._id || randomUUID().replace(/-/g, ''), projectId, issueId,
        attachment.filename, Number(attachment.size || 0),
        attachment.path,
        'legacy', attachment.uploadedBy || '', 'unverified', timestamp(attachment.createdAt, new Date())]
    );
  }
}

class PostgresStore {
  async initialize() {
    const result = await pool.query(`
      SELECT current_database() AS database_name,
             to_regclass('public.work_items') IS NOT NULL AS normalized_ready,
             to_regclass('public.app_records') IS NOT NULL AS compatibility_store_present,
             to_regclass('public.app_records_legacy') IS NOT NULL AS archive_present,
             to_regclass('public.data_migrations') IS NOT NULL AS data_migration_ready
    `);
    if (!result.rows[0].normalized_ready || result.rows[0].compatibility_store_present) {
      throw new Error('Normalized PostgreSQL storage is not active; run npm run db:migrate:normalized before starting the server');
    }
    if (!result.rows[0].archive_present) {
      throw new Error('The compatibility archive is missing; refusing to start with an incomplete database cutover');
    }
    if (!result.rows[0].data_migration_ready) {
      throw new Error('Normalized PostgreSQL data migration is not complete; run npm run db:migrate:normalized before starting the server');
    }
    const migration = await pool.query(
      "SELECT 1 FROM public.data_migrations WHERE name='app_records_to_normalized_v1'"
    );
    if (!migration.rowCount) {
      throw new Error('Normalized PostgreSQL data migration is not complete; run npm run db:migrate:normalized before starting the server');
    }
  }

  definition(collection) {
    if (!COLLECTIONS.has(collection)) throw new Error(`Unknown PostgreSQL collection "${collection}"`);
    return collection;
  }

  async list(collection) {
    this.definition(collection);
    return loadRecords(pool, collection);
  }

  async findById(collection, id) {
    this.definition(collection);
    return (await this.list(collection)).find((record) => record._id === String(id)) || null;
  }

  async findOne(collection, predicate) {
    if (typeof predicate !== 'function') throw new TypeError('findOne requires a predicate function');
    return (await this.list(collection)).find(predicate) || null;
  }

  async insert(collection, input) {
    this.definition(collection);
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      if (collection === 'users') {
        await client.query("SELECT pg_advisory_xact_lock(hashtextextended('bugtracker:users', 0))");
        if (input.bootstrapAdmin) {
          const existing = await client.query('SELECT 1 FROM public.users LIMIT 1');
          if (existing.rowCount) throw storeError('A bootstrap admin already exists', 'BOOTSTRAP_ADMIN_EXISTS');
        }
      }
      if (collection === 'issues' && input.issueNumber === undefined) {
        await client.query(
          "SELECT pg_advisory_xact_lock(hashtextextended('bugtracker:issues:' || $1, 0))",
          [String(input.project || '')]
        );
        const { rows } = await client.query(
          'SELECT COALESCE(max(issue_number),0)::int + 1 AS next_number FROM public.issues WHERE project_id=$1',
          [String(input.project || '')]
        );
        input = { ...input, issueNumber: rows[0].next_number };
      }
      const now = new Date().toISOString();
      const result = await saveRecord(client, collection, {
        ...input,
        _id: input._id || randomUUID().replace(/-/g, ''),
        createdAt: input.createdAt || now,
        updatedAt: now
      });
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK');
      throw normalizeDatabaseError(error);
    } finally {
      client.release();
    }
  }

  async update(collection, id, updates) {
    this.definition(collection);
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      if (collection === 'users') {
        await client.query("SELECT pg_advisory_xact_lock(hashtextextended('bugtracker:users', 0))");
      }
      const existing = (await loadRecords(client, collection)).find((record) => record._id === String(id));
      if (!existing) {
        await client.query('COMMIT');
        return null;
      }
      const record = { ...existing, ...updates, _id: existing._id, createdAt: existing.createdAt, updatedAt: new Date().toISOString() };
      delete record.__rowNumber;
      const saved = await saveRecord(client, collection, record);
      await client.query('COMMIT');
      return saved;
    } catch (error) {
      await client.query('ROLLBACK');
      throw normalizeDatabaseError(error);
    } finally {
      client.release();
    }
  }

  async remove(collection, id) {
    this.definition(collection);
    const queries = {
      users: ['DELETE FROM public.users WHERE id=$1', [String(id)]],
      projects: ['DELETE FROM public.projects WHERE id=$1', [String(id)]],
      issues: ["DELETE FROM public.work_items WHERE id=$1 AND kind='issue'", [String(id)]],
      tasks: ["DELETE FROM public.work_items WHERE id=$1 AND kind='task'", [String(id)]],
      sprints: ['DELETE FROM public.sprints WHERE id=$1', [String(id)]],
      releases: ['DELETE FROM public.releases WHERE id=$1', [String(id)]],
      templates: ['DELETE FROM public.templates WHERE id=$1', [String(id)]],
      notifications: ['DELETE FROM public.notifications WHERE id=$1', [String(id)]]
    };
    const [query, parameters] = queries[collection];
    const { rowCount } = await pool.query(query, parameters);
    return rowCount > 0;
  }

  async close() {
    await pool.end();
  }
}

module.exports = {
  PostgresStore,
  roleCode,
  legacyRole,
  projectStatus,
  saveRecord
};
