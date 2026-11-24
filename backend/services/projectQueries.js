const pool = require('../config/db');
const { buildProjectVisibilityFilter } = require('../middleware/projectVisibility');
const { buildTaskVisibilityFilter } = require('../middleware/taskVisibility');
const { isAdministrator, isManager } = require('../middleware/roles');
const { dateOnly } = require('../utils/dateOnly');
const { hydrateTask } = require('./data');
const { addTaskChildren, mapTask, taskSelectSql } = require('./taskQueries');

const CHART_COLORS = [
  '#0072B2','#E69F00','#009E73','#CC79A7','#56B4E9','#D55E00','#332288','#88CCEE',
  '#117733','#AA4499','#44AA99','#999933','#882255','#661100','#6699CC','#AA6E28'
];

function projectListWhere(user, query = {}) {
  const visibility = buildProjectVisibilityFilter(user, 'p');
  const clauses = [visibility.clause];
  const values = [...visibility.values];
  if (query.search) {
    values.push(`%${String(query.search).trim().replace(/[\\%_]/g, '\\$&')}%`);
    clauses.push(`(p.name ILIKE $${values.length} ESCAPE '\\' OR p.key ILIKE $${values.length} ESCAPE '\\')`);
  }
  if (query.status) {
    values.push(query.status === 'in_progress' ? 'active' : query.status);
    clauses.push(`p.status=$${values.length}`);
  }
  if (String(query.excludeClosed).toLowerCase() === 'true') {
    clauses.push("p.status <> 'closed'");
  }
  return { clause:clauses.join(' AND '), values };
}

async function queryVisibleProjects(user, query = {}) {
  const where = projectListWhere(user, query);
  const sortColumns = { name:'p.name', createdAt:'p.created_at', status:'p.status' };
  const sortColumn = sortColumns[query.sort] || 'p.created_at';
  const direction = String(query.order).toLowerCase() === 'asc' ? 'ASC' : 'DESC';
  const requestedLimit = Number(query.limit || 100);
  const requestedPage = Number(query.page || 1);
  const limit = Number.isSafeInteger(requestedLimit) ? Math.min(200, Math.max(1, requestedLimit)) : 100;
  const page = Number.isSafeInteger(requestedPage) ? Math.max(1, requestedPage) : 1;
  const { rows } = await pool.query(
    `SELECT p.id
     FROM public.projects p
     WHERE ${where.clause}
     ORDER BY ${sortColumn} ${direction}, p.id
     LIMIT $${where.values.length + 1} OFFSET $${where.values.length + 2}`,
    [...where.values, limit, (page - 1) * limit]
  );
  const count = await pool.query(
    `SELECT count(*)::int AS total FROM public.projects p WHERE ${where.clause}`,
    where.values
  );
  return { ids:rows.map((row) => row.id), total:count.rows[0].total };
}

async function findVisibleProject(user, projectId) {
  const visibility = buildProjectVisibilityFilter(user, 'p', 2);
  const { rows } = await pool.query(
    `SELECT p.id FROM public.projects p WHERE p.id=$1 AND ${visibility.clause} LIMIT 1`,
    [String(projectId), ...visibility.values]
  );
  return rows.length > 0;
}

function stableColor(userId) {
  let hash = 0;
  for (const char of String(userId)) hash = ((hash * 31) + char.charCodeAt(0)) >>> 0;
  return CHART_COLORS[hash % CHART_COLORS.length];
}

async function projectProgress(user, projectId) {
  const visibility = buildTaskVisibilityFilter(user, 'w', 2);
  const [milestones, overall, workload] = await Promise.all([
    pool.query(
      `SELECT m.id,m.name,m.sort_order,m.due_date,m.owner_user_id,u.name AS owner_name,
        count(w.id)::int AS total,
        count(w.id) FILTER (WHERE w.status IN ('Completed','Closed','Resolved'))::int AS completed
       FROM public.milestones m
       LEFT JOIN public.users u ON u.id=m.owner_user_id
       LEFT JOIN public.work_items w ON w.milestone_id=m.id
         AND w.project_id=m.project_id
         AND w.status <> 'Rejected'
         AND ${visibility.clause}
       LEFT JOIN public.tasks t ON t.work_item_id=w.id AND t.is_backlog=false
       WHERE m.project_id=$1
         AND (w.id IS NULL OR t.work_item_id IS NOT NULL)
       GROUP BY m.id,m.name,m.sort_order,m.due_date,m.owner_user_id,u.name
       ORDER BY m.sort_order,m.created_at,m.id`,
      [String(projectId), ...visibility.values]
    ),
    pool.query(
      `SELECT count(*)::int AS total,
        count(*) FILTER (WHERE w.status IN ('Completed','Closed','Resolved'))::int AS completed
       FROM public.work_items w
       JOIN public.tasks t ON t.work_item_id=w.id
       WHERE w.project_id=$1 AND t.is_backlog=false AND w.status <> 'Rejected'
         AND ${visibility.clause}`,
      [String(projectId), ...visibility.values]
    ),
    pool.query(
      `SELECT u.id AS user_id,u.name,
        count(*)::int AS total,
        count(*) FILTER (WHERE w.status IN ('Completed','Closed','Resolved'))::int AS finished
       FROM public.work_items w
       JOIN public.tasks t ON t.work_item_id=w.id
       JOIN public.users u ON u.id=w.assignee_user_id
       WHERE w.project_id=$1 AND t.is_backlog=false AND w.status <> 'Rejected'
         AND ${visibility.clause}
       GROUP BY u.id,u.name ORDER BY u.name,u.id`,
      [String(projectId), ...visibility.values]
    )
  ]);
  const total = overall.rows[0].total;
  const completed = overall.rows[0].completed;
  const teamView = isAdministrator(user) || isManager(user);
  const members = workload.rows.map((row) => {
    const finished = row.finished;
    const memberTotal = row.total;
    return {
      userId:row.user_id,
      name:row.name,
      color:stableColor(row.user_id),
      total:memberTotal,
      finished,
      pending:memberTotal - finished
    };
  });
  return {
    overall:{ total, completed, percentage:total ? Math.round((completed / total) * 100) : 0 },
    milestones:milestones.rows.map((row) => ({
      id:row.id,
      name:row.name,
      dueDate:dateOnly(row.due_date),
      owner:row.owner_user_id || '',
      ownerName:row.owner_name || '',
      total:row.total,
      completed:row.completed,
      percentage:row.total ? Math.round((row.completed / row.total) * 100) : 0
    })),
    ...(teamView || members.length ? { taskDistribution:members } : { taskDistribution:[] })
  };
}

async function listProjectBacklog(user, projectId) {
  const visible = await findVisibleProject(user, projectId);
  if (!visible) return null;
  const { rows } = await pool.query(
    `${taskSelectSql()}
     WHERE w.project_id=$1 AND t.is_backlog=true
     ORDER BY w.created_at DESC,w.id`,
    [String(projectId)]
  );
  const items = await addTaskChildren(rows.map(mapTask));
  return Promise.all(items.map(hydrateTask));
}

module.exports = {
  projectListWhere,
  queryVisibleProjects,
  findVisibleProject,
  projectProgress,
  listProjectBacklog
};
