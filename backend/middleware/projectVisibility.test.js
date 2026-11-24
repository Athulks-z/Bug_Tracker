const test = require('node:test');
const assert = require('node:assert/strict');
const { buildProjectVisibilityFilter } = require('./projectVisibility');

test('project visibility grants unrestricted reads to administrator and manager permissions', () => {
  for (const role of ['super_admin','admin','manager']) {
    assert.deepEqual(buildProjectVisibilityFilter({ _id:'user-1',role }), {
      clause:'TRUE',
      values:[]
    });
  }
});

test('project visibility scopes employees and trainees to owner, member, or stakeholder projects', () => {
  for (const role of ['employee','trainee']) {
    const filter = buildProjectVisibilityFilter({ _id:'user-1',role }, 'p', 3);
    assert.deepEqual(filter.values, ['user-1']);
    assert.match(filter.clause, /p\.owner_user_id=\$3/);
    assert.match(filter.clause, /public\.project_members pm/);
    assert.match(filter.clause, /public\.project_stakeholders ps/);
  }
});

test('project visibility denies unauthenticated or missing identities', () => {
  assert.deepEqual(buildProjectVisibilityFilter(null), { clause:'FALSE',values:[] });
  assert.deepEqual(buildProjectVisibilityFilter({ role:'employee' }), { clause:'FALSE',values:[] });
});
