const crypto = require('crypto');
const fs = require('fs');
const sanitizeHtml = require('sanitize-html');
const nodemailer = require('nodemailer');
const path = require('path');
const pool = require('../config/db');
const { notifyRecipients } = require('./notificationService');

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

function safeHeaderValue(value) {
  return String(value || '').replace(/[\r\n\x00-\x1f\x7f]+/g, ' ').trim();
}

function getDeliveryFailure(error, attempts) {
  const responseCode = Number(error.responseCode) || null;
  const response = String(error.response || error.message || 'MailDeliveryError')
    .replace(/[\r\n\x00-\x1f\x7f]+/g, ' ')
    .replace(/[^\s@]+@[^\s@]+\.[^\s@]+/g, '[email]')
    .slice(0, 500);
  const permanent = responseCode >= 500;
  return {
    status: permanent || attempts >= MAX_ATTEMPTS ? 'failed' : 'pending',
    responseCode,
    detail: [error.code || error.name || 'MailDeliveryError', responseCode, response]
      .filter(Boolean)
      .join(': ')
  };
}

function buildAssignmentRejectedContent({ kind, taskKey, title, projectName, rejectedBy, closingRemarks }) {
  const itemType = 'Task';
  const safeTitle = String(title || 'Untitled').replace(/[\r\n\x00-\x1f\x7f]+/g, ' ').trim();
  const safeTaskKey = safeHeaderValue(taskKey);
  const identifier = safeTaskKey ? `${safeTaskKey}: ` : '';
  const subject = `[TaskTracker] ${itemType} rejected: ${identifier}${safeTitle}`;
  const text = [
    `The assignment for this ${itemType.toLowerCase()} was rejected.`,
    safeTaskKey ? `Task ID: ${safeTaskKey}` : '',
    `Title: ${title || 'Untitled'}`,
    `Project: ${projectName || 'Project'}`,
    `Rejected by: ${rejectedBy || 'Assigned user'}`,
    '',
    'Closing remarks:',
    closingRemarks
  ].join('\n');
  const html = `<p>The assignment for this ${itemType.toLowerCase()} was rejected.</p>
    <ul>
      ${safeTaskKey ? `<li><strong>Task ID:</strong> ${escapeHtml(safeTaskKey)}</li>` : ''}
      <li><strong>Title:</strong> ${escapeHtml(title || 'Untitled')}</li>
      <li><strong>Project:</strong> ${escapeHtml(projectName || 'Project')}</li>
      <li><strong>Rejected by:</strong> ${escapeHtml(rejectedBy || 'Assigned user')}</li>
    </ul>
    <p><strong>Closing remarks:</strong></p>
    <p>${escapeHtml(closingRemarks).replace(/\r?\n/g, '<br>')}</p>`;
  return { subject, text, html };
}

function buildTaskBlockedContent({ taskKey, title, projectName, blockedBy }) {
  const safeTitle = String(title || 'Untitled').replace(/[\r\n\x00-\x1f\x7f]+/g, ' ').trim();
  const safeTaskKey = safeHeaderValue(taskKey);
  const identifier = safeTaskKey ? `${safeTaskKey}: ` : '';
  const subject = `[TaskTracker] Task blocked: ${identifier}${safeTitle}`;
  const text = [
    'A task has been marked as blocked.',
    safeTaskKey ? `Task ID: ${safeTaskKey}` : '',
    `Title: ${title || 'Untitled'}`,
    `Project: ${projectName || 'Project'}`,
    `Blocked by: ${blockedBy || 'TaskTracker user'}`
  ].join('\n');
  const html = `<p>A task has been marked as blocked.</p>
    <ul>
      ${safeTaskKey ? `<li><strong>Task ID:</strong> ${escapeHtml(safeTaskKey)}</li>` : ''}
      <li><strong>Title:</strong> ${escapeHtml(title || 'Untitled')}</li>
      <li><strong>Project:</strong> ${escapeHtml(projectName || 'Project')}</li>
      <li><strong>Blocked by:</strong> ${escapeHtml(blockedBy || 'TaskTracker user')}</li>
    </ul>`;
  return { subject, text, html };
}

function buildTaskBlockedRecipients(blocker, stakeholders) {
  const blockerEmail = String(blocker?.email || '').trim();
  if (!blockerEmail || !EMAIL_PATTERN.test(blockerEmail)) {
    throw new Error('User who blocked the task does not have a valid email address');
  }
  const to = [{
    userId: blocker._id || blocker.id || null,
    email: blockerEmail,
    name: blocker.name || ''
  }];
  const cc = [];
  const seen = new Set([blockerEmail.toLowerCase()]);
  for (const stakeholder of stakeholders || []) {
    const email = String(stakeholder.email || '').trim();
    if (!email || !EMAIL_PATTERN.test(email)) {
      throw new Error('A project stakeholder does not have a valid email address');
    }
    const key = email.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    cc.push({
      userId: stakeholder.id || stakeholder._id || null,
      email,
      name: stakeholder.name || ''
    });
  }
  return { to, cc };
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

function buildAssignmentContent({ kind, item, project, assignedBy, clientUrl, acceptUrl, rejectUrl }) {
  const itemType = 'Task';
  const typeLabel = item.typeLabel
    || (String(item.type || '').toLowerCase() === 'other'
      ? (item.customTypeName ? `Other: ${item.customTypeName}` : 'Other')
      : (item.type || 'Task'));
  const safeTitle = String(item.title || '').replace(/[\r\n\x00-\x1f\x7f]+/g, ' ').trim();
  const safeTaskKey = safeHeaderValue(item.taskKey);
  const identifier = safeTaskKey ? `${safeTaskKey}: ` : '';
  const subject = `[TaskTracker] ${itemType} assigned: ${identifier}${safeTitle || 'Untitled'}`;
  const projectName = project.name || project.key || 'Project';
  const dueDate = item.dueDate || item.endDate || '';
  const safeDescriptionText = sanitizeHtml(item.description || '', { allowedTags: [], allowedAttributes: {} });
  const safeDescriptionHtml = sanitizeHtml(item.description || '', {
    allowedTags: ['p','br','strong','b','em','i','u','h1','h2','h3','ol','ul','li','a','blockquote','div','span','pre','code'],
    allowedAttributes: { a:['href','title','target','rel'], '*':['style','align'] },
    transformTags: {
      a: (tagName, attribs) => ({
        tagName,
        attribs: { ...attribs, target:'_blank', rel:'noopener noreferrer' }
      })
    }
  });
  const projectQuery = project._id ? `?project=${encodeURIComponent(project._id)}` : '';
  const resourceUrl = item._id
    ? `${clientUrl.replace(/\/+$/, '')}/tasks/${encodeURIComponent(item._id)}`
    : `${clientUrl.replace(/\/+$/, '')}/tasks${projectQuery}`;
  const text = [
    `Hello ${item.assignee?.name || 'there'},`,
    '',
    `A ${itemType.toLowerCase()} has been assigned to you.`,
    safeTaskKey ? `Task ID: ${safeTaskKey}` : '',
    `Title: ${item.title || 'Untitled'}`,
    `Type: ${typeLabel}`,
    `Project: ${projectName}${project.key ? ` (${project.key})` : ''}`,
    `Assigned by: ${assignedBy || 'TaskTracker user'}`,
    item.status ? `Status: ${item.status}` : '',
    dueDate ? `Due date: ${dueDate}` : '',
    safeDescriptionText ? `Description:\n${safeDescriptionText}` : '',
    '',
    'Accept this assignment (it will move the item to In Progress):',
    acceptUrl,
    '',
    'Reject this assignment and provide closing remarks:',
    rejectUrl,
    '',
    `Open TaskTracker: ${resourceUrl}`
  ].filter(Boolean).join('\n');
  const html = `<p>Hello ${escapeHtml(item.assignee?.name || 'there')},</p>
    <p>A ${itemType.toLowerCase()} has been assigned to you.</p>
    <ul>
      ${safeTaskKey ? `<li><strong>Task ID:</strong> ${escapeHtml(safeTaskKey)}</li>` : ''}
      <li><strong>Title:</strong> ${escapeHtml(item.title || 'Untitled')}</li>
      <li><strong>Type:</strong> ${escapeHtml(typeLabel)}</li>
      <li><strong>Project:</strong> ${escapeHtml(projectName)}${project.key ? ` (${escapeHtml(project.key)})` : ''}</li>
      <li><strong>Assigned by:</strong> ${escapeHtml(assignedBy || 'TaskTracker user')}</li>
      ${item.status ? `<li><strong>Status:</strong> ${escapeHtml(item.status)}</li>` : ''}
      ${dueDate ? `<li><strong>Due date:</strong> ${escapeHtml(dueDate)}</li>` : ''}
    </ul>
    ${safeDescriptionHtml ? `<div><strong>Description:</strong>${safeDescriptionHtml}</div>` : ''}
    <p>Accept this assignment to move it to In Progress:</p>
    <p><a href="${escapeHtml(acceptUrl)}" style="display:inline-block;padding:10px 18px;background:#1d9e75;color:#fff;text-decoration:none;border-radius:6px">Accept assignment</a></p>
    <p>Or reject it and provide closing remarks:</p>
    <p><a href="${escapeHtml(rejectUrl)}" style="display:inline-block;padding:10px 18px;background:#e24b4a;color:#fff;text-decoration:none;border-radius:6px">Reject assignment</a></p>
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
  if (kind !== 'task') throw new TypeError('Unsupported assignment email type');
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
  const token = crypto.randomBytes(32).toString('hex');
  const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
  const responsePage = new URL('/assignment-response', `${(process.env.CLIENT_URL || 'http://localhost:3000').split(',')[0].trim().replace(/\/+$/, '')}/`);
  responsePage.searchParams.set('token', token);
  const acceptUrl = new URL(responsePage);
  acceptUrl.searchParams.set('action', 'accept');
  const rejectUrl = new URL(responsePage);
  rejectUrl.searchParams.set('action', 'reject');
  const content = buildAssignmentContent({
    kind,
    item: { ...item, assignee },
    project,
    assignedBy: assignedByResult.rows[0]?.name || '',
    clientUrl: (process.env.CLIENT_URL || 'http://localhost:3000').split(',')[0].trim(),
    acceptUrl: acceptUrl.toString(),
    rejectUrl: rejectUrl.toString()
  });
  const idempotencyKey = `assignment:${kind}:${item._id}:${assigneeId}:${item.updatedAt || item.createdAt}`;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const currentAssignment = await client.query(
      `SELECT 1 FROM public.work_items
       WHERE id=$1 AND project_id=$2 AND assignee_user_id=$3
       FOR UPDATE`,
      [String(item._id), String(project._id), String(assigneeId)]
    );
    if (!currentAssignment.rowCount) {
      await client.query('ROLLBACK');
      return false;
    }
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
      return true;
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
    const attachmentRows = await client.query(
      `SELECT id, filename, size_bytes, storage_key
       FROM public.attachments
       WHERE work_item_id=$1 AND project_id=$2
       ORDER BY created_at, id`,
      [String(item._id), String(project._id)]
    );
    const maxEmailBytes = Number(process.env.MAX_ATTACHMENT_EMAIL_MB || 10) * 1024 * 1024;
    const totalBytes = attachmentRows.rows.reduce((sum, attachment) => sum + Number(attachment.size_bytes || 0), 0);
    if (totalBytes <= maxEmailBytes) {
      for (let index = 0; index < attachmentRows.rows.length; index += 1) {
        await client.query(
          `INSERT INTO public.email_attachments
           (email_outbox_id, attachment_id, delivery_mode, position)
           VALUES ($1,$2,'attached',$3)
           ON CONFLICT (email_outbox_id, attachment_id) DO NOTHING`,
          [emailId, attachmentRows.rows[index].id, index]
        );
      }
    } else {
      content.html += '<p><strong>Attachments:</strong> The task has attachments that are too large for email. <a href="' +
        escapeHtml(`${(process.env.CLIENT_URL || 'http://localhost:3000').split(',')[0].trim().replace(/\/+$/, '')}/tasks`) +
        '">Open TaskTracker to download them securely</a>.</p>';
      content.text += `\nAttachments: Open TaskTracker to download them securely: ${(process.env.CLIENT_URL || 'http://localhost:3000').split(',')[0].trim().replace(/\/+$/, '')}/tasks`;
      await client.query(
        `UPDATE public.email_outbox SET payload=$2::jsonb WHERE id=$1`,
        [emailId, JSON.stringify({ text: content.text, html: content.html })]
      );
    }
    await client.query(
      `UPDATE public.assignment_responses
       SET invalidated_at=now()
       WHERE work_item_id=$1 AND status='pending' AND invalidated_at IS NULL`,
      [String(item._id)]
    );
    await client.query(
      `INSERT INTO public.assignment_responses
       (email_outbox_id, work_item_id, assigned_user_id, assignee_email_snapshot, token_hash, expires_at)
       VALUES ($1, $2, $3, $4, $5, now() + interval '14 days')`,
      [emailId, String(item._id), String(assigneeId), to.email, tokenHash]
    );
    await notifyRecipients({
      client,
      recipients: [to, ...cc],
      actorUserId: assignedBy,
      type: 'task_assigned',
      title: 'Task assigned',
      message: `${item.title || 'A task'} was assigned to ${assignee.name || 'a team member'}.`,
      link: `/tasks/${item._id}`,
      entityType: 'task',
      entityId: item._id,
      projectId: project._id,
      idempotencyKey: `assignment:${emailId}`
    });
    await client.query('COMMIT');
    return true;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

async function queueTaskBlockedEmail({ task, project, blockedBy }) {
  const stakeholderResult = await pool.query(
    `SELECT u.id, u.name, u.email
     FROM public.project_stakeholders ps
     JOIN public.users u ON u.id=ps.user_id
     WHERE ps.project_id=$1 AND u.active
     ORDER BY u.name, u.id`,
    [String(project._id)]
  );
  const { to, cc } = buildTaskBlockedRecipients(blockedBy, stakeholderResult.rows);
  const content = buildTaskBlockedContent({
    taskKey: task.taskKey,
    title: task.title,
    projectName: project.name || project.key,
    blockedBy: blockedBy.name || blockedBy.email
  });
  const idempotencyKey = `task-blocked:${task._id}:${task.updatedAt || task.createdAt}`;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query(
      `INSERT INTO public.email_outbox
       (event_type, subject, payload, status, idempotency_key)
       VALUES ('task_blocked', $1, $2::jsonb, 'pending', $3)
       ON CONFLICT (idempotency_key) DO NOTHING
       RETURNING id`,
      [content.subject, JSON.stringify({ text: content.text, html: content.html }), idempotencyKey]
    );
    if (!rows.length) {
      await client.query('COMMIT');
      return true;
    }
    const emailId = rows[0].id;
    for (const recipient of to) {
      await client.query(
        `INSERT INTO public.email_recipients
         (email_outbox_id, user_id, email_snapshot, name_snapshot, recipient_type, delivery_status)
         VALUES ($1, $2, $3, $4, 'to', 'pending')`,
        [emailId, recipient.userId, recipient.email, recipient.name]
      );
    }
    for (const recipient of cc) {
      await client.query(
        `INSERT INTO public.email_recipients
         (email_outbox_id, user_id, email_snapshot, name_snapshot, recipient_type, delivery_status)
         VALUES ($1, $2, $3, $4, 'cc', 'pending')`,
        [emailId, recipient.userId, recipient.email, recipient.name]
      );
    }
    await client.query(
      `INSERT INTO public.email_resources (email_outbox_id, project_scope_id, work_item_id)
       VALUES ($1, $2, $3)`,
      [emailId, String(project._id), String(task._id)]
    );
    await notifyRecipients({
      client,
      recipients: [...to, ...cc],
      actorUserId: blockedBy._id || blockedBy.id,
      type: 'task_blocked',
      title: 'Task blocked',
      message: `${task.title || 'A task'} was marked as blocked.`,
      link: `/tasks/${task._id}`,
      entityType: 'task',
      entityId: task._id,
      projectId: project._id,
      idempotencyKey: `task-blocked:${emailId}`
    });
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
    const attachmentRows = await client.query(
      `SELECT a.filename,a.storage_key
       FROM public.email_attachments ea
       JOIN public.attachments a ON a.id=ea.attachment_id
       WHERE ea.email_outbox_id=$1 AND ea.delivery_mode='attached'
       ORDER BY ea.position`,
      [email.id]
    );
    await client.query('COMMIT');
    email.payload = typeof email.payload === 'string' ? JSON.parse(email.payload) : email.payload;
    email.to = recipients.rows.filter(recipient => recipient.recipient_type === 'to').map(recipient => recipient.email_snapshot);
    email.cc = recipients.rows.filter(recipient => recipient.recipient_type === 'cc').map(recipient => recipient.email_snapshot);
    email.attachments = attachmentRows.rows.map((attachment) => ({
      filename: attachment.filename,
      path: attachment.storage_key.startsWith('/uploads/')
        ? path.join(__dirname, '..', '..', 'uploads', attachment.storage_key.replace(/^\/uploads\//, ''))
        : attachment.storage_key
    })).filter((attachment) => fs.existsSync(attachment.path));
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
      html: email.payload.html,
      attachments: email.attachments || []
    });
  } catch (error) {
    const failure = getDeliveryFailure(error, email.attempts);
    const delayMinutes = Math.min(60, 2 ** (email.attempts - 1));
    await pool.query(
      `UPDATE public.email_outbox
       SET status=$2, last_error=$3,
           next_attempt_at=now() + ($4 * interval '1 minute')
       WHERE id=$1`,
      [email.id, failure.status, failure.detail, delayMinutes]
    );
    await pool.query(
      `UPDATE public.email_recipients
       SET delivery_status=$2
       WHERE email_outbox_id=$1`,
      [email.id, failure.status]
    );
    console.error(`Assignment email delivery failed (${email.id}):`, failure.detail);
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

function buildProjectClosureContent({ project, closure, clientUrl, secureDownloadLink }) {
  const projectName = String(project.name || project.key || 'Project');
  const safeProjectName = escapeHtml(projectName);
  const projectLink = `${String(clientUrl || 'http://localhost:3000').replace(/\/+$/, '')}/projects/${encodeURIComponent(project.id || project._id)}`;
  const snapshot = closure.snapshot || {};
  const remarksHtml = sanitizeHtml(closure.closingRemarksHtml || '', {
    allowedTags:['p','br','strong','b','em','i','u','h1','h2','h3','ol','ul','li','a','blockquote'],
    allowedAttributes:{ a:['href','title','target','rel'] },
    transformTags:{
      a:(tagName,attribs) => ({
        tagName,
        attribs:{ ...attribs,target:'_blank',rel:'noopener noreferrer' }
      })
    }
  });
  const links = Array.isArray(closure.links) ? closure.links : [];
  const linksHtml = links.length
    ? `<ul>${links.map((link) => `<li><a href="${escapeHtml(link.url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(link.label || link.url)}</a></li>`).join('')}</ul>`
    : '<p>None</p>';
  const attachmentsHtml = secureDownloadLink
    ? `<p>Project closure files are available securely in TaskTracker: <a href="${escapeHtml(projectLink)}">Open project</a>.</p>`
    : '';
  const closedDate = closure.closedAt ? new Date(closure.closedAt).toLocaleDateString('en-US', { timeZone:'UTC' }) : '';
  const summary = `${Number(snapshot.completedTasks || 0)} completed of ${Number(snapshot.totalTasks || 0)} tasks; ${Number(snapshot.completionPercent || 0)}% completion; ${Number(snapshot.durationDays || 0)} days.`;
  const subject = `[TaskTracker] Project closed: ${String(projectName).replace(/[\r\n\x00-\x1f\x7f]+/g, ' ').trim()}`;
  const text = [
    `Thank you for closing ${projectName}.`,
    `Status: Closed`,
    `Closed by: ${closure.closedByName || 'Project team member'}`,
    `Closed date: ${closedDate}`,
    `Summary: ${summary}`,
    '',
    'Closing remarks:',
    String(closure.closingRemarksText || ''),
    '',
    'Links:',
    ...links.map((link) => `${link.label ? `${link.label}: ` : ''}${link.url}`),
    attachmentsHtml ? `Closure attachments: ${projectLink}` : '',
    `Project: ${projectLink}`
  ].filter(Boolean).join('\n');
  const html = `<p>Thank you for the work that went into completing <strong>${safeProjectName}</strong>.</p>
    <ul>
      <li><strong>Status:</strong> Closed</li>
      <li><strong>Closed by:</strong> ${escapeHtml(closure.closedByName || 'Project team member')}</li>
      <li><strong>Closed date:</strong> ${escapeHtml(closedDate)}</li>
      <li><strong>Summary:</strong> ${escapeHtml(summary)}</li>
    </ul>
    <p><strong>Closing remarks:</strong></p>${remarksHtml}
    <p><strong>Links:</strong></p>${linksHtml}${attachmentsHtml}
    <p><a href="${escapeHtml(projectLink)}">Open project in TaskTracker</a></p>`;
  return { subject, text, html };
}

async function queueProjectClosureEmail({
  project, closure, recipients, attachments, transactionClient, notificationRecipients
}) {
  const to = [];
  const cc = [];
  const seenTo = new Set();
  const seenAll = new Set();
  for (const recipient of recipients.to || []) {
    const email = String(recipient.email || '').trim();
    const key = email.toLowerCase();
    if (!email || !EMAIL_PATTERN.test(email) || seenTo.has(key)) continue;
    seenTo.add(key);
    seenAll.add(key);
    to.push({ ...recipient, email });
  }
  for (const recipient of recipients.cc || []) {
    const email = String(recipient.email || '').trim();
    const key = email.toLowerCase();
    if (!email || !EMAIL_PATTERN.test(email) || seenAll.has(key)) continue;
    seenAll.add(key);
    cc.push({ ...recipient, email });
  }
  const maxEmailBytes = Number(process.env.MAX_ATTACHMENT_EMAIL_MB || 10) * 1024 * 1024;
  const totalBytes = (attachments || []).reduce((total, attachment) => total + Number(attachment.sizeBytes || 0), 0);
  const secureDownloadLink = totalBytes > maxEmailBytes;
  const content = buildProjectClosureContent({
    project, closure,
    clientUrl:(process.env.CLIENT_URL || 'http://localhost:3000').split(',')[0].trim(),
    secureDownloadLink
  });
  const projectMessage = `${project.name || project.key || 'A project'} was closed.${
    closure.closingRemarksText ? ` ${closure.closingRemarksText}` : ''
  }`;
  const ownsClient = !transactionClient;
  const client = transactionClient || await pool.connect();
  try {
    if (ownsClient) await client.query('BEGIN');
    await notifyRecipients({
      client,
      recipients: notificationRecipients || [...to, ...cc],
      actorUserId: closure.closedBy,
      type: 'project_closed',
      title: 'Project closed',
      message: projectMessage,
      link: `/projects/${project.id || project._id}`,
      entityType: 'project',
      entityId: project.id || project._id,
      idempotencyKey: `project-closure:${closure.id}:closed`
    });
    if (!to.length) {
      console.error('Project closure appreciation email was not queued: no valid To recipient');
      if (ownsClient) await client.query('COMMIT');
      return false;
    }
    const { rows } = await client.query(
      `INSERT INTO public.email_outbox (event_type,subject,payload,status,idempotency_key)
       VALUES ('project_closed',$1,$2::jsonb,'pending',$3)
       ON CONFLICT (idempotency_key) DO NOTHING
       RETURNING id`,
      [content.subject, JSON.stringify({ text:content.text,html:content.html }),
        `project-closure:${closure.id}:appreciation`]
    );
    if (!rows.length) {
      if (ownsClient) await client.query('COMMIT');
      return true;
    }
    const emailId = rows[0].id;
    for (const recipient of to) {
      await client.query(
        `INSERT INTO public.email_recipients
         (email_outbox_id,user_id,email_snapshot,name_snapshot,recipient_type,delivery_status)
         VALUES ($1,$2,$3,$4,'to','pending')
         ON CONFLICT (email_outbox_id,email_snapshot,recipient_type) DO NOTHING`,
        [emailId,recipient.userId || null,recipient.email,recipient.name || '']
      );
    }
    for (const recipient of cc) {
      await client.query(
        `INSERT INTO public.email_recipients
         (email_outbox_id,user_id,email_snapshot,name_snapshot,recipient_type,delivery_status)
         VALUES ($1,$2,$3,$4,'cc','pending')
         ON CONFLICT (email_outbox_id,email_snapshot,recipient_type) DO NOTHING`,
        [emailId,recipient.userId || null,recipient.email,recipient.name || '']
      );
    }
    await client.query(
      `INSERT INTO public.email_resources (email_outbox_id,project_scope_id,target_project_id)
       VALUES ($1,$2,$2)`,
      [emailId,String(project.id || project._id)]
    );
    for (const [index, attachment] of (attachments || []).entries()) {
      await client.query(
        `INSERT INTO public.email_attachments (email_outbox_id,attachment_id,delivery_mode,position)
         VALUES ($1,$2,$3,$4)
         ON CONFLICT (email_outbox_id,attachment_id) DO NOTHING`,
        [emailId,attachment.id,secureDownloadLink ? 'secure_link' : 'attached',index]
      );
    }
    if (ownsClient) await client.query('COMMIT');
    return true;
  } catch (error) {
    if (ownsClient) await client.query('ROLLBACK');
    throw error;
  } finally {
    if (ownsClient) client.release();
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
  escapeHtml,
  buildRecipients,
  buildAssignmentContent,
  buildAssignmentRejectedContent,
  buildTaskBlockedContent,
  buildProjectClosureContent,
  queueProjectClosureEmail,
  buildTaskBlockedRecipients,
  getDeliveryFailure,
  queueAssignmentEmail,
  queueTaskBlockedEmail,
  processPendingEmails,
  startEmailWorker
};
