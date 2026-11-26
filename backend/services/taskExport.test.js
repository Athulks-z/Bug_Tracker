const test = require('node:test');
const assert = require('node:assert/strict');
const { once } = require('events');
const { PassThrough } = require('stream');
const ExcelJS = require('exceljs');
const {
  normalizeExportRequest,
  buildExportFilename,
  formatDateTime,
  protectFormula,
  escapeCsv,
  ensureRowLimit,
  exportColumns,
  exportRow,
  streamCsv,
  streamXlsx
} = require('./taskExport');
const { buildTaskWhere } = require('./taskQueries');

const admin = { _id: 'admin-1', name: 'Admin User', role: 'admin' };

test('task export applies validated list and admin filters to the shared task query', () => {
  const request = normalizeExportRequest(admin, {
    project: 'project-1',
    status: 'In Progress',
    statusGroup: 'In Progress',
    type: ['bug', 'feature'],
    assignee: ['employee-1'],
    priority: 'High',
    search: 'crash, on save',
    createdFrom: '2026-01-01',
    createdTo: '2026-01-31',
    dueDateFrom: '2026-02-01',
    department: 'department-1',
    sort: 'priority',
    order: 'asc',
    format: 'csv'
  });
  const where = buildTaskWhere(admin, {
    ...request.filters,
    exportTimezone: 'Asia/Kolkata'
  });

  assert.match(where.clause, /w\.project_id =/);
  assert.match(where.clause, /w\.status =/);
  assert.match(where.clause, /t\.task_type = ANY/);
  assert.match(where.clause, /w\.assignee_user_id = ANY/);
  assert.match(where.clause, /w\.priority =/);
  assert.match(where.clause, /w\.created_at >=/);
  assert.match(where.clause, /w\.created_at </);
  assert.match(where.clause, /w\.due_date >=/);
  assert.match(where.clause, /export_department\.department_id=/);
  assert.ok(where.values.includes('project-1'));
  assert.ok(where.values.some((value) => Array.isArray(value) && value.includes('employee-1')));
  assert.ok(where.values.includes('2026-01-01'));
  assert.ok(where.values.includes('2026-01-31'));
  assert.ok(where.values.includes('Asia/Kolkata'));
  assert.deepEqual(request.filters.type, ['bug', 'feature']);
});

test('normal users cannot request another user in assignee or reporter filters', () => {
  const employee = { _id: 'employee-1', role: 'employee' };
  assert.throws(
    () => normalizeExportRequest(employee, { assignee: 'employee-2' }),
    (error) => error.status === 403
  );
  assert.throws(
    () => normalizeExportRequest(employee, { reporter: 'employee-2' }),
    (error) => error.status === 403
  );
  assert.doesNotThrow(() => normalizeExportRequest(employee, { assignee: 'me' }));
});

test('admin can filter by a selected user/assignee', () => {
  const request = normalizeExportRequest(admin, { user: 'employee-2' });
  const where = buildTaskWhere(admin, request.filters);
  assert.match(where.clause, /w\.assignee_user_id = ANY/);
  assert.ok(where.values.some((value) => Array.isArray(value) && value.includes('employee-2')));
});

test('export filenames use selected type labels and configured timezone', () => {
  const timestamp = new Date('2026-11-26T09:05:00.000Z');
  assert.equal(
    buildExportFilename(['Bug / Fix'], 'csv', timestamp, 'Asia/Kolkata'),
    'TaskTracker_Bug-Fix_2026-11-26_14-35.csv'
  );
  assert.equal(
    buildExportFilename(['Bug', 'Feature'], 'xlsx', timestamp, 'Asia/Kolkata'),
    'TaskTracker_Bug-Feature_2026-11-26_14-35.xlsx'
  );
  assert.equal(
    buildExportFilename([], 'csv', timestamp, 'Asia/Kolkata'),
    'TaskTracker_All_2026-11-26_14-35.csv'
  );
});

test('CSV escaping and formula protection cover unsafe values', () => {
  assert.equal(protectFormula('=1+1'), "'=1+1");
  assert.equal(protectFormula('+SUM(A1)'), "'+SUM(A1)");
  assert.equal(protectFormula('-2'), "'-2");
  assert.equal(protectFormula('@value'), "'@value");
  assert.equal(protectFormula('\tvalue'), "'\tvalue");
  assert.equal(protectFormula('\rvalue'), "'\rvalue");
  assert.equal(escapeCsv('a,"b"\nc'), '"a,""b""\nc"');
  assert.equal(escapeCsv('=1+1'), `"'=1+1"`);
});

test('export row limit rejects results above the configured maximum', () => {
  assert.doesNotThrow(() => ensureRowLimit(50000, 50000));
  assert.throws(
    () => ensureRowLimit(50001, 50000),
    (error) => error.status === 413 && /Narrow your filters/.test(error.message)
  );
});

test('export rows use timezone-formatted dates and include requested task columns', () => {
  const columns = exportColumns({ role: 'employee' });
  const values = exportRow({
    id: 'item-1',
    task_key: 'TASK-12',
    title: 'Example',
    description_text: '<p>Details &amp; notes</p>',
    task_type: 'bug',
    type_label: 'Bug',
    status: 'To do',
    priority: 'Medium',
    assignee_name: 'Employee',
    creator_name: 'Reporter',
    created_at: new Date('2026-11-26T09:05:00.000Z'),
    due_date: '2026-11-27',
    completed_at: null,
    updated_at: new Date('2026-11-26T09:10:00.000Z')
  }, columns, 'Asia/Kolkata');

  assert.deepEqual(columns.map((column) => column.header), [
    'Task ID', 'Title', 'Description', 'Type', 'Status', 'Priority',
    'Assigned To', 'Created By', 'Created Date', 'Due Date',
    'Completed Date', 'Last Updated'
  ]);
  assert.equal(values[0], 'TASK-12');
  assert.equal(values[2], 'Details & notes');
  assert.equal(values[8], '2026-11-26 14:35');
  assert.equal(values[9], '2026-11-27 00:00');
  assert.equal(values[10], '');
  assert.equal(formatDateTime(null, 'Asia/Kolkata'), '');
});

test('CSV and streaming XLSX responses produce readable files', async () => {
  const taskRow = {
    id: 'item-1',
    task_key: 'TASK-1',
    title: 'A title, with comma',
    description_text: 'Details',
    task_type: 'bug',
    type_label: 'Bug',
    status: 'To do',
    priority: 'High',
    assignee_name: 'Employee',
    creator_name: 'Reporter',
    created_at: new Date('2026-11-26T09:05:00.000Z'),
    due_date: null,
    completed_at: null,
    updated_at: new Date('2026-11-26T09:10:00.000Z'),
    department_name: ''
  };
  const db = { query: async () => ({ rows: [taskRow] }) };
  const where = { clause: 'TRUE', values: [] };
  const request = normalizeExportRequest(admin, {});
  request.lookups = {
    typeLabels: [],
    names: { assignees: new Map(), project: '', department: '', reporter: '' }
  };

  const csvResponse = new PassThrough();
  const csvChunks = [];
  csvResponse.on('data', (chunk) => csvChunks.push(chunk));
  const csvEnded = once(csvResponse, 'end');
  await streamCsv({
    db, res: csvResponse, where, request, columns: exportColumns(admin),
    timezone: 'Asia/Kolkata', rowCount: 1
  });
  await csvEnded;
  const csv = Buffer.concat(csvChunks).toString('utf8');
  assert.ok(csv.startsWith('\uFEFF'));
  assert.match(csv, /"A title, with comma"/);
  assert.match(csv, /TASK-1/);

  const xlsxResponse = new PassThrough();
  const xlsxChunks = [];
  xlsxResponse.on('data', (chunk) => xlsxChunks.push(chunk));
  const xlsxEnded = once(xlsxResponse, 'end');
  await streamXlsx({
    db, res: xlsxResponse, where, request, columns: exportColumns(admin),
    timezone: 'Asia/Kolkata', rowCount: 1, user: admin,
    now: new Date('2026-11-26T09:05:00.000Z')
  });
  await xlsxEnded;
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(Buffer.concat(xlsxChunks));
  const worksheet = workbook.getWorksheet('Tasks');
  assert.equal(worksheet.getCell('A1').value, 'Filters applied');
  const filterRange = worksheet.autoFilter;
  assert.ok(filterRange);
  const headerRow = typeof filterRange === 'string'
    ? Number(/^A(\d+):/.exec(filterRange)?.[1])
    : filterRange.from.row;
  assert.equal(worksheet.getCell(headerRow, 1).value, 'Task ID');
  assert.equal(worksheet.getCell(headerRow + 1, 1).value, 'TASK-1');
  assert.equal(worksheet.views[0].state, 'frozen');
  assert.equal(worksheet.views[0].ySplit, headerRow);
  assert.equal(worksheet.getRow(headerRow).getCell(1).font.bold, true);
});
