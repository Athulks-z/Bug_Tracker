const { once } = require('events');
const ExcelJS = require('exceljs');
const pool = require('../config/db');
const { isAdministrator, isManager } = require('../middleware/roles');
const { buildTaskWhere, sortExpression, STATUS_GROUPS } = require('./taskQueries');

const STATUSES = [
  'Open', 'To do', 'In Progress', 'In progress', 'Blocked', 'Completed',
  'Closed', 'Rejected', 'Code Review', 'QA Testing', 'Reopened'
];
const PRIORITIES = ['Critical', 'High', 'Medium', 'Low'];
const SORT_FIELDS = ['createdAt', 'updatedAt', 'dueDate', 'title', 'status', 'priority'];
const ALLOWED_QUERY_KEYS = new Set([
  'format', 'project', 'status', 'statusGroup', 'assignee', 'user', 'reporter',
  'type', 'customTypeName', 'search', 'priority', 'createdFrom', 'createdTo',
  'startDateFrom', 'startDateTo', 'dueDateFrom', 'dueDateTo', 'department',
  'overdue', 'dueToday', 'sort', 'order', 'page', 'limit'
]);

function requestError(message, status = 400) {
  return Object.assign(new Error(message), { status });
}

function scalar(query, key) {
  const value = query[key];
  if (value === undefined || value === null || value === '') return '';
  if (typeof value !== 'string') throw requestError(`Invalid ${key} filter`);
  return value.trim();
}

function list(query, key) {
  const value = query[key];
  if (value === undefined || value === null || value === '') return [];
  if (!Array.isArray(value) && typeof value !== 'string') throw requestError(`Invalid ${key} filter`);
  const values = Array.isArray(value) ? value : String(value).split(',');
  if (values.some((item) => typeof item !== 'string')) throw requestError(`Invalid ${key} filter`);
  return [...new Set(values.map((item) => item.trim()).filter(Boolean))];
}

function validateDate(value, field) {
  if (!value) return '';
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) throw requestError(`${field} must use YYYY-MM-DD format`);
  const [, year, month, day] = match;
  const parsed = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)));
  if (parsed.getUTCFullYear() !== Number(year)
    || parsed.getUTCMonth() !== Number(month) - 1
    || parsed.getUTCDate() !== Number(day)) {
    throw requestError(`${field} must be a valid date`);
  }
  return value;
}

function validateId(value, field) {
  if (!value) return '';
  if (value.length > 128 || /[\u0000-\u001f]/.test(value)) {
    throw requestError(`Invalid ${field} filter`);
  }
  return value;
}

function assertRoleFilters(user, filters) {
  const privileged = isAdministrator(user) || isManager(user);
  if (filters.department && !isAdministrator(user)) {
    throw requestError('Department filtering is available to administrators only', 403);
  }
  if (privileged) return;

  const userId = String(user?._id || '');
  const userFilters = [
    ...(filters.assignee || []),
    ...(filters.reporter ? [filters.reporter] : [])
  ];
  if (userFilters.some((value) => value !== 'me' && value !== userId)) {
    throw requestError('You can only export tasks filtered to yourself', 403);
  }
}

function normalizeExportRequest(user, query = {}) {
  for (const key of Object.keys(query)) {
    if (!ALLOWED_QUERY_KEYS.has(key)) throw requestError(`Unsupported export filter: ${key}`);
  }
  for (const key of ['page', 'limit']) {
    const value = scalar(query, key);
    if (value && (!/^\d+$/.test(value) || Number(value) < 1)) {
      throw requestError(`${key} must be a positive integer`);
    }
  }

  const format = scalar(query, 'format').toLowerCase() || 'csv';
  if (!['csv', 'xlsx'].includes(format)) throw requestError('Format must be csv or xlsx');
  if (query.user !== undefined && query.assignee !== undefined) {
    throw requestError('Use either the user or assignee filter, not both');
  }
  const hasUserAlias = query.user !== undefined;
  const assignee = list(query, hasUserAlias ? 'user' : 'assignee')
    .map((value) => validateId(value, 'assignee'));
  const reporter = validateId(scalar(query, 'reporter'), 'reporter');
  const project = validateId(scalar(query, 'project'), 'project');
  const department = validateId(scalar(query, 'department'), 'department');
  const status = scalar(query, 'status');
  const statusGroup = scalar(query, 'statusGroup');
  const priority = scalar(query, 'priority');
  const sort = scalar(query, 'sort') || 'createdAt';
  const order = (scalar(query, 'order') || 'desc').toLowerCase();
  const types = list(query, 'type').map((value) => validateId(value, 'type'));
  const customTypeName = scalar(query, 'customTypeName');
  const search = scalar(query, 'search');
  const overdue = scalar(query, 'overdue');
  const dueToday = scalar(query, 'dueToday');
  const dateFilters = {
    createdFrom: validateDate(scalar(query, 'createdFrom'), 'createdFrom'),
    createdTo: validateDate(scalar(query, 'createdTo'), 'createdTo'),
    startDateFrom: validateDate(scalar(query, 'startDateFrom'), 'startDateFrom'),
    startDateTo: validateDate(scalar(query, 'startDateTo'), 'startDateTo'),
    dueDateFrom: validateDate(scalar(query, 'dueDateFrom'), 'dueDateFrom'),
    dueDateTo: validateDate(scalar(query, 'dueDateTo'), 'dueDateTo')
  };

  if (status && !STATUSES.includes(status)) throw requestError('Invalid status filter');
  if (statusGroup && !STATUS_GROUPS.includes(statusGroup)) throw requestError('Invalid status group filter');
  if (priority && !PRIORITIES.includes(priority)) throw requestError('Invalid priority filter');
  if (!SORT_FIELDS.includes(sort)) throw requestError('Invalid sort field');
  if (!['asc', 'desc'].includes(order)) throw requestError('Sort order must be asc or desc');
  if (types.length > 20) throw requestError('A maximum of 20 task types can be selected');
  if (customTypeName.length > 100) throw requestError('Custom type name is too long');
  if (search.length > 200) throw requestError('Search text is too long');
  if (!['', 'true', 'false'].includes(overdue) || !['', 'true', 'false'].includes(dueToday)) {
    throw requestError('Date shortcut filters must be true or false');
  }
  for (const [fromKey, toKey] of [
    ['createdFrom', 'createdTo'],
    ['startDateFrom', 'startDateTo'],
    ['dueDateFrom', 'dueDateTo']
  ]) {
    if (dateFilters[fromKey] && dateFilters[toKey] && dateFilters[fromKey] > dateFilters[toKey]) {
      throw requestError(`${fromKey} must not be after ${toKey}`);
    }
  }

  const filters = {
    project,
    status,
    statusGroup,
    assignee,
    reporter,
    type: types,
    customTypeName,
    search,
    priority,
    ...dateFilters,
    department,
    overdue,
    dueToday
  };
  assertRoleFilters(user, filters);
  return { format, filters, sort, order };
}

async function validateExistingFilters(db, request) {
  const { filters } = request;
  const typeLabels = new Map();
  const names = { assignees: new Map(), project: '', department: '' };
  const userIds = [...new Set([
    ...filters.assignee.filter((value) => value !== 'me'),
    ...(filters.reporter && filters.reporter !== 'me' ? [filters.reporter] : [])
  ])];
  const lookups = [];
  if (filters.project) {
    lookups.push(db.query('SELECT id,name FROM public.projects WHERE id=$1', [filters.project])
      .then(({ rows }) => {
        if (!rows.length) throw requestError('Invalid project filter');
        names.project = rows[0].name;
      }));
  }
  if (userIds.length) {
    lookups.push(db.query('SELECT id,name FROM public.users WHERE id=ANY($1::text[])', [userIds])
      .then(({ rows }) => {
        if (rows.length !== userIds.length) throw requestError('Invalid user filter');
        rows.forEach((row) => names.assignees.set(row.id, row.name));
      }));
  }
  if (filters.department) {
    lookups.push(db.query('SELECT id,name FROM public.departments WHERE id=$1', [filters.department])
      .then(({ rows }) => {
        if (!rows.length) throw requestError('Invalid department filter');
        names.department = rows[0].name;
      }));
  }
  if (filters.type.length) {
    lookups.push(db.query(
      `SELECT wt.value,wt.label
       FROM public.work_types wt
       JOIN public.work_type_kinds wtk ON wtk.type_value=wt.value
       WHERE wt.value=ANY($1::text[]) AND wt.active=true AND wtk.kind='task'`,
      [filters.type]
    ).then(({ rows }) => {
      if (rows.length !== filters.type.length) throw requestError('Invalid task type filter');
      rows.forEach((row) => typeLabels.set(row.value, row.label));
    }));
  }
  await Promise.all(lookups);
  return {
    typeLabels: filters.type.map((value) => typeLabels.get(value)),
    names: {
      ...names,
      assignees: names.assignees,
      reporter: filters.reporter === 'me'
        ? 'Me'
        : names.assignees.get(filters.reporter) || ''
    }
  };
}

async function validateExportRequest(user, query, db = pool) {
  const request = normalizeExportRequest(user, query);
  request.userId = String(user?._id || '');
  request.lookups = await validateExistingFilters(db, request);
  return request;
}

function dateParts(value, timezone) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23'
  }).formatToParts(value);
  return Object.fromEntries(parts.map(({ type, value: part }) => [type, part]));
}

function buildExportFilename(typeLabels, format, now = new Date(), timezone = 'Asia/Kolkata') {
  const typeName = typeLabels.length
    ? typeLabels.map((label) => String(label).replace(/[^A-Za-z0-9]+/g, '-').replace(/^-|-$/g, ''))
      .filter(Boolean).join('-') || 'All'
    : 'All';
  const parts = dateParts(now, timezone);
  return `TaskTracker_${typeName}_${parts.year}-${parts.month}-${parts.day}_${parts.hour}-${parts.minute}.${format}`;
}

function formatDateTime(value, timezone) {
  if (!value) return '';
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)) return `${value} 00:00`;
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const parts = dateParts(date, timezone);
  return `${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute}`;
}

function plainDescription(value) {
  return String(value || '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li|h[1-6])\s*>/gi, '\n')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .trim();
}

function protectFormula(value) {
  const text = String(value == null ? '' : value);
  return /^[=+\-@\t\r]/.test(text) ? `'${text}` : text;
}

function escapeCsv(value) {
  return `"${protectFormula(value).replace(/"/g, '""')}"`;
}

function ensureRowLimit(rowCount, maxRows) {
  if (rowCount > maxRows) {
    throw requestError(
      `Export exceeds the ${maxRows.toLocaleString()} row limit. Narrow your filters and try again.`,
      413
    );
  }
}

function exportColumns(user) {
  const columns = [
    { key: 'taskId', header: 'Task ID', width: 22 },
    { key: 'title', header: 'Title', width: 40 },
    { key: 'description', header: 'Description', width: 60 },
    { key: 'type', header: 'Type', width: 20 },
    { key: 'status', header: 'Status', width: 18 },
    { key: 'priority', header: 'Priority', width: 14 },
    { key: 'assignee', header: 'Assigned To', width: 24 },
    { key: 'creator', header: 'Created By', width: 24 },
    { key: 'createdAt', header: 'Created Date', width: 20 },
    { key: 'dueDate', header: 'Due Date', width: 20 },
    { key: 'completedAt', header: 'Completed Date', width: 20 },
    { key: 'updatedAt', header: 'Last Updated', width: 20 }
  ];
  if (isAdministrator(user)) columns.push({ key: 'department', header: 'Department', width: 24 });
  return columns;
}

function exportRow(row, columns, timezone) {
  const values = {
    taskId: row.task_key || row.id,
    title: row.title,
    description: plainDescription(row.description_text || row.description_html),
    type: row.task_type === 'other'
      ? (row.custom_type_name || 'Other')
      : (row.type_label || row.task_type),
    status: row.status,
    priority: row.priority,
    assignee: row.assignee_name,
    creator: row.creator_name,
    createdAt: formatDateTime(row.created_at, timezone),
    dueDate: formatDateTime(row.due_date, timezone),
    completedAt: formatDateTime(row.completed_at, timezone),
    updatedAt: formatDateTime(row.updated_at, timezone),
    department: row.department_name
  };
  return columns.map((column) => protectFormula(values[column.key]));
}

function filterSummary(request, user, timezone, now) {
  const filters = request.filters;
  const names = request.lookups.names;
  const displayValue = (value) => value || 'All';
  const selectedAssignees = filters.assignee.map((value) => {
    if (value === 'me') return user.name || 'Me';
    return names.assignees.get(value) || value;
  });
  return [
    ['Filters applied', ''],
    ['Project', displayValue(names.project)],
    ['Status', displayValue(filters.status)],
    ['Status group', displayValue(filters.statusGroup)],
    ['Type', displayValue(request.lookups.typeLabels.join(', '))],
    ['Custom type', displayValue(filters.customTypeName)],
    ['Priority', displayValue(filters.priority)],
    ['Assignee', displayValue(selectedAssignees.join(', '))],
    ['Created by', displayValue(names.reporter)],
    ['Department', displayValue(names.department)],
    ['Search', displayValue(filters.search)],
    ['Overdue only', filters.overdue === 'true' ? 'Yes' : 'All'],
    ['Due today', filters.dueToday === 'true' ? 'Yes' : 'All'],
    ['Created date range', [filters.createdFrom, filters.createdTo].filter(Boolean).join(' to ') || 'All'],
    ['Start date range', [filters.startDateFrom, filters.startDateTo].filter(Boolean).join(' to ') || 'All'],
    ['Due date range', [filters.dueDateFrom, filters.dueDateTo].filter(Boolean).join(' to ') || 'All'],
    ['Sort', `${request.sort} ${request.order}`],
    ['Exported by', user.name || user.email || user._id],
    ['Exported at', formatDateTime(now, timezone)]
  ];
}

function taskExportFromSql() {
  return `FROM public.work_items w
    JOIN public.tasks t ON t.work_item_id=w.id
    JOIN public.projects p ON p.id=w.project_id
    LEFT JOIN public.work_types wt ON wt.value=t.task_type
    LEFT JOIN public.users assignee ON assignee.id=w.assignee_user_id
    LEFT JOIN public.users creator ON creator.id=w.reporter_user_id
    LEFT JOIN public.departments d ON d.id=p.owning_department_id`;
}

async function countExportRows(db, where) {
  const { rows } = await db.query(
    `SELECT count(*)::int AS total
     FROM public.work_items w
     JOIN public.tasks t ON t.work_item_id=w.id
     LEFT JOIN public.work_types wt ON wt.value=t.task_type
     WHERE ${where.clause}`,
    where.values
  );
  return rows[0].total;
}

async function fetchExportBatch(db, where, sort, order, offset, limit) {
  const values = [...where.values, limit, offset];
  return db.query(
    `SELECT w.id,w.title,w.description_text,w.description_html,w.status,w.priority,
      w.due_date,w.completed_at,w.created_at,w.updated_at,
      w.assignee_user_id,w.reporter_user_id,
      assignee.name AS assignee_name,creator.name AS creator_name,d.name AS department_name,
      t.task_type,t.custom_type_name,t.task_key,wt.label AS type_label
     ${taskExportFromSql()}
     WHERE ${where.clause}
     ORDER BY ${sortExpression(sort, order)}
     LIMIT $${values.length - 1} OFFSET $${values.length}`,
    values
  );
}

async function writeWithBackpressure(res, chunk) {
  if (res.destroyed) throw new Error('Export response was closed by the client');
  if (res.write(chunk)) return;
  await new Promise((resolve, reject) => {
    const cleanup = () => {
      res.removeListener('drain', onDrain);
      res.removeListener('error', onError);
      res.removeListener('close', onClose);
    };
    const onDrain = () => { cleanup(); resolve(); };
    const onError = (error) => { cleanup(); reject(error); };
    const onClose = () => { cleanup(); reject(new Error('Export response was closed by the client')); };
    res.once('drain', onDrain);
    res.once('error', onError);
    res.once('close', onClose);
  });
}

async function streamCsv({ db, res, where, request, columns, timezone, rowCount }) {
  const header = columns.map((column) => escapeCsv(column.header)).join(',');
  await writeWithBackpressure(res, `\uFEFF${header}\r\n`);
  for (let offset = 0; offset < rowCount; offset += 500) {
    const { rows } = await fetchExportBatch(db, where, request.sort, request.order, offset, Math.min(500, rowCount - offset));
    if (!rows.length) break;
    for (const row of rows) {
      await writeWithBackpressure(res, `${exportRow(row, columns, timezone).map(escapeCsv).join(',')}\r\n`);
    }
  }
  res.end();
}

async function streamXlsx({ db, res, where, request, columns, timezone, rowCount, user, now }) {
  const workbook = new ExcelJS.stream.xlsx.WorkbookWriter({
    stream: res,
    useStyles: true,
    useSharedStrings: true
  });
  const summary = filterSummary(request, user, timezone, now);
  const headerRowNumber = summary.length + 2;
  const worksheet = workbook.addWorksheet('Tasks', {
    views: [{ state: 'frozen', ySplit: headerRowNumber }],
    autoFilter: {
      from: { row: headerRowNumber, column: 1 },
      to: { row: headerRowNumber, column: columns.length }
    }
  });
  worksheet.columns = columns.map(({ key, width }) => ({ key, width }));
  const titleRow = worksheet.addRow(['Filters applied']);
  titleRow.font = { bold: true, size: 14 };
  titleRow.commit();
  summary.slice(1).forEach(([label, value]) => {
    worksheet.addRow([label, protectFormula(value)]).commit();
  });
  worksheet.addRow([]).commit();
  const headerRow = worksheet.addRow(columns.map((column) => column.header));
  headerRow.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  headerRow.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1F4E78' } };
  headerRow.commit();

  for (let offset = 0; offset < rowCount; offset += 500) {
    const { rows } = await fetchExportBatch(db, where, request.sort, request.order, offset, Math.min(500, rowCount - offset));
    if (!rows.length) break;
    rows.forEach((row) => worksheet.addRow(exportRow(row, columns, timezone)).commit());
  }
  worksheet.commit();
  await workbook.commit();
}

async function logExport(db, req, user, request, rowCount, timezone) {
  await db.query(
    `INSERT INTO public.audit_log
      (actor_user_id,actor_snapshot,action,resource_type,resource_snapshot,after,ip,user_agent)
     VALUES ($1,$2::jsonb,'exported','task_export',$3::jsonb,$4::jsonb,$5,$6)`,
    [
      String(user._id),
      JSON.stringify({ name: user.name || '', email: user.email || '', role: user.role || '' }),
      JSON.stringify({ format: request.format, rowCount }),
      JSON.stringify({
        filters: request.filters,
        sort: request.sort,
        order: request.order,
        format: request.format,
        rowCount,
        timezone
      }),
      req.ip || null,
      req.get('user-agent') || null
    ]
  );
}

module.exports = {
  normalizeExportRequest,
  assertRoleFilters,
  validateExportRequest,
  buildExportFilename,
  formatDateTime,
  protectFormula,
  escapeCsv,
  ensureRowLimit,
  exportColumns,
  exportRow,
  filterSummary,
  countExportRows,
  fetchExportBatch,
  streamCsv,
  streamXlsx,
  logExport
};
