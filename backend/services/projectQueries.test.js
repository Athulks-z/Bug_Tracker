const test = require('node:test');
const assert = require('node:assert/strict');
const { projectListWhere } = require('./projectQueries');

test('project list query combines role visibility and escaped search parameters', () => {
  const where = projectListWhere(
    { _id:'employee-1',role:'employee' },
    { search:'OPS%_team',status:'in_progress' }
  );
  assert.match(where.clause, /p\.owner_user_id=\$1/);
  assert.match(where.clause, /public\.project_members/);
  assert.match(where.clause, /public\.project_stakeholders/);
  assert.match(where.clause, /p\.name ILIKE \$2/);
  assert.match(where.clause, /p\.status=\$3/);
  assert.deepEqual(where.values, ['employee-1','%OPS\\%\\_team%','active']);
});

test('administrator and manager project list queries are unrestricted', () => {
  for (const role of ['admin','manager']) {
    const where = projectListWhere({ _id:`${role}-1`,role }, { status:'planning' });
    assert.equal(where.clause, 'TRUE AND p.status=$1');
    assert.deepEqual(where.values, ['planning']);
  }
});
