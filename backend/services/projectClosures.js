const pool = require('../config/db');
const fs = require('fs');
const path = require('path');
const { queueProjectClosureEmail } = require('./emailService');
const { notifyRecipients } = require('./notificationService');

function closureError(message, status = 400, code) {
  return Object.assign(new Error(message), { status, code });
}

async function countOpenProjectTasks(queryable, projectId) {
  const { rows } = await queryable.query(
    `SELECT count(*)::int AS total
     FROM public.work_items w
     JOIN public.tasks t ON t.work_item_id=w.id
     WHERE w.project_id=$1 AND t.is_backlog=false
       AND w.status NOT IN ('Completed','Closed','Resolved','Rejected')`,
    [String(projectId)]
  );
  return rows[0].total;
}

async function getProjectClosureHistory(projectId) {
  const { rows } = await pool.query(
    `SELECT c.id,c.project_id,c.closed_by_user_id,c.closed_at,c.previous_status,
            c.closing_remarks_html,c.links,c.snapshot,c.reopened_by_user_id,
            c.reopened_at,c.reopening_remarks,u.name AS closed_by_name,
            ru.name AS reopened_by_name
     FROM public.project_closures c
     JOIN public.users u ON u.id=c.closed_by_user_id
     LEFT JOIN public.users ru ON ru.id=c.reopened_by_user_id
     WHERE c.project_id=$1
     ORDER BY c.closed_at DESC,c.id`,
    [String(projectId)]
  );
  if (!rows.length) return [];
  const ids = rows.map((row) => row.id);
  const attachmentResult = await pool.query(
    `SELECT id,project_closure_id,filename,mime,size_bytes,uploaded_by_user_id,created_at
     FROM public.attachments
     WHERE project_closure_id=ANY($1::text[])
     ORDER BY created_at,id`,
    [ids]
  );
  const attachmentsByClosure = new Map();
  for (const attachment of attachmentResult.rows) {
    const list = attachmentsByClosure.get(attachment.project_closure_id) || [];
    list.push({
      id:attachment.id,filename:attachment.filename,mime:attachment.mime,
      sizeBytes:Number(attachment.size_bytes),uploadedBy:attachment.uploaded_by_user_id,
      createdAt:attachment.created_at
    });
    attachmentsByClosure.set(attachment.project_closure_id,list);
  }
  return rows.map((row) => ({
    id:row.id,
    projectId:row.project_id,
    closedBy:row.closed_by_user_id,
    closedByName:row.closed_by_name,
    closedAt:row.closed_at,
    previousStatus:row.previous_status,
    closingRemarksHtml:row.closing_remarks_html,
    links:row.links,
    snapshot:row.snapshot,
    reopenedBy:row.reopened_by_user_id || '',
    reopenedByName:row.reopened_by_name || '',
    reopenedAt:row.reopened_at,
    reopeningRemarks:row.reopening_remarks || '',
    attachments:attachmentsByClosure.get(row.id) || []
  }));
}

async function activeProjectUsers(client, projectId, ownerId, closerId) {
  const { rows } = await client.query(
    `SELECT DISTINCT u.id,u.name,u.email,u.active
     FROM public.users u
     LEFT JOIN public.project_stakeholders ps
       ON ps.user_id=u.id AND ps.project_id=$1
     WHERE u.id=$2 OR u.id=$3 OR (u.active AND ps.user_id IS NOT NULL)
     ORDER BY u.id`,
    [String(projectId),String(ownerId),String(closerId)]
  );
  return rows;
}

async function addProjectNotifications(client, { projectId, closure, actorId, action, recipients, details }) {
  await notifyRecipients({
    client,
    recipients,
    actorUserId: actorId,
    type: `project_${action}`,
    title: action === 'reopened' ? 'Project reopened' : 'Project closed',
    message: details,
    link: `/projects/${projectId}`,
    entityType: 'project',
    entityId: projectId,
    idempotencyKey: `project-closure:${closure.id}:${action}`
  });
}

function makeEmailRecipients(users, ownerId, closerId) {
  const usersById = new Map(users.map((user) => [String(user.id), user]));
  const isValidEmail = (email) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email || '').trim());
  const to = [];
  const seenTo = new Set();
  for (const id of [closerId,ownerId]) {
    const user = usersById.get(String(id));
    const email = String(user?.email || '').trim();
    const key = email.toLowerCase();
    if (!user || !isValidEmail(email) || seenTo.has(key)) continue;
    seenTo.add(key);
    to.push({ userId:user.id,email,name:user.name });
  }
  const cc = [];
  const seen = new Set(seenTo);
  for (const user of users) {
    if (String(user.id) === String(ownerId) || String(user.id) === String(closerId)) continue;
    const email = String(user.email || '').trim();
    const key = email.toLowerCase();
    if (!isValidEmail(email) || seen.has(key)) continue;
    seen.add(key);
    cc.push({ userId:user.id,email,name:user.name });
  }
  return { to,cc };
}

async function projectSnapshot(client, projectId) {
  const taskResult = await client.query(
    `SELECT count(*)::int AS total,
      count(*) FILTER (WHERE w.status IN ('Completed','Closed','Resolved'))::int AS completed,
      count(*) FILTER (WHERE w.status='Rejected')::int AS rejected
     FROM public.work_items w
     JOIN public.tasks t ON t.work_item_id=w.id
     WHERE w.project_id=$1 AND t.is_backlog=false`,
    [String(projectId)]
  );
  const milestoneResult = await client.query(
    `SELECT count(*)::int AS total,
      count(*) FILTER (WHERE status='completed')::int AS completed
     FROM public.milestones WHERE project_id=$1`,
    [String(projectId)]
  );
  const task = taskResult.rows[0];
  const milestone = milestoneResult.rows[0];
  const denominator = task.total - task.rejected;
  return {
    totalTasks:task.total,
    completedTasks:task.completed,
    rejectedTasks:task.rejected,
    completionPercent:denominator ? Math.round((task.completed / denominator) * 100) : 0,
    milestones:{ total:milestone.total,completed:milestone.completed },
    durationDays:null
  };
}

async function closeProject({ projectId, user, closingRemarksHtml, closingRemarksText, links, uploadIds, blockWithOpenTasks }) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const projectResult = await client.query(
      `SELECT p.id,p.name,p.key,p.status,p.start_date,p.created_at,p.owner_user_id,
              owner.name AS owner_name
       FROM public.projects p
       JOIN public.users owner ON owner.id=p.owner_user_id
       WHERE p.id=$1 FOR UPDATE OF p`,
      [String(projectId)]
    );
    if (!projectResult.rows.length) throw closureError('Project not found',404);
    const project = projectResult.rows[0];
    const openTaskCount = await countOpenProjectTasks(client,projectId);
    if (project.status === 'closed') {
      const { rows } = await client.query(
        `SELECT c.id,c.closed_at,c.closing_remarks_html,c.links,c.snapshot,c.previous_status,
                c.closed_by_user_id,u.name AS closed_by_name
         FROM public.project_closures c
         JOIN public.users u ON u.id=c.closed_by_user_id
         WHERE c.project_id=$1 AND c.reopened_at IS NULL`,
        [String(projectId)]
      );
      if (!rows.length) throw closureError('Closed project closure history is missing',500);
      await client.query('COMMIT');
      return { alreadyClosed:true,openTaskCount,closure:mapClosure(rows[0]),project };
    }
    if (blockWithOpenTasks && openTaskCount > 0) {
      throw closureError(`This project has ${openTaskCount} open task${openTaskCount === 1 ? '' : 's'} and cannot be closed`,409,'OPEN_TASKS_BLOCKED');
    }
    const uniqueUploadIds = [...new Set((uploadIds || []).map(String))];
    if (uniqueUploadIds.length > 10) throw closureError('A maximum of 10 closure attachments is allowed');
    let stagedUploads = [];
    if (uniqueUploadIds.length) {
      const stagedResult = await client.query(
        `SELECT id,filename,mime,size_bytes,storage_key
         FROM public.project_closure_uploads
         WHERE project_id=$1 AND uploaded_by_user_id=$2 AND id=ANY($3::text[])
         ORDER BY created_at,id`,
        [String(projectId),String(user._id),uniqueUploadIds]
      );
      if (stagedResult.rows.length !== uniqueUploadIds.length) {
        throw closureError('One or more closure attachments are invalid or expired');
      }
      stagedUploads = stagedResult.rows;
    }

    const snapshot = await projectSnapshot(client,projectId);
    const { rows:durationRows } = await client.query(
      `SELECT GREATEST(0,(CURRENT_DATE-COALESCE(start_date,created_at::date)))::int AS duration_days
       FROM public.projects WHERE id=$1`,
      [String(projectId)]
    );
    snapshot.durationDays = durationRows[0].duration_days;
    const { rows:closureRows } = await client.query(
      `INSERT INTO public.project_closures
       (project_id,closed_by_user_id,previous_status,closing_remarks_html,links,snapshot)
       VALUES ($1,$2,$3,$4,$5::jsonb,$6::jsonb)
       RETURNING id,project_id,closed_by_user_id,closed_at,previous_status,
                 closing_remarks_html,links,snapshot`,
      [String(projectId),String(user._id),project.status,closingRemarksHtml,
        JSON.stringify(links),JSON.stringify(snapshot)]
    );
    const closure = mapClosure(closureRows[0]);
    const attachmentRows = [];
    for (const upload of stagedUploads) {
      const { rows } = await client.query(
        `INSERT INTO public.attachments
         (project_id,project_closure_id,filename,mime,size_bytes,storage_key,status,uploaded_by_user_id,scan_status)
         VALUES ($1,$2,$3,$4,$5,$6,'legacy',$7,'unverified')
         RETURNING id,filename,mime,size_bytes,storage_key`,
        [String(projectId),closure.id,upload.filename,upload.mime,upload.size_bytes,upload.storage_key,String(user._id)]
      );
      attachmentRows.push({
        id:rows[0].id,filename:rows[0].filename,mime:rows[0].mime,
        sizeBytes:Number(rows[0].size_bytes),storageKey:rows[0].storage_key
      });
    }
    const stagedCleanup = await client.query(
      'DELETE FROM public.project_closure_uploads WHERE project_id=$1 RETURNING storage_key',
      [String(projectId)]
    );
    await client.query(
      `UPDATE public.projects SET status='closed',updated_at=now() WHERE id=$1`,
      [String(projectId)]
    );
    await client.query(
      `INSERT INTO public.activity_log
       (project_id,actor_user_id,action,details,before,after)
       VALUES ($1,$2,'project_closed',$3,$4::jsonb,$5::jsonb)`,
      [String(projectId),String(user._id),closingRemarksText,
        JSON.stringify({ status:project.status }),JSON.stringify({ status:'closed',snapshot })]
    );

    const users = await activeProjectUsers(client,projectId,project.owner_user_id,user._id);
    const emailRecipients = makeEmailRecipients(users,project.owner_user_id,user._id);
    closure.closedByName = users.find((entry) => String(entry.id) === String(user._id))?.name || '';
    closure.closingRemarksText = closingRemarksText;
    const queued = await queueProjectClosureEmail({
      transactionClient:client,
      project:{ id:project.id,name:project.name,key:project.key },
      closure,
      recipients:emailRecipients,
      attachments:attachmentRows,
      notificationRecipients:users
    });
    if (!queued) console.error(`Appreciation email for project closure ${closure.id} could not be queued`);
    await client.query('COMMIT');
    const retainedKeys = new Set(attachmentRows.map((attachment) => attachment.storageKey));
    for (const staged of stagedCleanup.rows) {
      if (retainedKeys.has(staged.storage_key)) continue;
      try {
        const storagePrefix = '/uploads/project-closures/';
        if (!staged.storage_key.startsWith(storagePrefix)) throw new Error('Invalid staged closure storage key');
        const root = path.resolve(__dirname,'..','..','uploads','project-closures');
        const filePath = path.resolve(root,staged.storage_key.slice(storagePrefix.length));
        if (!filePath.startsWith(`${root}${path.sep}`)) throw new Error('Invalid staged closure storage path');
        await fs.promises.unlink(filePath);
      } catch (error) {
        if (error.code !== 'ENOENT') console.error('Unable to remove unused closure upload:',error.message);
      }
    }
    closure.attachments = attachmentRows.map(({ storageKey,...attachment }) => attachment);
    return { alreadyClosed:false,openTaskCount,closure,project,emailQueued:queued };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

function mapClosure(row) {
  return {
    id:row.id,projectId:row.project_id,closedBy:row.closed_by_user_id,
    closedByName:row.closed_by_name || '',closedAt:row.closed_at,
    previousStatus:row.previous_status,closingRemarksHtml:row.closing_remarks_html,
    links:row.links || [],snapshot:row.snapshot || {}
  };
}

async function reopenProject({ projectId,user,reopeningRemarks }) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const projectResult = await client.query(
      `SELECT id,name,key,status FROM public.projects WHERE id=$1 FOR UPDATE`,
      [String(projectId)]
    );
    if (!projectResult.rows.length) throw closureError('Project not found',404);
    const project = projectResult.rows[0];
    if (project.status !== 'closed') throw closureError('Only closed projects can be reopened',409);
    const { rows:closureRows } = await client.query(
      `SELECT id,previous_status FROM public.project_closures
       WHERE project_id=$1 AND reopened_at IS NULL FOR UPDATE`,
      [String(projectId)]
    );
    if (!closureRows.length) throw closureError('Project closure history is missing',500);
    const closure = closureRows[0];
    await client.query("SET LOCAL app.project_reopen='true'");
    await client.query(
      `UPDATE public.projects SET status=$2,updated_at=now() WHERE id=$1`,
      [String(projectId),closure.previous_status]
    );
    await client.query(
      `UPDATE public.project_closures
       SET reopened_by_user_id=$2,reopened_at=now(),reopening_remarks=$3
       WHERE id=$1`,
      [closure.id,String(user._id),reopeningRemarks]
    );
    await client.query(
      `INSERT INTO public.activity_log
       (project_id,actor_user_id,action,details,before,after)
       VALUES ($1,$2,'project_reopened',$3,$4::jsonb,$5::jsonb)`,
      [String(projectId),String(user._id),reopeningRemarks,
        JSON.stringify({ status:'closed' }),JSON.stringify({ status:closure.previous_status,closureId:closure.id })]
    );
    const { rows:recipients } = await client.query(
      `SELECT DISTINCT u.id,u.name
       FROM public.users u
       LEFT JOIN public.project_stakeholders ps
         ON ps.user_id=u.id AND ps.project_id=$1
       JOIN public.project_closures c ON c.id=$2
       WHERE u.id=(
           SELECT owner_user_id FROM public.projects WHERE id=$1
         ) OR ps.user_id IS NOT NULL
       ORDER BY u.id`,
      [String(projectId),closure.id]
    );
    await addProjectNotifications(client,{
      projectId,
      closure:{ id:closure.id },actorId:user._id,action:'reopened',
      recipients,details:`${project.name} was reopened. ${reopeningRemarks}`
    });
    await client.query('COMMIT');
    return { projectId:String(projectId),status:closure.previous_status,closureId:closure.id };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

async function findClosureAttachment(user, projectId, attachmentId) {
  const { rows } = await pool.query(
    `SELECT a.id,a.project_id,a.filename,a.mime,a.size_bytes,a.storage_key,
            c.id AS closure_id
     FROM public.attachments a
     JOIN public.project_closures c ON c.id=a.project_closure_id AND c.project_id=a.project_id
     WHERE a.id=$1 AND a.project_id=$2`,
    [String(attachmentId),String(projectId)]
  );
  return rows[0] || null;
}

module.exports = {
  countOpenProjectTasks,
  getProjectClosureHistory,
  closeProject,
  reopenProject,
  findClosureAttachment
};
