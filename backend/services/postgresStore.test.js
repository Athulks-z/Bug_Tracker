const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('crypto');
const express = require('express');
const jwt = require('jsonwebtoken');
const { PostgresStore } = require('./postgresStore');
const {
  queryTasks,
  queryTaskCounts,
  queryTaskDashboard,
  findVisibleTask,
  findVisibleAttachment
} = require('./taskQueries');

test('normalized PostgreSQL store preserves unified Task CRUD and concurrent inserts', async () => {
  const store = new PostgresStore();
  await store.initialize();

  const suffix = randomUUID();
  const email = `postgres-store-${suffix}@invalid.test`;
  const userIds = [];
  const projectId = `project-${suffix}`;
  const recordIds = { sprints: [], releases: [], tasks: [], templates: [], notifications: [] };
  let testServer;

  try {
    const user = await store.insert('users', {
      name: 'PostgreSQL Store Test',
      email,
      password: 'not-a-real-password',
      role: 'member',
      active: true
    });
    userIds.push(user._id);
    const trainee = await store.insert('users', {
      name:'Task Visibility Trainee',
      email:`task-visibility-trainee-${suffix}@invalid.test`,
      password:'not-a-real-password',
      role:'trainee',
      active:true
    });
    const manager = await store.insert('users', {
      name:'Task Visibility Manager',
      email:`task-visibility-manager-${suffix}@invalid.test`,
      password:'not-a-real-password',
      role:'manager',
      active:true
    });
    userIds.push(trainee._id, manager._id);
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
    const tasks = await Promise.all(Array.from({ length: 5 }, () => store.insert('tasks', {
      project: projectId,
      reporter: user._id,
      title: 'Concurrency task test',
      status: 'Open',
      type: 'other',
      customTypeName: 'Calibration',
      targetRelease: release._id,
      sprint: sprint._id,
      comments: [],
      activity: [],
      timeLogs: [],
      attachments: []
    })));
    recordIds.tasks.push(...tasks.map((task) => task._id));

    const employeeTask = await store.insert('tasks', {
      project:projectId, reporter:user._id, assignee:user._id,
      title:'Employee-visible task', status:'Rejected', type:'other',
      customTypeName:'Calibration', comments:[], activity:[], timeLogs:[], attachments:[]
    });
    const traineeTask = await store.insert('tasks', {
      project:projectId, reporter:user._id, assignee:trainee._id,
      title:'Trainee-private task', status:'Rejected', type:'bug',
      comments:[], activity:[], timeLogs:[], attachments:[]
    });
    recordIds.tasks.push(employeeTask._id, traineeTask._id);
    await store.update('tasks', traineeTask._id, {
      attachments:[{
        _id:`visibility-attachment-${suffix}`,
        filename:'private.txt',
        path:`/uploads/tasks/visibility-${suffix}.txt`,
        uploadedBy:trainee._id,
        size:5
      }]
    });

    const employeeList = await queryTasks(user, { limit:200 });
    assert.deepEqual(employeeList.items.map((item) => item._id), [employeeTask._id]);
    assert.equal(await queryTaskCounts(user), 1);
    assert.deepEqual((await queryTasks(trainee, { limit:200 })).items.map((item) => item._id), [traineeTask._id]);
    assert.equal(await queryTaskCounts(user, { statusGroup:'Rejected' }), 1);
    assert.deepEqual(
      (await queryTasks(user, { type:'other', statusGroup:'Rejected' })).items.map((item) => item._id),
      [employeeTask._id]
    );
    assert.equal((await queryTasks(user, { search:'Trainee-private' })).total, 0);
    assert.equal(await findVisibleTask(user, traineeTask._id), null);
    assert.equal((await findVisibleTask(manager, traineeTask._id))._id, traineeTask._id);
    assert.equal(await findVisibleAttachment(user, `visibility-attachment-${suffix}`), null);
    assert.equal((await findVisibleAttachment(trainee, `visibility-attachment-${suffix}`)).filename, 'private.txt');

    const app = express();
    app.use(express.json());
    app.use('/api/tasks', require('../routes/tasks'));
    testServer = app.listen(0, '127.0.0.1');
    await new Promise((resolve, reject) => {
      testServer.once('listening', resolve);
      testServer.once('error', reject);
    });
    const baseUrl = `http://127.0.0.1:${testServer.address().port}/api/tasks`;
    const employeeToken = jwt.sign({ id:user._id }, process.env.JWT_SECRET);
    const managerToken = jwt.sign({ id:manager._id }, process.env.JWT_SECRET);
    const hiddenDetail = await fetch(`${baseUrl}/${traineeTask._id}`, {
      headers:{ Authorization:`Bearer ${employeeToken}` }
    });
    const hiddenAttachment = await fetch(`${baseUrl}/attachments/visibility-attachment-${suffix}/download`, {
      headers:{ Authorization:`Bearer ${employeeToken}` }
    });
    const employeeApiListResponse = await fetch(baseUrl, {
      headers:{ Authorization:`Bearer ${employeeToken}` }
    });
    const employeeApiCountResponse = await fetch(
      `${baseUrl}/stats/count?type=other&statusGroup=Rejected`,
      { headers:{ Authorization:`Bearer ${employeeToken}` } }
    );
    const managerDetail = await fetch(`${baseUrl}/${traineeTask._id}`, {
      headers:{ Authorization:`Bearer ${managerToken}` }
    });
    const employeeDashboardResponse = await fetch(`${baseUrl}/dashboard`, {
      headers:{ Authorization:`Bearer ${employeeToken}` }
    });
    const managerDashboardResponse = await fetch(`${baseUrl}/dashboard`, {
      headers:{ Authorization:`Bearer ${managerToken}` }
    });
    assert.equal(hiddenDetail.status, 404);
    assert.equal(hiddenAttachment.status, 404);
    assert.deepEqual((await employeeApiListResponse.json()).map((item) => item._id), [employeeTask._id]);
    assert.equal((await employeeApiCountResponse.json()).total, 1);
    assert.equal(managerDetail.status, 200);
    assert.equal((await managerDetail.json())._id, traineeTask._id);
    const employeeDashboardPayload = await employeeDashboardResponse.json();
    const managerDashboardPayload = await managerDashboardResponse.json();
    assert.equal(employeeDashboardPayload.summary.total, 1);
    assert.equal(Object.prototype.hasOwnProperty.call(employeeDashboardPayload, 'teamWidgets'), false);
    assert.equal(Object.prototype.hasOwnProperty.call(managerDashboardPayload, 'teamWidgets'), true);

    const employeeDashboard = await queryTaskDashboard(user);
    assert.equal(employeeDashboard.summary.total, 1);
    assert.equal(employeeDashboard.byStatus.reduce((sum, item) => sum + item.count, 0), employeeList.total);
    assert.equal(employeeDashboard.summary.rejected, await queryTaskCounts(user, { statusGroup:'Rejected' }));
    assert.equal(employeeDashboard.byType.some((item) =>
      item.type === 'other' && item.customTypeName === 'Calibration' && item.label === 'Calibration'), true);
    assert.equal(Object.prototype.hasOwnProperty.call(employeeDashboard, 'teamWidgets'), false);
    const traineeDashboard = await queryTaskDashboard(trainee);
    assert.equal(traineeDashboard.summary.total, 1);
    assert.equal(Object.prototype.hasOwnProperty.call(traineeDashboard, 'teamWidgets'), false);
    const managerList = await queryTasks(manager, { limit:200 });
    const firstManagerPage = await queryTasks(manager, { limit:2, page:1 });
    const secondManagerPage = await queryTasks(manager, { limit:2, page:2 });
    assert.equal(firstManagerPage.total, managerList.total);
    assert.equal(firstManagerPage.items.length, 2);
    assert.equal(secondManagerPage.items.length, 2);
    assert.notEqual(firstManagerPage.items[0]._id, secondManagerPage.items[0]._id);
    const managerDashboard = await queryTaskDashboard(manager);
    assert.equal(managerDashboard.summary.total, managerList.total);
    assert.equal(managerDashboard.byStatus.reduce((sum, item) => sum + item.count, 0), managerList.total);
    assert.equal(managerDashboard.summary.rejected, await queryTaskCounts(manager, { statusGroup:'Rejected' }));
    assert.equal(Object.prototype.hasOwnProperty.call(managerDashboard, 'teamWidgets'), true);
    const adminList = await queryTasks({ _id:user._id, role:'admin' }, { limit:200 });
    assert.equal(adminList.total, managerList.total);

    const firstTask = await store.findById('tasks', tasks[0]._id);
    assert.equal(firstTask.project, projectId);
    assert.equal(firstTask.reporter, user._id);
    assert.equal(firstTask.type, 'other');
    assert.equal(firstTask.customTypeName, 'Calibration');
    assert.equal(firstTask.targetRelease, release._id);
    assert.equal(firstTask.sprint, sprint._id);
    assert.deepEqual(firstTask.comments, []);

    await store.update('tasks', tasks[0]._id, {
      comments: [{ author: user._id, text: 'Normalized comment' }],
      activity: [{ user: user._id, action: 'updated', details: 'Normalized activity' }],
      timeLogs: [{ user: user._id, hours: 1.5, note: 'Normalized time', date: '2024-01-02' }],
      attachments: [{
        filename: 'test.txt',
        path: `/uploads/tasks/${suffix}.txt`,
        uploadedBy: user._id,
        createdAt: new Date().toISOString(),
        size: 12
      }]
    });
    const taskWithChildren = await store.findById('tasks', tasks[0]._id);
    assert.equal(taskWithChildren.comments[0].text, 'Normalized comment');
    assert.equal(taskWithChildren.activity[0].action, 'updated');
    assert.equal(taskWithChildren.timeLogs[0].hours, 1.5);
    assert.equal(taskWithChildren.attachments[0].path, `/uploads/tasks/${suffix}.txt`);

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
      issue: tasks[0]._id,
      type: 'task_status_changed',
      details: 'Status changed'
    });
    recordIds.notifications.push(notification._id);
    assert.equal((await store.findById('notifications', notification._id)).issue, tasks[0]._id);

    assert.equal(await store.remove('tasks', tasks[0]._id), true);
    recordIds.tasks = recordIds.tasks.filter((id) => id !== tasks[0]._id);
    assert.equal(await store.findById('tasks', tasks[0]._id), null);
    assert.equal(await store.remove('tasks', tasks[0]._id), false);
  } finally {
    if (testServer) {
      await new Promise((resolve, reject) => testServer.close((error) => error ? reject(error) : resolve()));
    }
    await store.remove('projects', projectId);
    for (const [collection, ids] of Object.entries(recordIds)) {
      await Promise.all(ids.map((id) => store.remove(collection, id)));
    }
    await Promise.all(userIds.map((id) => store.remove('users', id)));
  }
});
