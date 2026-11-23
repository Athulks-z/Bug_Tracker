const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('crypto');
const { PostgresStore } = require('./postgresStore');

test('normalized PostgreSQL store preserves CRUD and allocates issue numbers concurrently', async () => {
  const store = new PostgresStore();
  await store.initialize();

  const suffix = randomUUID();
  const email = `postgres-store-${suffix}@invalid.test`;
  const userIds = [];
  const issueIds = [];
  const projectId = `project-${suffix}`;
  const recordIds = { sprints: [], releases: [], tasks: [], templates: [], notifications: [] };

  try {
    const user = await store.insert('users', {
      name: 'PostgreSQL Store Test',
      email,
      password: 'not-a-real-password',
      role: 'member',
      active: true
    });
    userIds.push(user._id);
    assert.equal((await store.findById('users', user._id)).email, email);
    assert.equal((await store.findById('users', user._id)).role, 'employee');
    assert.equal((await store.list('users')).some((record) => record._id === user._id), true);

    await assert.rejects(
      store.insert('users', { email: email.toUpperCase() }),
      (error) => error.code === 'DUPLICATE_EMAIL'
    );

    const updated = await store.update('users', user._id, { name: 'Updated Test User' });
    assert.equal(updated._id, user._id);
    assert.equal(updated.name, 'Updated Test User');
    assert.equal(updated.createdAt, user.createdAt);
    assert.notEqual(updated.updatedAt, user.updatedAt);

    await store.insert('projects', {
      _id: projectId,
      name: 'PostgreSQL Store Test Project',
      key: `PG${suffix.slice(0, 8)}`,
      owner: user._id,
      members: [user._id],
      status: 'active'
    });
    assert.deepEqual((await store.findById('projects', projectId)).members, [user._id]);
    assert.deepEqual((await store.findById('users', user._id)).assignedProjects, [projectId]);
    const sprint = await store.insert('sprints', {
      project: projectId,
      name: 'Test sprint',
      status: 'Planned'
    });
    recordIds.sprints.push(sprint._id);
    const release = await store.insert('releases', {
      project: projectId,
      name: 'Test release',
      status: 'Planned'
    });
    recordIds.releases.push(release._id);
    const issues = await Promise.all(Array.from({ length: 5 }, () => store.insert('issues', {
      project: projectId,
      reporter: user._id,
      title: 'Concurrency test',
      status: 'Open',
      targetRelease: release._id,
      sprint: sprint._id,
      comments: [],
      activity: [],
      timeLogs: [],
      attachments: []
    })));
    issueIds.push(...issues.map((issue) => issue._id));
    assert.deepEqual(issues.map((issue) => issue.issueNumber).sort((a, b) => a - b), [1, 2, 3, 4, 5]);

    const firstIssue = await store.findById('issues', issues[0]._id);
    assert.equal(firstIssue.project, projectId);
    assert.equal(firstIssue.reporter, user._id);
    assert.equal(firstIssue.issueType, 'other');
    assert.equal(firstIssue.targetRelease, release._id);
    assert.equal(firstIssue.sprint, sprint._id);
    assert.deepEqual(firstIssue.comments, []);

    await store.update('issues', issues[0]._id, {
      comments: [{ author: user._id, text: 'Normalized comment' }],
      activity: [{ user: user._id, action: 'updated', details: 'Normalized activity' }],
      timeLogs: [{ user: user._id, hours: 1.5, note: 'Normalized time', date: '2024-01-02' }],
      attachments: [{
        filename: 'test.txt',
        path: `/uploads/issues/${suffix}.txt`,
        uploadedBy: user._id,
        createdAt: new Date().toISOString(),
        size: 12
      }]
    });
    const issueWithChildren = await store.findById('issues', issues[0]._id);
    assert.equal(issueWithChildren.comments[0].text, 'Normalized comment');
    assert.equal(issueWithChildren.activity[0].action, 'updated');
    assert.equal(issueWithChildren.timeLogs[0].hours, 1.5);
    assert.equal(issueWithChildren.attachments[0].path, `/uploads/issues/${suffix}.txt`);

    const task = await store.insert('tasks', {
      project: projectId,
      reporter: user._id,
      title: 'Normalized task',
      status: 'To do'
    });
    recordIds.tasks.push(task._id);
    assert.equal((await store.findById('tasks', task._id)).type, 'task');

    const template = await store.insert('templates', {
      project: projectId,
      name: 'Normalized template',
      type: 'bug',
      body: 'Template body',
      fields: { severity: true },
      createdBy: user._id
    });
    recordIds.templates.push(template._id);
    assert.deepEqual((await store.findById('templates', template._id)).fields, { severity: true });

    const notification = await store.insert('notifications', {
      user: user._id,
      issue: issues[0]._id,
      type: 'issue_status_changed',
      details: 'Status changed'
    });
    recordIds.notifications.push(notification._id);
    assert.equal((await store.findById('notifications', notification._id)).issue, issues[0]._id);

    assert.equal(await store.remove('issues', issueIds[0]), true);
    issueIds.shift();
    assert.equal(await store.findById('issues', issues[0]._id), null);
    assert.equal(await store.remove('issues', issues[0]._id), false);
  } finally {
    await Promise.all(issueIds.map((id) => store.remove('issues', id)));
    await store.remove('projects', projectId);
    for (const [collection, ids] of Object.entries(recordIds)) {
      await Promise.all(ids.map((id) => store.remove(collection, id)));
    }
    await Promise.all(userIds.map((id) => store.remove('users', id)));
  }
});
