const pool = require('../config/db');
const { projectStatus, roleCode, saveRecord } = require('../services/postgresStore');

const DATA_MIGRATION = 'app_records_to_normalized_v1';
const COLLECTIONS = ['users', 'projects', 'sprints', 'releases', 'issues', 'tasks', 'templates', 'notifications'];

function fail(message) {
  throw new Error(message);
}

function requireRecord(records, collection, id, context) {
  if (!id || !records.get(collection)?.has(String(id))) {
    fail(`${context} references a missing ${collection} record`);
  }
}

function listField(record, field, context) {
  if (record[field] === undefined || record[field] === null) return [];
  if (!Array.isArray(record[field])) fail(`${context}.${field} must be an array`);
  return record[field];
}

function validateSource(records) {
  const users = records.get('users') || new Map();
  const projects = records.get('projects') || new Map();
  const issues = records.get('issues') || new Map();
  const sprints = records.get('sprints') || new Map();
  const releases = records.get('releases') || new Map();
  const emails = new Set();
  const keys = new Set();
  const memberships = new Map();
  let issuesWithoutType = 0;

  for (const [id, user] of users) {
    if (!user.name || !user.email || !user.password) fail(`User ${id} is missing required account data`);
    const email = String(user.email).trim().toLowerCase();
    if (emails.has(email)) fail('Legacy users contain duplicate email addresses');
    emails.add(email);
    roleCode(user.role || 'member', user.bootstrapAdmin);
    if (user.reportingManager) requireRecord(records, 'users', user.reportingManager, `User ${id}`);
    for (const projectId of listField(user, 'assignedProjects', `User ${id}`)) {
      requireRecord(records, 'projects', projectId, `User ${id}`);
      if (!memberships.has(String(projectId))) memberships.set(String(projectId), new Set());
      memberships.get(String(projectId)).add(id);
    }
  }

  for (const [id, project] of projects) {
    if (!project.name || !(project.key || project.prefix)) fail(`Project ${id} is missing its name or key`);
    requireRecord(records, 'users', project.owner, `Project ${id}`);
    projectStatus(project.status);
    const key = String(project.key || project.prefix).trim().toLowerCase();
    if (keys.has(key)) fail('Legacy projects contain duplicate project keys');
    keys.add(key);
    if (!memberships.has(id)) memberships.set(id, new Set());
    for (const memberId of listField(project, 'members', `Project ${id}`)) {
      requireRecord(records, 'users', memberId, `Project ${id}`);
      memberships.get(id).add(String(memberId));
    }
  }

  for (const [id, sprint] of sprints) {
    requireRecord(records, 'projects', sprint.project, `Sprint ${id}`);
  }
  for (const [id, release] of releases) {
    requireRecord(records, 'projects', release.project, `Release ${id}`);
  }

  const issueNumbers = new Set();
  const bootstrapAdmins = [...users.values()].filter((user) => Boolean(user.bootstrapAdmin));
  if (bootstrapAdmins.length > 1) fail('Legacy users contain more than one bootstrap administrator');
  for (const [id, issue] of issues) {
    requireRecord(records, 'projects', issue.project, `Issue ${id}`);
    requireRecord(records, 'users', issue.reporter, `Issue ${id}`);
    if (issue.assignee) requireRecord(records, 'users', issue.assignee, `Issue ${id}`);
    if (!issue.title) fail(`Issue ${id} is missing its title`);
    const issueType = issue.issueType || issue.type;
    if (!issueType) issuesWithoutType += 1;
    else if (!['bug', 'feature', 'improvement', 'other'].includes(String(issueType).toLowerCase())) {
      fail(`Issue ${id} has an unsupported issue type`);
    }
    if (issue.targetRelease) {
      requireRecord(records, 'releases', issue.targetRelease, `Issue ${id}`);
      if (String(releases.get(String(issue.targetRelease)).project) !== String(issue.project)) {
        fail(`Issue ${id} references a release from another project`);
      }
    }
    if (issue.sprint) {
      requireRecord(records, 'sprints', issue.sprint, `Issue ${id}`);
      if (String(sprints.get(String(issue.sprint)).project) !== String(issue.project)) {
        fail(`Issue ${id} references a sprint from another project`);
      }
    }
    const issueNumber = Number(issue.issueNumber);
    if (!Number.isInteger(issueNumber) || issueNumber < 0) fail(`Issue ${id} has an invalid issue number`);
    const uniqueKey = `${issue.project}:${issueNumber}`;
    if (issueNumbers.has(uniqueKey)) fail('Legacy issues contain duplicate project issue numbers');
    issueNumbers.add(uniqueKey);

    for (const comment of listField(issue, 'comments', `Issue ${id}`)) {
      if (!comment || typeof comment !== 'object') fail(`Issue ${id} contains an invalid comment`);
      requireRecord(records, 'users', comment.author, `Comment in issue ${id}`);
    }
    for (const activity of listField(issue, 'activity', `Issue ${id}`)) {
      if (!activity || typeof activity !== 'object') fail(`Issue ${id} contains invalid activity`);
      if (activity.user) requireRecord(records, 'users', activity.user, `Activity in issue ${id}`);
    }
    for (const entry of listField(issue, 'timeLogs', `Issue ${id}`)) {
      requireRecord(records, 'users', entry.user, `Time entry in issue ${id}`);
      if (!Number.isFinite(Number(entry.hours)) || Number(entry.hours) <= 0) {
        fail(`Issue ${id} contains a time entry with invalid hours`);
      }
      if (!entry.date) fail(`Issue ${id} contains a time entry without a work date`);
    }
    for (const attachment of listField(issue, 'attachments', `Issue ${id}`)) {
      requireRecord(records, 'users', attachment.uploadedBy, `Attachment in issue ${id}`);
      if (!attachment.path || !attachment.filename) fail(`Issue ${id} contains incomplete attachment metadata`);
    }
  }

  for (const [id, task] of records.get('tasks') || []) {
    requireRecord(records, 'projects', task.project, `Task ${id}`);
    requireRecord(records, 'users', task.reporter, `Task ${id}`);
    if (task.assignee) requireRecord(records, 'users', task.assignee, `Task ${id}`);
    if (task.parentTask) {
      requireRecord(records, 'tasks', task.parentTask, `Task ${id}`);
      if (String(records.get('tasks').get(String(task.parentTask)).project) !== String(task.project)) {
        fail(`Task ${id} references a parent task from another project`);
      }
    }
    if (task.type && !['task', 'other'].includes(String(task.type).toLowerCase())) {
      fail(`Task ${id} has an unsupported task type`);
    }
  }

  for (const [id, template] of records.get('templates') || []) {
    requireRecord(records, 'users', template.createdBy, `Template ${id}`);
    if (template.project) requireRecord(records, 'projects', template.project, `Template ${id}`);
  }
  for (const [id, notification] of records.get('notifications') || []) {
    requireRecord(records, 'users', notification.user, `Notification ${id}`);
    if (notification.issue) requireRecord(records, 'issues', notification.issue, `Notification ${id}`);
  }

  return { memberships, issuesWithoutType };
}

async function run() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query("SELECT pg_advisory_xact_lock(hashtextextended('bugtracker:normalized-data-migration', 0))");
    const legacyExists = await client.query("SELECT to_regclass('public.app_records') IS NOT NULL AS present");
    const archiveExists = await client.query("SELECT to_regclass('public.app_records_legacy') IS NOT NULL AS present");
    await client.query(`
      CREATE TABLE IF NOT EXISTS public.data_migrations (
        name text PRIMARY KEY,
        completed_at timestamptz NOT NULL DEFAULT now(),
        record_counts jsonb NOT NULL DEFAULT '{}'::jsonb
      )
    `);
    const applied = await client.query('SELECT record_counts FROM public.data_migrations WHERE name=$1', [DATA_MIGRATION]);
    if (applied.rowCount) {
      if (!archiveExists.rows[0].present || legacyExists.rows[0].present) {
        fail('Normalized data migration marker does not match the legacy archive state');
      }
      console.info(`Normalized data migration already complete: ${JSON.stringify(applied.rows[0].record_counts)}`);
      await client.query('COMMIT');
      return;
    }
    if (!legacyExists.rows[0].present || archiveExists.rows[0].present) {
      fail('Expected app_records to exist and app_records_legacy to be absent before normalized migration');
    }

    const nonEmptyTargets = await client.query(`
      SELECT
        (SELECT count(*) FROM public.users) +
        (SELECT count(*) FROM public.projects) +
        (SELECT count(*) FROM public.work_items) +
        (SELECT count(*) FROM public.sprints) +
        (SELECT count(*) FROM public.releases) +
        (SELECT count(*) FROM public.templates) +
        (SELECT count(*) FROM public.notifications) AS existing_count
    `);
    if (Number(nonEmptyTargets.rows[0].existing_count) !== 0) {
      fail('Normalized target tables are not empty; refusing to merge unrelated existing records');
    }

    const source = await client.query(
      'SELECT collection,id,record FROM public.app_records ORDER BY collection,created_at,id'
    );
    const records = new Map(COLLECTIONS.map((collection) => [collection, new Map()]));
    for (const row of source.rows) {
      if (!records.has(row.collection)) fail(`Unsupported legacy collection: ${row.collection}`);
      if (String(row.record._id) !== row.id) fail(`Legacy ${row.collection} record has an inconsistent ID`);
      records.get(row.collection).set(row.id, row.record);
    }
    const { memberships, issuesWithoutType } = validateSource(records);
    const counts = Object.fromEntries(COLLECTIONS.map((collection) => [collection, records.get(collection).size]));
    const expectedChildren = {
      project_members: [...memberships.values()].reduce((total, members) => total + members.size, 0),
      comments: 0,
      activity_log: 0,
      time_entries: 0,
      attachments: 0
    };
    for (const issue of records.get('issues').values()) {
      expectedChildren.comments += listField(issue, 'comments', 'Issue').length;
      expectedChildren.activity_log += listField(issue, 'activity', 'Issue').length;
      expectedChildren.time_entries += listField(issue, 'timeLogs', 'Issue').length;
      expectedChildren.attachments += listField(issue, 'attachments', 'Issue').length;
    }

    for (const [id, user] of records.get('users')) {
      await saveRecord(client, 'users', {
        ...user,
        _id: id,
        assignedProjects: undefined,
        reportingManager: undefined
      });
    }
    for (const [id, project] of records.get('projects')) {
      await saveRecord(client, 'projects', {
        ...project,
        _id: id,
        members: [...(memberships.get(id) || [])]
      });
    }
    for (const [id, user] of records.get('users')) {
      if (user.reportingManager) {
        await client.query('UPDATE public.users SET reporting_manager_id=$2 WHERE id=$1', [id, String(user.reportingManager)]);
      }
    }
    for (const collection of ['sprints', 'releases', 'issues', 'tasks', 'templates', 'notifications']) {
      for (const [id, record] of records.get(collection)) {
        await saveRecord(client, collection, {
          ...record,
          _id: id,
          ...(collection === 'tasks' ? {
            taskType: record.taskType || record.type || 'other',
            parentTask: ''
          } : {})
        });
      }
    }
    for (const [id, task] of records.get('tasks')) {
      if (task.parentTask) {
        await client.query('UPDATE public.tasks SET parent_task_id=$2 WHERE work_item_id=$1', [
          id, String(task.parentTask)
        ]);
      }
    }

    const resultCounts = {};
    for (const collection of COLLECTIONS) {
      const table = collection === 'issues' || collection === 'tasks' ? 'work_items' : collection;
      const { rows } = await client.query(
        `SELECT count(*)::int AS count FROM public.${table}${collection === 'issues' ? " WHERE kind='issue'" : collection === 'tasks' ? " WHERE kind='task'" : ''}`
      );
      resultCounts[collection] = rows[0].count;
      if (resultCounts[collection] !== counts[collection]) {
        fail(`Normalized ${collection} count does not match the source`);
      }
    }
    for (const [table, expected] of Object.entries(expectedChildren)) {
      const { rows } = await client.query(`SELECT count(*)::int AS count FROM public.${table}`);
      counts[table] = rows[0].count;
      if (rows[0].count !== expected) {
        fail(`Normalized ${table} count does not match the source`);
      }
    }

    await client.query('ALTER TABLE public.app_records RENAME TO app_records_legacy');
    await client.query(
      'INSERT INTO public.data_migrations (name,record_counts) VALUES ($1,$2::jsonb)',
      [DATA_MIGRATION, JSON.stringify(counts)]
    );
    await client.query('COMMIT');
    console.info(`Normalized data migration completed: ${JSON.stringify(counts)}`);
    if (issuesWithoutType) {
      console.info(`${issuesWithoutType} legacy issue(s) without a type were mapped to the explicit "other" type.`);
    }
    console.info('The original app_records table is preserved as public.app_records_legacy.');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

run().catch((error) => {
  console.error(`Normalized data migration failed: ${error.message}`);
  process.exitCode = 1;
}).finally(() => pool.end());
