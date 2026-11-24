const test = require('node:test');
const assert = require('node:assert/strict');
const { buildTaskVisibilityFilter } = require('./taskVisibility');
const { buildTaskWhere } = require('../services/taskQueries');

test('task visibility SQL is parameterized for employee and trainee roles', () => {
  for (const role of ['employee','trainee']) {
    const filter = buildTaskVisibilityFilter({ _id:'user-1', role });
    assert.deepEqual(filter, {
      clause:'w.assignee_user_id = $1',
      values:['user-1']
    });
  }
});

test('manager and administrator task visibility is unrestricted', () => {
  for (const role of ['manager','admin','super_admin']) {
    assert.deepEqual(buildTaskVisibilityFilter({ _id:'user-1', role }), {
      clause:'TRUE',
      values:[]
    });
  }
});

test('task filters compose after the role condition without changing its parameter', () => {
  const filter = buildTaskWhere(
    { _id:'employee-1', role:'employee' },
    { type:['bug','other'], statusGroup:'Rejected', assignee:['employee-1'], search:'safety' }
  );
  assert.match(filter.clause, /w\.assignee_user_id = \$1/);
  assert.match(filter.clause, /t\.task_type = ANY\(\$2::text\[\]\)/);
  assert.match(filter.clause, /CASE[\s\S]*ELSE 'Open' END = \$3/);
  assert.match(filter.clause, /w\.assignee_user_id = ANY\(\$4::text\[\]\)/);
  assert.match(filter.clause, /w\.title ILIKE \$5/);
  assert.deepEqual(filter.values, [
    'employee-1',
    ['bug','other'],
    'Rejected',
    ['employee-1'],
    '%safety%'
  ]);
});

test('dashboard notification filters reserve the recipient parameter', () => {
  const filter = buildTaskWhere(
    { _id:'employee-1', role:'employee' },
    { project:'project-1', type:'other' },
    2
  );
  assert.match(filter.clause, /w\.assignee_user_id = \$2/);
  assert.match(filter.clause, /w\.project_id = \$3/);
  assert.match(filter.clause, /t\.task_type = ANY\(\$4::text\[\]\)/);
  assert.deepEqual(filter.values, ['employee-1','project-1',['other']]);
});
