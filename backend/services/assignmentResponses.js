const crypto = require('crypto');
const pool = require('../config/db');
const {
  SENDER_EMAIL,
  buildAssignmentRejectedContent
} = require('./emailService');

class AssignmentResponseError extends Error {
  constructor(message, status) {
    super(message);
    this.status = status;
  }
}

async function respondToAssignment({ token, action, closingRemarks }) {
  if (typeof token !== 'string' || !/^[a-f0-9]{64}$/i.test(token)) {
    throw new AssignmentResponseError('This assignment link is invalid.', 400);
  }
  if (!['accept', 'reject'].includes(action)) {
    throw new AssignmentResponseError('Choose accept or reject.', 400);
  }
  if (action === 'reject'
    && (typeof closingRemarks !== 'string' || !closingRemarks.trim() || closingRemarks.trim().length > 2000)) {
    throw new AssignmentResponseError('Rejection requires closing remarks of 1 to 2000 characters.', 400);
  }

  const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
  const client = await pool.connect();
  let transactionOpen = false;
  try {
    await client.query('BEGIN');
    transactionOpen = true;
    const { rows } = await client.query(
      `SELECT ar.id, ar.work_item_id, ar.assigned_user_id, ar.assignee_email_snapshot,
              ar.status AS response_status, ar.expires_at, ar.invalidated_at,
              wi.project_id, wi.kind, wi.title, wi.status AS item_status,
              wi.assignee_user_id, u.name AS assignee_name,
              p.name AS project_name, p.key AS project_key
       FROM public.assignment_responses ar
       JOIN public.work_items wi ON wi.id=ar.work_item_id
       LEFT JOIN public.users u ON u.id=ar.assigned_user_id
       JOIN public.projects p ON p.id=wi.project_id
       WHERE ar.token_hash=$1
       FOR UPDATE OF ar, wi`,
      [tokenHash]
    );
    const assignment = rows[0];
    if (!assignment) {
      await client.query('ROLLBACK');
      transactionOpen = false;
      throw new AssignmentResponseError('This assignment link is invalid.', 404);
    }
    if (assignment.response_status !== 'pending' || assignment.invalidated_at) {
      await client.query('ROLLBACK');
      transactionOpen = false;
      throw new AssignmentResponseError('This assignment link has already been used or replaced.', 409);
    }
    if (new Date(assignment.expires_at) <= new Date()
      || !assignment.assigned_user_id
      || assignment.assignee_user_id !== assignment.assigned_user_id) {
      await client.query(
        `UPDATE public.assignment_responses
         SET status='expired', invalidated_at=COALESCE(invalidated_at, now())
         WHERE id=$1`,
        [assignment.id]
      );
      await client.query('COMMIT');
      transactionOpen = false;
      throw new AssignmentResponseError('This assignment link has expired or the item has been reassigned.', 410);
    }

    if (['completed', 'closed', 'cancelled', 'canceled', 'resolved']
      .includes(String(assignment.item_status).toLowerCase())) {
      await client.query(
        `UPDATE public.assignment_responses
         SET status='expired', invalidated_at=now()
         WHERE id=$1`,
        [assignment.id]
      );
      await client.query('COMMIT');
      transactionOpen = false;
      throw new AssignmentResponseError('This work item is already closed and cannot receive an assignment response.', 409);
    }

    const acceptedStatus = 'In progress';
    const responseStatus = action === 'accept' ? 'accepted' : 'rejected';
    if (action === 'accept') {
      await client.query(
        `UPDATE public.work_items
         SET status=$2, updated_at=now()
         WHERE id=$1 AND assignee_user_id=$3`,
        [assignment.work_item_id, acceptedStatus, assignment.assigned_user_id]
      );
    } else {
      await client.query(
        `UPDATE public.work_items
         SET status='Rejected',
             rejected_by_user_id=$2, rejected_at=now(),
             closing_remarks=$3, reject_reason=$3, updated_at=now()
         WHERE id=$1 AND assignee_user_id=$2`,
        [assignment.work_item_id, assignment.assigned_user_id, closingRemarks.trim()]
      );
    }
    await client.query(
      `UPDATE public.assignment_responses
       SET status=$2, closing_remarks=$3, responded_at=now()
       WHERE id=$1`,
      [assignment.id, responseStatus, action === 'reject' ? closingRemarks.trim() : null]
    );
    await client.query(
      `INSERT INTO public.audit_log
       (actor_user_id, actor_snapshot, action, resource_type, resource_id,
        resource_snapshot, before, after)
       VALUES ($1, $2::jsonb, $3, 'work_item', $4, $5::jsonb, $6::jsonb, $7::jsonb)`,
      [
        assignment.assigned_user_id,
        JSON.stringify({ name: assignment.assignee_name || '', email: assignment.assignee_email_snapshot }),
        `assignment.${responseStatus}`,
        assignment.work_item_id,
        JSON.stringify({ kind: assignment.kind, title: assignment.title, projectId: assignment.project_id }),
        JSON.stringify({ status: assignment.item_status }),
        JSON.stringify(action === 'accept'
          ? { response: responseStatus, status: acceptedStatus }
          : { response: responseStatus, status: 'Rejected', closingRemarks: closingRemarks.trim() })
      ]
    );
    if (action === 'reject') {
      const { rows: stakeholderRows } = await client.query(
        `SELECT u.id, u.name, u.email
         FROM public.project_stakeholders ps
         JOIN public.users u ON u.id=ps.user_id
         WHERE ps.project_id=$1 AND u.active
         ORDER BY u.name, u.id`,
        [assignment.project_id]
      );
      const recipients = [];
      const seen = new Set([assignment.assignee_email_snapshot.toLowerCase()]);
      for (const stakeholder of [...stakeholderRows, { id: null, name: 'TaskTracker Admin', email: SENDER_EMAIL }]) {
        const email = String(stakeholder.email || '').trim();
        const key = email.toLowerCase();
        if (!email || seen.has(key)) continue;
        seen.add(key);
        recipients.push({
          id: stakeholder.id,
          name: stakeholder.name || '',
          email
        });
      }
      const content = buildAssignmentRejectedContent({
        kind: assignment.kind,
        title: assignment.title,
        projectName: assignment.project_name || assignment.project_key,
        rejectedBy: assignment.assignee_name || assignment.assignee_email_snapshot,
        closingRemarks: closingRemarks.trim()
      });
      const { rows: outboxRows } = await client.query(
        `INSERT INTO public.email_outbox
         (event_type, subject, payload, status, idempotency_key)
         VALUES ('assignment_rejected', $1, $2::jsonb, 'pending', $3)
         ON CONFLICT (idempotency_key) DO NOTHING
         RETURNING id`,
        [
          content.subject,
          JSON.stringify({ text: content.text, html: content.html }),
          `assignment-rejected:${assignment.id}`
        ]
      );
      if (outboxRows.length) {
        const emailId = outboxRows[0].id;
        await client.query(
          `INSERT INTO public.email_recipients
           (email_outbox_id, user_id, email_snapshot, name_snapshot, recipient_type, delivery_status)
           VALUES ($1, $2, $3, $4, 'to', 'pending')`,
          [emailId, assignment.assigned_user_id, assignment.assignee_email_snapshot, assignment.assignee_name || '']
        );
        for (const recipient of recipients) {
          await client.query(
            `INSERT INTO public.email_recipients
             (email_outbox_id, user_id, email_snapshot, name_snapshot, recipient_type, delivery_status)
             VALUES ($1, $2, $3, $4, 'cc', 'pending')`,
            [emailId, recipient.id, recipient.email, recipient.name]
          );
        }
        await client.query(
          `INSERT INTO public.email_resources (email_outbox_id, project_scope_id, work_item_id)
           VALUES ($1, $2, $3)`,
          [emailId, assignment.project_id, assignment.work_item_id]
        );
      }
    }
    await client.query('COMMIT');
    transactionOpen = false;
    return action === 'accept'
      ? { status: responseStatus, message: 'Assignment accepted. The item is now In Progress.' }
      : { status: responseStatus, message: 'Assignment rejected. Your closing remarks were recorded.' };
  } catch (error) {
    if (transactionOpen) {
      try {
        await client.query('ROLLBACK');
      } catch (rollbackError) {
        console.error('Unable to roll back assignment response:', rollbackError.name);
      }
    }
    throw error;
  } finally {
    client.release();
  }
}

module.exports = { respondToAssignment, AssignmentResponseError };
