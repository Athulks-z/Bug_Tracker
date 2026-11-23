const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const pool = require('../config/db');
const { PostgresStore } = require('./postgresStore');
const { respondToAssignment, AssignmentResponseError } = require('./assignmentResponses');

async function createFixture() {
  const store = new PostgresStore();
  const suffix = crypto.randomUUID();
  const user = await store.insert('users', {
    name: 'Assignment Response Test',
    email: `assignment-response-${suffix}@invalid.test`,
    password: 'not-a-real-password',
    role: 'member',
    active: true
  });
  const stakeholder = await store.insert('users', {
    name: 'Assignment Response Stakeholder',
    email: `assignment-stakeholder-${suffix}@invalid.test`,
    password: 'not-a-real-password',
    role: 'member',
    active: true
  });
  const projectId = `assignment-response-project-${suffix}`;
  await store.insert('projects', {
    _id: projectId,
    name: 'Assignment Response Test Project',
    key: `AR${suffix.slice(0, 8)}`,
    owner: user._id,
    members: [user._id],
    status: 'active'
  });
  await pool.query(
    'INSERT INTO public.project_stakeholders (project_id,user_id) VALUES ($1,$2)',
    [projectId, stakeholder._id]
  );
  const task = await store.insert('tasks', {
    project: projectId,
    reporter: user._id,
    assignee: user._id,
    title: 'Assignment response test',
    status: 'To do'
  });
  const outbox = await pool.query(
    `INSERT INTO public.email_outbox (event_type, subject, payload, status, idempotency_key)
     VALUES ('task_assigned', 'Test assignment', '{}'::jsonb, 'sent', $1)
     RETURNING id`,
    [`assignment-response-test:${suffix}`]
  );
  const token = crypto.randomBytes(32).toString('hex');
  await pool.query(
    `INSERT INTO public.assignment_responses
     (email_outbox_id, work_item_id, assigned_user_id, assignee_email_snapshot, token_hash, expires_at)
     VALUES ($1, $2, $3, $4, $5, now() + interval '1 day')`,
    [
      outbox.rows[0].id,
      task._id,
      user._id,
      user.email,
      crypto.createHash('sha256').update(token).digest('hex')
    ]
  );
  const assignmentResponse = await pool.query(
    'SELECT id FROM public.assignment_responses WHERE token_hash=$1',
    [crypto.createHash('sha256').update(token).digest('hex')]
  );
  return {
    store,
    user,
    stakeholder,
    projectId,
    task,
    emailOutboxId: outbox.rows[0].id,
    assignmentResponseId: assignmentResponse.rows[0].id,
    rejectionEmailKey: `assignment-rejected:${assignmentResponse.rows[0].id}`,
    token
  };
}

async function cleanup(fixture) {
  const client = await pool.connect();
  try {
    await client.query('DELETE FROM public.audit_log WHERE resource_id=$1', [fixture.task._id]);
    await client.query('DELETE FROM public.email_outbox WHERE idempotency_key=$1', [fixture.rejectionEmailKey]);
    await client.query('DELETE FROM public.work_items WHERE id=$1', [fixture.task._id]);
    await client.query('DELETE FROM public.email_outbox WHERE id=$1', [fixture.emailOutboxId]);
    await client.query('DELETE FROM public.projects WHERE id=$1', [fixture.projectId]);
    await client.query('DELETE FROM public.users WHERE id=$1', [fixture.user._id]);
    await client.query('DELETE FROM public.users WHERE id=$1', [fixture.stakeholder._id]);
  } finally {
    client.release();
  }
}

test('accepting an assignment advances it to In progress and rejects token reuse', async () => {
  const fixture = await createFixture();
  try {
    const result = await respondToAssignment({ token: fixture.token, action: 'accept' });
    assert.equal(result.status, 'accepted');
    assert.match(result.message, /In Progress/);
    assert.equal((await fixture.store.findById('tasks', fixture.task._id)).status, 'In progress');
    await assert.rejects(
      respondToAssignment({ token: fixture.token, action: 'accept' }),
      error => error instanceof AssignmentResponseError && error.status === 409
    );
  } finally {
    await cleanup(fixture);
  }
});

test('rejecting an assignment requires and records closing remarks', async () => {
  const fixture = await createFixture();
  try {
    await assert.rejects(
      respondToAssignment({ token: fixture.token, action: 'reject', closingRemarks: '  ' }),
      error => error instanceof AssignmentResponseError && error.status === 400
    );
    const result = await respondToAssignment({
      token: fixture.token,
      action: 'reject',
      closingRemarks: 'I do not have access to the required environment. <Please help>'
    });
    assert.equal(result.status, 'rejected');
    const task = await fixture.store.findById('tasks', fixture.task._id);
    assert.equal(task.status, 'Rejected');
    assert.equal(task.closingRemarks, 'I do not have access to the required environment. <Please help>');
    assert.equal(task.rejectedBy, fixture.user._id);
    assert.ok(task.rejectedAt);
    const outbox = await pool.query(
      'SELECT id,status,subject,payload FROM public.email_outbox WHERE idempotency_key=$1',
      [fixture.rejectionEmailKey]
    );
    assert.equal(outbox.rows[0].status, 'pending');
    assert.match(outbox.rows[0].subject, /Task rejected/);
    assert.match(outbox.rows[0].payload.text, /I do not have access/);
    assert.match(outbox.rows[0].payload.text, /Rejected by: Assignment Response Test/);
    assert.match(outbox.rows[0].payload.html, /Rejected by:<\/strong> Assignment Response Test/);
    assert.match(outbox.rows[0].payload.html, /&lt;Please help&gt;/);
    const recipients = await pool.query(
      `SELECT email_snapshot,recipient_type FROM public.email_recipients
       WHERE email_outbox_id=$1 ORDER BY recipient_type,email_snapshot`,
      [outbox.rows[0].id]
    );
    assert.deepEqual(
      recipients.rows.filter(recipient => recipient.recipient_type === 'to').map(recipient => recipient.email_snapshot),
      [fixture.user.email]
    );
    const ccEmails = recipients.rows
      .filter(recipient => recipient.recipient_type === 'cc')
      .map(recipient => recipient.email_snapshot);
    assert.ok(ccEmails.includes(fixture.stakeholder.email));
    assert.ok(ccEmails.includes('zcrossingtasktracker@gmail.com'));
  } finally {
    await cleanup(fixture);
  }
});
