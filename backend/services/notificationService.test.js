const assert = require('node:assert/strict');
const test = require('node:test');
const pool = require('../config/db');
const {
  notifyRecipients,
  checkStorageThreshold
} = require('./notificationService');
const { invalidateSettingsCache } = require('./settingsService');

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

test('storage threshold notifications target active admins only and deduplicate each UTC day', async (t) => {
  const originalConnect = pool.connect;
  const originalQuery = pool.query;
  const insertedKeys = new Set();
  const insertedNotifications = [];
  const recipientQueries = [];

  invalidateSettingsCache();
  pool.query = async (sql, values = []) => {
    if (String(sql).includes('SELECT key,value FROM public.app_settings')) return { rows:[] };
    if (String(sql).includes('SELECT id FROM public.users')) {
      recipientQueries.push({ sql, values });
      return { rows:[{ id:'qa-admin' },{ id:'qa-super-admin' }] };
    }
    return originalQuery.call(pool, sql, values);
  };
  pool.connect = async () => ({
    async query(sql, values = []) {
      if (String(sql).includes('INSERT INTO public.notifications')) {
        const key = values[11];
        if (insertedKeys.has(key)) return { rows:[] };
        insertedKeys.add(key);
        insertedNotifications.push({ key, values });
        return { rows:[{ id:`notification-${insertedNotifications.length}` }] };
      }
      return { rows:[], rowCount:1 };
    },
    release() {}
  });
  t.after(() => {
    pool.connect = originalConnect;
    pool.query = originalQuery;
    invalidateSettingsCache();
  });

  const statsProvider = async () => ({
    totalUsedBytes: 800,
    limitBytes: 1000
  });
  const day = new Date('2026-11-27T00:15:00.000Z');
  assert.equal(await checkStorageThreshold(statsProvider, day), 2);
  assert.equal(await checkStorageThreshold(statsProvider, day), 0);

  assert.equal(recipientQueries.length, 2);
  assert.deepEqual(recipientQueries[0].values, [['admin','super_admin']]);
  assert.match(recipientQueries[0].sql, /WHERE active AND role_code/);
  assert.deepEqual(insertedNotifications.map(({ key }) => key), [
    'storage-capacity:2026-11-27:qa-admin',
    'storage-capacity:2026-11-27:qa-super-admin'
  ]);
  assert.ok(insertedNotifications.every(({ values }) => values[3] === 'storage_limit_warning'));
  assert.ok(insertedNotifications.every(({ values }) => values[6].includes('80%')));
  assert.ok(insertedNotifications.every(({ values }) => values[7] === '/settings'));
});

test('storage alerts do not fire below threshold or when no quota is configured', async () => {
  const queryCountBefore = 0;
  const belowThreshold = await checkStorageThreshold(async () => ({
    totalUsedBytes:799,
    limitBytes:1000
  }));
  const noQuota = await checkStorageThreshold(async () => ({
    totalUsedBytes:100000,
    limitBytes:null
  }));
  assert.equal(belowThreshold, queryCountBefore);
  assert.equal(noQuota, queryCountBefore);
});
