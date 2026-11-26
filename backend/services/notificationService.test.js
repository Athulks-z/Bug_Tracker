const assert = require('node:assert/strict');
const test = require('node:test');
const pool = require('../config/db');
const { notifyRecipients } = require('./notificationService');

test('notification delivery excludes the actor, deduplicates recipients, and links task resources', async (t) => {
  const queries = [];
  const originalConnect = pool.connect;
  const originalQuery = pool.query;
  pool.query = (sql, ...args) => String(sql).includes('SELECT key,value FROM public.app_settings')
    ? Promise.resolve({ rows:[] })
    : originalQuery.call(pool,sql,...args);
  pool.connect = async () => ({
    async query(sql, values = []) {
      queries.push({ sql, values });
      if (sql.includes('INSERT INTO public.notifications')) {
        return { rows: [{ id: `notification-${values[1]}` }] };
      }
      return { rows: [], rowCount: 1 };
    },
    release() {}
  });
  t.after(() => {
    pool.connect = originalConnect;
    pool.query = originalQuery;
  });

  const created = await notifyRecipients({
    recipients: [
      { userId: 'recipient-1' },
      { id: 'actor' },
      { userId: 'recipient-1' },
      { userId: 'recipient-2' }
    ],
    actorUserId: 'actor',
    type: 'task_assigned',
    title: 'Task assigned',
    message: 'A task was assigned.',
    link: '/tasks/task-1',
    entityType: 'task',
    entityId: 'task-1',
    projectId: 'project-1',
    idempotencyKey: 'assignment:event-1'
  });

  assert.equal(created, 2);
  const notificationInserts = queries.filter(({ sql }) => sql.includes('INSERT INTO public.notifications'));
  assert.equal(notificationInserts.length, 2);
  assert.deepEqual(notificationInserts.map(({ values }) => values[1]), ['recipient-1', 'recipient-2']);
  assert.deepEqual(notificationInserts.map(({ values }) => values[11]), [
    'assignment:event-1:recipient-1',
    'assignment:event-1:recipient-2'
  ]);
  assert.equal(queries.filter(({ sql }) => sql.includes('INSERT INTO public.notification_resources')).length, 2);
});

test('notification delivery rolls back to its savepoint on persistence failure', async (t) => {
  const queries = [];
  const originalConnect = pool.connect;
  const originalQuery = pool.query;
  const originalConsoleError = console.error;
  pool.query = (sql, ...args) => String(sql).includes('SELECT key,value FROM public.app_settings')
    ? Promise.resolve({ rows:[] })
    : originalQuery.call(pool,sql,...args);
  pool.connect = async () => ({
    async query(sql) {
      queries.push(sql);
      if (sql.includes('INSERT INTO public.notifications')) throw new Error('database unavailable');
      return { rows: [], rowCount: 1 };
    },
    release() {}
  });
  console.error = () => {};
  t.after(() => {
    pool.connect = originalConnect;
    pool.query = originalQuery;
    console.error = originalConsoleError;
  });

  const created = await notifyRecipients({
    recipients: ['recipient-1'],
    type: 'task_assigned',
    title: 'Task assigned',
    message: 'A task was assigned.'
  });

  assert.equal(created, 0);
  assert.ok(queries.some((sql) => sql.includes('ROLLBACK')));
});
