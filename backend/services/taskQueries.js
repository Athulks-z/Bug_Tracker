const pool = require('../config/db');
const { buildTaskVisibilityFilter } = require('../middleware/taskVisibility');
const { isAdministrator, isManager } = require('../middleware/roles');
const { hydrateTask } = require('./data');
const { dateOnly } = require('../utils/dateOnly');

const STATUS_GROUPS = ['Open','In Progress','Completed/Closed','Rejected'];
const STATUS_GROUP_EXPRESSION = `CASE
  WHEN w.status='Rejected' THEN 'Rejected'
  WHEN w.status IN ('In Progress','In progress','Code Review','QA Testing') THEN 'In Progress'
  WHEN w.status IN ('Completed','Resolved','Closed') THEN 'Completed/Closed'
  ELSE 'Open' END`;

function listValues(value) {
  if (value === undefined || value === null || value === '') return [];
  return (Array.isArray(value) ? value : String(value).split(','))
    .map(String)
    .filter(Boolean);
}

function buildTaskWhere(user, query = {}, parameterIndex = 1) {
  const visibility = buildTaskVisibilityFilter(user, 'w', parameterIndex);
  const clauses = [visibility.clause, 't.is_backlog=false'];
  const values = [...visibility.values];
  const parameterOffset = parameterIndex - 1;
  const add = (clause, value) => {
    values.push(value);
    clauses.push(clause.replace('?', `$${parameterOffset + values.length}`));
  };

  if (query.project) add('w.project_id = ?', String(query.project));
  if (query.status) add('w.status = ?', String(query.status));

  const types = listValues(query.type);
  if (types.length) {
    values.push(types);
    clauses.push(`t.task_type = ANY($${parameterOffset + values.length}::text[])`);
  }

  if (query.customTypeName) {
    add('lower(t.custom_type_name) = lower(?)', String(query.customTypeName).trim());
  }

  if (STATUS_GROUPS.includes(query.statusGroup)) {
    values.push(query.statusGroup);
    clauses.push(`${STATUS_GROUP_EXPRESSION} = $${parameterOffset + values.length}`);
  }

  const assignees = listValues(query.assignee)
    .map((assignee) => assignee === 'me' ? String(user?._id || '') : assignee);
  if (assignees.length) {
    values.push(assignees);
    clauses.push(`w.assignee_user_id = ANY($${parameterOffset + values.length}::text[])`);
  }

  if (query.reporter) {
    add('w.reporter_user_id = ?', query.reporter === 'me' ? String(user?._id || '') : String(query.reporter));
  }

  if (query.search) {
    values.push(`%${String(query.search).trim().replace(/[\\%_]/g, '\\$&')}%`);
    clauses.push(`(
      w.title ILIKE $${parameterOffset + values.length} ESCAPE '\\'
      OR COALESCE(w.description_text, w.description_html, '') ILIKE $${parameterOffset + values.length} ESCAPE '\\'
      OR t.task_key ILIKE $${parameterOffset + values.length} ESCAPE '\\'
      OR COALESCE(t.custom_type_name, '') ILIKE $${parameterOffset + values.length} ESCAPE '\\'
      OR COALESCE(wt.label, t.task_type) ILIKE $${parameterOffset + values.length} ESCAPE '\\'
    )`);
  }

  if (query.overdue === 'true') {
    clauses.push(`w.due_date < CURRENT_DATE AND w.status NOT IN ('Completed','Closed','Rejected','Resolved')`);
  }

  if (query.dueToday === 'true') {
    clauses.push('w.due_date = CURRENT_DATE');
  }

  return { clause: clauses.join(' AND '), values };
}

function taskSelectSql() {
  return `SELECT
    w.id, w.project_id, w.title, w.description_text, w.description_html,
    w.reporter_user_id, w.assignee_user_id, w.status, w.priority,
    w.start_date, w.due_date, w.estimate_hours, w.rejected_by_user_id,
    w.rejected_at, w.closing_remarks, w.reject_reason, w.completed_at,
    w.created_at, w.updated_at, w.sprint_id, w.milestone_id,
    t.task_type, t.custom_type_name, t.parent_task_id, t.issue_number,
    t.task_number, t.task_key,
    t.is_backlog,
    t.severity, t.found_in_version, t.fixed_in_version, t.target_release_id,
    t.reopened_count, t.resolved_at,
    p.name AS project_name, p.key AS project_key,
    wt.label AS type_label
  FROM public.work_items w
  JOIN public.tasks t ON t.work_item_id=w.id
  JOIN public.projects p ON p.id=w.project_id
  LEFT JOIN public.work_types wt ON wt.value=t.task_type`;
}

function mapTask(row) {
  return {
    _id: row.id,
    title: row.title,
    description: row.description_text ?? row.description_html ?? '',
    project: row.project_id,
    reporter: row.reporter_user_id,
    assignee: row.assignee_user_id || '',
    status: row.status,
    priority: row.priority || '',
    startDate: dateOnly(row.start_date),
    endDate: dateOnly(row.due_date),
    dueDate: dateOnly(row.due_date),
    estimatedHours: row.estimate_hours === null ? 0 : Number(row.estimate_hours),
    rejectedBy: row.rejected_by_user_id || '',
    rejectedAt: row.rejected_at ? row.rejected_at.toISOString() : '',
    closingRemarks: row.closing_remarks || '',
    rejectReason: row.reject_reason || '',
    completedAt: row.completed_at ? row.completed_at.toISOString() : '',
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
    type: row.task_type,
    taskType: row.task_type,
    typeLabel: row.type_label || row.task_type,
    customTypeName: row.custom_type_name || '',
    taskNumber: row.task_number,
    taskKey: row.task_key,
    milestone: row.milestone_id || '',
    isBacklog: Boolean(row.is_backlog),
    parentTask: row.parent_task_id || '',
    issueNumber: row.issue_number,
    severity: row.severity || '',
    foundInVersion: row.found_in_version || '',
    fixedInVersion: row.fixed_in_version || '',
    targetRelease: row.target_release_id || '',
    sprint: row.sprint_id || '',
    reopenedCount: row.reopened_count || 0,
    resolvedAt: row.resolved_at ? row.resolved_at.toISOString() : '',
    comments: [],
    activity: [],
    timeLogs: [],
    attachments: []
  };
}

async function addTaskChildren(items) {
  if (!items.length) return items;
  const ids = items.map((item) => item._id);
  const [comments, activity, timeEntries, attachments] = await Promise.all([
    pool.query('SELECT * FROM public.comments WHERE work_item_id=ANY($1::text[]) ORDER BY created_at,id', [ids]),
    pool.query('SELECT * FROM public.activity_log WHERE work_item_id=ANY($1::text[]) ORDER BY created_at,id', [ids]),
    pool.query('SELECT * FROM public.time_entries WHERE work_item_id=ANY($1::text[]) ORDER BY created_at,id', [ids]),
    pool.query('SELECT * FROM public.attachments WHERE work_item_id=ANY($1::text[]) ORDER BY created_at,id', [ids])
  ]);
  for (const item of items) {
    item.comments = comments.rows.filter((row) => row.work_item_id === item._id).map((row) => ({
      _id: row.id, author: row.author_user_id, text: row.body_text,
      createdAt: row.created_at.toISOString(), updatedAt: row.updated_at.toISOString()
    }));
    item.activity = activity.rows.filter((row) => row.work_item_id === item._id).map((row) => ({
      _id: row.id, user: row.actor_user_id || '', action: row.action,
      details: row.details || '', createdAt: row.created_at.toISOString()
    }));
    item.timeLogs = timeEntries.rows.filter((row) => row.work_item_id === item._id).map((row) => ({
      _id: row.id, user: row.user_id, hours: Number(row.hours), note: row.note || '',
      date: row.work_date ? String(row.work_date).slice(0, 10) : '', createdAt: row.created_at.toISOString()
    }));
    item.attachments = attachments.rows.filter((row) => row.work_item_id === item._id).map((row) => ({
      _id: row.id, filename: row.filename, path: row.storage_key,
      uploadedBy: row.uploaded_by_user_id, createdAt: row.created_at.toISOString(),
      size: Number(row.size_bytes), mime: row.mime || ''
    }));
  }
  return items;
}

function sortExpression(sort = 'createdAt', order = 'desc') {
  const columns = {
    createdAt:'w.created_at', updatedAt:'w.updated_at', dueDate:'w.due_date',
    title:'w.title', status:'w.status', priority:'w.priority'
  };
  return `${columns[sort] || columns.createdAt} ${String(order).toLowerCase() === 'asc' ? 'ASC' : 'DESC'} NULLS LAST, w.id`;
}

async function queryTasks(user, query = {}, options = {}) {
  const where = buildTaskWhere(user, query);
  const count = await pool.query(
    `SELECT count(*)::int AS total
     FROM public.work_items w
     JOIN public.tasks t ON t.work_item_id=w.id
     LEFT JOIN public.work_types wt ON wt.value=t.task_type
     WHERE ${where.clause}`,
    where.values
  );
  const pageSize = Math.min(200, Math.max(1, Number(options.limit || query.limit || 50)));
  const page = Math.max(1, Number(options.page || query.page || 1));
  const offset = (page - 1) * pageSize;
  const values = [...where.values, pageSize, offset];
  const { rows } = await pool.query(
    `${taskSelectSql()}
     WHERE ${where.clause}
     ORDER BY ${sortExpression(query.sort, query.order)}
     LIMIT $${values.length - 1} OFFSET $${values.length}`,
    values
  );
  const items = await addTaskChildren(rows.map(mapTask));
  const hydrated = await Promise.all(items.map(hydrateTask));
  return { items:hydrated, total:count.rows[0].total, page, pageSize };
}

async function findVisibleTask(user, taskId) {
  const visibility = buildTaskVisibilityFilter(user, 'w', 2);
  const { rows } = await pool.query(
    `${taskSelectSql()}
     WHERE w.id=$1 AND ${visibility.clause}
     LIMIT 1`,
    [String(taskId), ...visibility.values]
  );
  if (!rows.length) return null;
  const [item] = await addTaskChildren([mapTask(rows[0])]);
  return item;
}

async function findVisibleAttachment(user, attachmentId) {
  const visibility = buildTaskVisibilityFilter(user, 'w', 2);
  const { rows } = await pool.query(
    `SELECT a.*
     FROM public.attachments a
     JOIN public.work_items w ON w.id=a.work_item_id
     JOIN public.tasks t ON t.work_item_id=w.id
     WHERE a.id=$1 AND ${visibility.clause}
     LIMIT 1`,
    [String(attachmentId), ...visibility.values]
  );
  return rows[0] || null;
}

async function queryTaskCounts(user, query = {}) {
  const where = buildTaskWhere(user, query);
  const { rows } = await pool.query(
    `SELECT count(*)::int AS total
     FROM public.work_items w
     JOIN public.tasks t ON t.work_item_id=w.id
     LEFT JOIN public.work_types wt ON wt.value=t.task_type
     WHERE ${where.clause}`,
    where.values
  );
  return rows[0].total;
}

async function queryBusyTaskAssigneeIds(user) {
  const visibility = buildTaskVisibilityFilter(user);
  const { rows } = await pool.query(
    `SELECT DISTINCT w.assignee_user_id
     FROM public.work_items w
     JOIN public.tasks t ON t.work_item_id=w.id
     WHERE ${visibility.clause}
       AND w.assignee_user_id IS NOT NULL
       AND t.is_backlog=false
       AND w.status <> 'Completed'`,
    visibility.values
  );
  return new Set(rows.map((row) => row.assignee_user_id));
}

async function queryTaskDashboard(user, query = {}) {
  const where = buildTaskWhere(user, query);
  const joins = `FROM public.work_items w
    JOIN public.tasks t ON t.work_item_id=w.id
    LEFT JOIN public.work_types wt ON wt.value=t.task_type
    JOIN public.projects p ON p.id=w.project_id`;
  const from = `${joins} WHERE ${where.clause}`;
  const notificationWhere = buildTaskWhere(user, query, 2);
  const [summary, statuses, types, projects, months, recent, deadlines, activity, notifications] = await Promise.all([
    pool.query(`SELECT
      count(*)::int AS total,
      count(*) FILTER (WHERE ${STATUS_GROUP_EXPRESSION}='Open')::int AS open,
      count(*) FILTER (WHERE ${STATUS_GROUP_EXPRESSION}='In Progress')::int AS in_progress,
      count(*) FILTER (WHERE ${STATUS_GROUP_EXPRESSION}='Completed/Closed')::int AS completed,
      count(*) FILTER (WHERE ${STATUS_GROUP_EXPRESSION}='Rejected')::int AS rejected,
      count(*) FILTER (WHERE w.due_date < CURRENT_DATE AND w.status NOT IN ('Completed','Closed','Rejected','Resolved'))::int AS overdue,
      count(*) FILTER (WHERE w.due_date = CURRENT_DATE)::int AS due_today,
      count(DISTINCT w.project_id)::int AS projects
      ${from}`, where.values),
    pool.query(`SELECT ${STATUS_GROUP_EXPRESSION} AS key,
      count(*)::int AS count ${from}
      GROUP BY ${STATUS_GROUP_EXPRESSION}
      ORDER BY count DESC`, where.values),
    pool.query(`SELECT t.task_type AS type,t.custom_type_name AS "customTypeName",
      CASE WHEN t.task_type='other' THEN COALESCE(NULLIF(t.custom_type_name,''),'Other')
           ELSE COALESCE(wt.label,t.task_type) END AS label,
      count(*)::int AS count
      ${from}
      GROUP BY t.task_type,t.custom_type_name,label
      ORDER BY count DESC,label`, where.values),
    pool.query(`SELECT w.project_id AS id,p.name AS label,count(*)::int AS count
      ${from}
      GROUP BY w.project_id,p.name ORDER BY count DESC,p.name`, where.values),
    pool.query(`SELECT to_char(date_trunc('month',w.created_at),'YYYY-MM') AS month,
      count(*)::int AS count
      ${from} GROUP BY date_trunc('month',w.created_at)
      ORDER BY date_trunc('month',w.created_at)`, where.values),
    queryTasks(user, { ...query, sort:'createdAt', order:'desc', limit:8, page:1 }),
    pool.query(`${taskSelectSql()}
      WHERE ${where.clause} AND w.due_date >= CURRENT_DATE
        AND w.status NOT IN ('Completed','Closed','Rejected','Resolved')
      ORDER BY w.due_date ASC,w.id LIMIT 8`, where.values),
    pool.query(`SELECT a.id,a.work_item_id,a.action,a.details,a.created_at,
      u.name AS actor_name,w.title AS task_title,t.task_key
      FROM public.activity_log a
      JOIN public.work_items w ON w.id=a.work_item_id
      JOIN public.tasks t ON t.work_item_id=w.id
      LEFT JOIN public.users u ON u.id=a.actor_user_id
      LEFT JOIN public.work_types wt ON wt.value=t.task_type
      WHERE ${where.clause}
      ORDER BY a.created_at DESC LIMIT 10`, where.values),
    pool.query(`SELECT n.id,n.type,n.details,n.created_at,
      nr.work_item_id AS task_id,w.title AS task_title,t.task_key
      FROM public.notifications n
      JOIN public.notification_resources nr ON nr.notification_id=n.id
      JOIN public.work_items w ON w.id=nr.work_item_id
      JOIN public.tasks t ON t.work_item_id=w.id
      LEFT JOIN public.work_types wt ON wt.value=t.task_type
      WHERE n.recipient_user_id=$1 AND ${notificationWhere.clause}
      ORDER BY n.created_at DESC LIMIT 10`,
      [String(user?._id || ''), ...notificationWhere.values])
  ]);
  const teamView = isAdministrator(user) || isManager(user);
  let workload = [];
  if (teamView) {
    const result = await pool.query(`SELECT w.assignee_user_id AS id,
      COALESCE(u.name,'Unassigned') AS label,count(*)::int AS count
      ${joins} LEFT JOIN public.users u ON u.id=w.assignee_user_id
      WHERE ${where.clause}
      GROUP BY w.assignee_user_id,u.name ORDER BY count DESC,label`, where.values);
    workload = result.rows;
  }
  const recentTasks = recent.items.map((task) => ({
    _id:task._id,title:task.title,status:task.status,type:task.type,
    taskKey:task.taskKey,
    typeLabel:task.typeLabel,customTypeName:task.customTypeName,
    project:task.project,assignee:task.assignee,endDate:task.endDate
  }));
  const upcoming = await addTaskChildren(deadlines.rows.map(mapTask));
  const hydratedDeadlines = await Promise.all(upcoming.map(hydrateTask));
  return {
    summary:summary.rows[0],
    byStatus:statuses.rows,
    byType:types.rows,
    byProject:projects.rows,
    byMonth:months.rows,
    recentTasks,
    upcomingDeadlines:hydratedDeadlines.map((task) => ({
      _id:task._id,title:task.title,status:task.status,endDate:task.endDate,
      taskKey:task.taskKey,
      typeLabel:task.typeLabel,project:task.project,assignee:task.assignee
    })),
    recentActivity:activity.rows,
    notifications:notifications.rows,
    ...(teamView ? { teamWidgets:{ workloadByAssignee:workload } } : {})
  };
}

module.exports = {
  STATUS_GROUPS,
  STATUS_GROUP_EXPRESSION,
  taskSelectSql,
  mapTask,
  addTaskChildren,
  buildTaskWhere,
  queryTasks,
  findVisibleTask,
  findVisibleAttachment,
  queryTaskCounts,
  queryBusyTaskAssigneeIds,
  queryTaskDashboard
};
