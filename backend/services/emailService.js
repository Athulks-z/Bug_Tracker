const nodemailer = require('nodemailer');
const pool = require('../config/db');

const SENDER_EMAIL = 'zcrossingtasktracker@gmail.com';
const SENDER_NAME = 'TaskTracker';
const MAX_ATTEMPTS = 5;
const RETRY_INTERVAL_MS = 15000;
const CLAIM_LEASE_MINUTES = 5;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

let transporter;
let workerTimer;
let workerRunning = false;
let warnedMissingCredentials = false;

function escapeHtml(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function buildRecipients(assignee, stakeholders, senderEmail = SENDER_EMAIL) {
  const toEmail = String(assignee?.email || '').trim();
  const to = toEmail ? {
    userId: assignee._id || null,
    email: toEmail,
    name: assignee.name || ''
  } : null;
  if (!to || !EMAIL_PATTERN.test(to.email)) {
    throw new Error('Assigned user does not have a valid email address');
  }

  const seen = new Set([to.email.toLowerCase()]);
  const cc = [];
  for (const recipient of [{ email: senderEmail }, ...(stakeholders || [])]) {
    const email = String(recipient.email || '').trim();
    const key = email.toLowerCase();
    if (!email || seen.has(key)) continue;
    if (!EMAIL_PATTERN.test(email)) throw new Error('A project stakeholder does not have a valid email address');
    seen.add(key);
    cc.push({
      userId: recipient._id || null,
      email,
      name: recipient.name || ''
    });
  }
  return { to, cc };
}

function buildAssignmentContent({ kind, item, project, assignedBy, clientUrl }) {
  const itemType = kind === 'task' ? 'Task' : 'Issue';
  const safeTitle = String(item.title || '').replace(/[\r\n\x00-\x1f\x7f]+/g, ' ').trim();
  const subject = `[TaskTracker] ${itemType} assigned: ${safeTitle || 'Untitled'}`;
  const projectName = project.name || project.key || 'Project';
  const dueDate = item.dueDate || item.endDate || '';
  const projectQuery = project._id ? `?project=${encodeURIComponent(project._id)}` : '';
  const resourceUrl = `${clientUrl.replace(/\/+$/, '')}/${kind === 'task' ? 'tasks' : 'issues'}${projectQuery}`;
  const text = [
    `Hello ${item.assignee?.name || 'there'},`,
    '',
    `A ${itemType.toLowerCase()} has been assigned to you.`,
    `Title: ${item.title || 'Untitled'}`,
    `Project: ${projectName}${project.key ? ` (${project.key})` : ''}`,
    `Assigned by: ${assignedBy || 'TaskTracker user'}`,
    item.status ? `Status: ${item.status}` : '',
    dueDate ? `Due date: ${dueDate}` : '',
    '',
    `Open TaskTracker: ${resourceUrl}`
  ].filter(Boolean).join('\n');
  const html = `<p>Hello ${escapeHtml(item.assignee?.name || 'there')},</p>
    <p>A ${itemType.toLowerCase()} has been assigned to you.</p>
    <ul>
      <li><strong>Title:</strong> ${escapeHtml(item.title || 'Untitled')}</li>
      <li><strong>Project:</strong> ${escapeHtml(projectName)}${project.key ? ` (${escapeHtml(project.key)})` : ''}</li>
      <li><strong>Assigned by:</strong> ${escapeHtml(assignedBy || 'TaskTracker user')}</li>
      ${item.status ? `<li><strong>Status:</strong> ${escapeHtml(item.status)}</li>` : ''}
      ${dueDate ? `<li><strong>Due date:</strong> ${escapeHtml(dueDate)}</li>` : ''}
    </ul>
    <p><a href="${escapeHtml(resourceUrl)}">Open TaskTracker</a></p>`;
  return { subject, text, html };
}

function getTransporter() {
  const password = process.env.EMAIL_SMTP_PASSWORD;
  if (!password) return null;
  if (!transporter) {
    transporter = nodemailer.createTransport({
      host: 'smtp.gmail.com',
      port: 465,
      secure: true,
      auth: { user: SENDER_EMAIL, pass: password }
    });
  }
  return transporter;
}

async function queueAssignmentEmail({ kind, item, project, assigneeId, assignedBy }) {
  if (!['task', 'issue'].includes(kind)) throw new TypeError('Unsupported assignment email type');
  const [assigneeResult, stakeholderResult, assignedByResult] = await Promise.all([
    pool.query('SELECT id AS "_id", name, email FROM public.users WHERE id=$1 AND active', [String(assigneeId)]),
    pool.query(
      `SELECT u.id AS "_id", u.name, u.email
       FROM public.project_stakeholders ps
       JOIN public.users u ON u.id=ps.user_id
       WHERE ps.project_id=$1 AND u.active`,
      [String(project._id)]
    ),
    assignedBy
      ? pool.query('SELECT name FROM public.users WHERE id=$1', [String(assignedBy)])
      : Promise.resolve({ rows: [] })
  ]);
  const assignee = assigneeResult.rows[0];
  if (!assignee) throw new Error('Assigned user is not active or no longer exists');
  const { to, cc } = buildRecipients(assignee, stakeholderResult.rows);
  const content = buildAssignmentContent({
    kind,
    item: { ...item, assignee },
    project,
    assignedBy: assignedByResult.rows[0]?.name || '',
    clientUrl: (process.env.CLIENT_URL || 'http://localhost:3000').split(',')[0].trim()
  });
  const idempotencyKey = `assignment:${kind}:${item._id}:${assigneeId}:${item.updatedAt || item.createdAt}`;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query(
      `INSERT INTO public.email_outbox
       (event_type, subject, payload, status, idempotency_key)
       VALUES ($1, $2, $3::jsonb, 'pending', $4)
        ON CONFLICT (idempotency_key) DO NOTHING
        RETURNING id`,
       [`${kind}_assigned`, content.subject, JSON.stringify({
         text: content.text,
         html: content.html
       }), idempotencyKey]
    );
    if (!rows.length) {
      await client.query('COMMIT');
      return false;
    }
    const emailId = rows[0].id;
    for (const recipient of [to, ...cc]) {
      await client.query(
        `INSERT INTO public.email_recipients
         (email_outbox_id, user_id, email_snapshot, name_snapshot, recipient_type, delivery_status)
         VALUES ($1, $2, $3, $4, $5, 'pending')`,
        [emailId, recipient.userId, recipient.email, recipient.name, recipient === to ? 'to' : 'cc']
      );
    }
    await client.query(
      `INSERT INTO public.email_resources (email_outbox_id, project_scope_id, work_item_id)
       VALUES ($1, $2, $3)`,
      [emailId, String(project._id), String(item._id)]
    );
    await client.query('COMMIT');
    return true;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

async function claimEmail() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query(
      `SELECT id, subject, payload, attempts
       FROM public.email_outbox
       WHERE status IN ('pending', 'sending') AND next_attempt_at <= now()
       ORDER BY created_at, id
       LIMIT 1
       FOR UPDATE SKIP LOCKED`
    );
    if (!rows.length) {
      await client.query('COMMIT');
      return null;
    }
    const email = rows[0];
    email.attempts += 1;
    await client.query(
      `UPDATE public.email_outbox
       SET status='sending', attempts=$2,
           next_attempt_at=now() + ($3 * interval '1 minute')
       WHERE id=$1`,
      [email.id, email.attempts, CLAIM_LEASE_MINUTES]
    );
    const recipients = await client.query(
      `SELECT email_snapshot, recipient_type
       FROM public.email_recipients
       WHERE email_outbox_id=$1
       ORDER BY recipient_type, email_snapshot`,
      [email.id]
    );
    await client.query('COMMIT');
    email.payload = typeof email.payload === 'string' ? JSON.parse(email.payload) : email.payload;
    email.to = recipients.rows.filter(recipient => recipient.recipient_type === 'to').map(recipient => recipient.email_snapshot);
    email.cc = recipients.rows.filter(recipient => recipient.recipient_type === 'cc').map(recipient => recipient.email_snapshot);
    return email;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

async function deliverNextEmail(mailTransport) {
  const email = await claimEmail();
  if (!email) return false;
  try {
    await mailTransport.sendMail({
      from: { name: SENDER_NAME, address: SENDER_EMAIL },
      to: email.to,
      cc: email.cc,
      subject: email.subject,
      text: email.payload.text,
      html: email.payload.html
    });
  } catch (error) {
    const status = email.attempts >= MAX_ATTEMPTS ? 'failed' : 'pending';
    const delayMinutes = Math.min(60, 2 ** (email.attempts - 1));
    await pool.query(
      `UPDATE public.email_outbox
       SET status=$2, last_error=$3,
           next_attempt_at=now() + ($4 * interval '1 minute')
       WHERE id=$1`,
      [email.id, status, error.code || error.name || 'MailDeliveryError', delayMinutes]
    );
    await pool.query(
      `UPDATE public.email_recipients
       SET delivery_status=$2
       WHERE email_outbox_id=$1`,
      [email.id, status]
    );
    console.error(`Assignment email delivery failed (${email.id}):`, error.code || error.name);
    return true;
  }
  await pool.query(
    `UPDATE public.email_outbox
     SET status='sent', sent_at=now(), last_error=NULL
     WHERE id=$1`,
    [email.id]
  );
  await pool.query(
    `UPDATE public.email_recipients
     SET delivery_status='sent', delivered_at=now()
     WHERE email_outbox_id=$1`,
    [email.id]
  );
  return true;
}

async function processPendingEmails() {
  if (workerRunning) return;
  const mailTransport = getTransporter();
  if (!mailTransport) {
    if (!warnedMissingCredentials) {
      console.warn('Assignment emails are queued but not sent: configure EMAIL_SMTP_PASSWORD.');
      warnedMissingCredentials = true;
    }
    return;
  }
  workerRunning = true;
  try {
    while (await deliverNextEmail(mailTransport)) {
      // Drain currently available messages before waiting for the next poll.
    }
  } finally {
    workerRunning = false;
  }
}

function startEmailWorker() {
  if (workerTimer) return;
  void processPendingEmails().catch(error => {
    console.error('Assignment email worker failed:', error.name);
  });
  workerTimer = setInterval(() => {
    void processPendingEmails().catch(error => {
      console.error('Assignment email worker failed:', error.name);
    });
  }, RETRY_INTERVAL_MS);
  workerTimer.unref();
}

module.exports = {
  SENDER_EMAIL,
  buildRecipients,
  buildAssignmentContent,
  queueAssignmentEmail,
  processPendingEmails,
  startEmailWorker
};
