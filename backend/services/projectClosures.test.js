const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const fs = require('fs');
const express = require('express');
const jwt = require('jsonwebtoken');
const path = require('path');
const pool = require('../config/db');
const { PostgresStore } = require('./postgresStore');
const {
  closeProject,
  getProjectClosureHistory
} = require('./projectClosures');

async function createFixture() {
  const store = new PostgresStore();
  const suffix = crypto.randomUUID();
  let owner;
  let stakeholder;
  let manager;
  let projectId;
  try {
  owner = await store.insert('users',{
    name:'Project Closure Owner',
    email:`project-closure-owner-${suffix}@invalid.test`,
    password:'not-a-real-password',
    role:'member',
    active:true
  });
  stakeholder = await store.insert('users',{
    name:'Project Closure Stakeholder',
    email:`project-closure-stakeholder-${suffix}@invalid.test`,
    password:'not-a-real-password',
    role:'member',
    active:true
  });
  manager = await store.insert('users',{
    name:'Project Closure Manager',
    email:`project-closure-manager-${suffix}@invalid.test`,
    password:'not-a-real-password',
    role:'manager',
    active:true
  });
  projectId = `project-closure-${suffix}`;
  await store.insert('projects',{
    _id:projectId,
    name:'Project Closure Test',
    key:`PC${suffix.slice(0,8)}`,
    owner:owner._id,
    members:[owner._id],
    status:'active',
    startDate:'2026-03-01'
  });
  await pool.query(
    'INSERT INTO public.project_stakeholders (project_id,user_id) VALUES ($1,$2)',
    [projectId,stakeholder._id]
  );
  const tasks = [];
  for (const [title,status] of [
    ['Completed closure task','Completed'],
    ['Rejected closure task','Rejected'],
    ['Open closure task','Open']
  ]) {
    tasks.push(await store.insert('tasks',{
      project:projectId,reporter:owner._id,assignee:owner._id,title,status
    }));
  }
  await pool.query(
    `INSERT INTO public.milestones (project_id,name,due_date,owner_user_id,status)
     VALUES ($1,'Finished milestone','2026-03-20',$2,'completed'),
            ($1,'Pending milestone','2026-03-30',$2,'not_started')`,
    [projectId,owner._id]
  );
  return { store,owner,stakeholder,manager,projectId,tasks };
  } catch (error) {
    if (projectId) await pool.query('DELETE FROM public.projects WHERE id=$1',[projectId]);
    for (const user of [owner,stakeholder,manager]) {
      if (user) await pool.query('DELETE FROM public.users WHERE id=$1',[user._id]);
    }
    throw error;
  }
}

async function cleanup(fixture) {
  const { rows:storedFiles } = await pool.query(
    `SELECT storage_key FROM public.attachments WHERE project_id=$1
     UNION ALL
     SELECT storage_key FROM public.project_closure_uploads WHERE project_id=$1`,
    [fixture.projectId]
  );
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query("SET LOCAL app.project_reopen='true'");
    await client.query(
      `UPDATE public.projects SET status='active'
       WHERE id=$1 AND status='closed'`,
      [fixture.projectId]
    );
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
  await pool.query(
    `DELETE FROM public.notifications WHERE resource_snapshot->>'projectId'=$1`,
    [fixture.projectId]
  );
  const { rows:closures } = await pool.query(
    'SELECT id FROM public.project_closures WHERE project_id=$1',
    [fixture.projectId]
  );
  await pool.query(
    `DELETE FROM public.email_outbox
     WHERE idempotency_key=ANY($1::text[])`,
    [closures.map((closure) => `project-closure:${closure.id}:appreciation`)]
  );
  await pool.query('DELETE FROM public.projects WHERE id=$1',[fixture.projectId]);
  const uploadRoot = path.resolve(__dirname,'..','..','uploads','project-closures');
  for (const file of storedFiles) {
    const prefix = '/uploads/project-closures/';
    if (!file.storage_key.startsWith(prefix)) continue;
    const filePath = path.resolve(uploadRoot,file.storage_key.slice(prefix.length));
    if (!filePath.startsWith(`${uploadRoot}${path.sep}`)) continue;
    try {
      await fs.promises.unlink(filePath);
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
  }
  await pool.query('DELETE FROM public.users WHERE id=$1',[fixture.owner._id]);
  await pool.query('DELETE FROM public.users WHERE id=$1',[fixture.stakeholder._id]);
  await pool.query('DELETE FROM public.users WHERE id=$1',[fixture.manager._id]);
}

test('project closure blocks when configured, then closes idempotently and reopens with history', async () => {
  const fixture = await createFixture();
  let server;
  try {
    const app = express();
    app.use(express.json());
    app.use('/api/projects',require('../routes/projects'));
    server = app.listen(0);
    await new Promise((resolve) => server.once('listening',resolve));
    const baseUrl = `http://127.0.0.1:${server.address().port}/api/projects`;
    const stakeholderToken = jwt.sign({ id:fixture.stakeholder._id },process.env.JWT_SECRET);
    const ownerToken = jwt.sign({ id:fixture.owner._id },process.env.JWT_SECRET);
    const managerToken = jwt.sign({ id:fixture.manager._id },process.env.JWT_SECRET);
    const unauthorized = await fetch(`${baseUrl}/${fixture.projectId}/close`,{
      method:'POST',
      headers:{ 'Content-Type':'application/json',Authorization:`Bearer ${stakeholderToken}` },
      body:JSON.stringify({ closingRemarks:'This should not be authorized',links:[],uploadIds:[] })
    });
    assert.equal(unauthorized.status,403);
    const unauthorizedReopen = await fetch(`${baseUrl}/${fixture.projectId}/reopen`,{
      method:'POST',
      headers:{ 'Content-Type':'application/json',Authorization:`Bearer ${stakeholderToken}` },
      body:JSON.stringify({ reopeningRemarks:'This should not be authorized' })
    });
    assert.equal(unauthorizedReopen.status,403);
    const shortRemarks = await fetch(`${baseUrl}/${fixture.projectId}/close`,{
      method:'POST',
      headers:{ 'Content-Type':'application/json',Authorization:`Bearer ${ownerToken}` },
      body:JSON.stringify({ closingRemarks:'Too short',links:[],uploadIds:[] })
    });
    assert.equal(shortRemarks.status,400);
    const unsafeLinks = await fetch(`${baseUrl}/${fixture.projectId}/close`,{
      method:'POST',
      headers:{ 'Content-Type':'application/json',Authorization:`Bearer ${ownerToken}` },
      body:JSON.stringify({ closingRemarks:'Enough characters for validation',links:[{ url:'javascript:alert(1)' }],uploadIds:[] })
    });
    assert.equal(unsafeLinks.status,400);

    await assert.rejects(
      closeProject({
        projectId:fixture.projectId,user:fixture.owner,
        closingRemarksHtml:'<p>Ready to close</p>',closingRemarksText:'Ready to close',
        links:[],uploadIds:[],blockWithOpenTasks:true
      }),
      (error) => error.code === 'OPEN_TASKS_BLOCKED' && error.status === 409
    );
    const unchanged = await pool.query(
      'SELECT status FROM public.projects WHERE id=$1',[fixture.projectId]
    );
    assert.equal(unchanged.rows[0].status,'active');

    const filename = `${crypto.randomUUID()}.pdf`;
    const storageKey = `/uploads/project-closures/${filename}`;
    const filePath = path.join(__dirname,'..','..','uploads','project-closures',filename);
    const fileBytes = Buffer.from('%PDF-1.7 closure attachment');
    await fs.promises.writeFile(filePath,fileBytes,{ flag:'wx' });
    const stagedUpload = await pool.query(
      `INSERT INTO public.project_closure_uploads
       (project_id,uploaded_by_user_id,filename,mime,size_bytes,storage_key)
       VALUES ($1,$2,'closure.pdf','application/pdf',$3,$4)
       RETURNING id`,
      [fixture.projectId,fixture.owner._id,fileBytes.length,storageKey]
    );
    const result = await closeProject({
      projectId:fixture.projectId,user:fixture.owner,
      closingRemarksHtml:'<p>Ready to close</p>',closingRemarksText:'Ready to close',
      links:[{ url:'https://example.com/closure',label:'Closure notes' }],
      uploadIds:[stagedUpload.rows[0].id],blockWithOpenTasks:false
    });
    assert.equal(result.alreadyClosed,false);
    assert.equal(result.openTaskCount,1);
    assert.equal(result.closure.snapshot.totalTasks,3);
    assert.equal(result.closure.snapshot.completedTasks,1);
    assert.equal(result.closure.snapshot.rejectedTasks,1);
    assert.equal(result.closure.snapshot.completionPercent,50);
    assert.deepEqual(result.closure.snapshot.milestones,{ total:2,completed:1 });
    assert.equal(result.closure.attachments.length,1);
    assert.equal((await pool.query('SELECT status FROM public.projects WHERE id=$1',[fixture.projectId])).rows[0].status,'closed');

    const outbox = await pool.query(
      `SELECT id FROM public.email_outbox
       WHERE idempotency_key=$1`,
      [`project-closure:${result.closure.id}:appreciation`]
    );
    assert.equal(outbox.rowCount,1);
    const recipients = await pool.query(
      `SELECT email_snapshot,recipient_type FROM public.email_recipients
       WHERE email_outbox_id=$1 ORDER BY recipient_type,email_snapshot`,
      [outbox.rows[0].id]
    );
    assert.deepEqual(recipients.rows,[
      { email_snapshot:fixture.stakeholder.email,recipient_type:'cc' },
      { email_snapshot:fixture.owner.email,recipient_type:'to' }
    ]);
    assert.equal((await pool.query(
      `SELECT delivery_mode FROM public.email_attachments WHERE email_outbox_id=$1`,
      [outbox.rows[0].id]
    )).rows[0].delivery_mode,'attached');
    const storedAttachment = await pool.query(
      'SELECT storage_key FROM public.attachments WHERE id=$1',
      [result.closure.attachments[0].id]
    );
    assert.equal(storedAttachment.rows[0].storage_key,storageKey);
    assert.equal(fs.existsSync(filePath),true);
    const download = await fetch(
      `${baseUrl}/${fixture.projectId}/closure-attachments/${result.closure.attachments[0].id}/download`,
      { headers:{ Authorization:`Bearer ${ownerToken}` } }
    );
    assert.equal(download.status,200,await download.clone().text());
    assert.match(download.headers.get('content-disposition'),/attachment; filename="closure\.pdf"/);
    assert.deepEqual(Buffer.from(await download.arrayBuffer()),fileBytes);

    await assert.rejects(
      fixture.store.insert('tasks',{
        project:fixture.projectId,reporter:fixture.owner._id,title:'Must not be created'
      }),
      /Closed projects are read-only/
    );
    await assert.rejects(
      pool.query('UPDATE public.projects SET name=$2 WHERE id=$1',[fixture.projectId,'Should stay closed']),
      /Closed projects must be reopened/
    );
    await assert.rejects(
      pool.query(
        `INSERT INTO public.project_members (project_id,user_id,project_role)
         VALUES ($1,$2,'viewer')`,
        [fixture.projectId,fixture.stakeholder._id]
      ),
      /Closed projects are read-only/
    );
    await assert.rejects(
      pool.query("UPDATE public.project_statuses SET active=false WHERE status='closed'"),
      /protected/
    );
    await assert.rejects(
      pool.query("DELETE FROM public.project_statuses WHERE status='closed'"),
      /protected/
    );

    const duplicate = await closeProject({
      projectId:fixture.projectId,user:fixture.owner,
      closingRemarksHtml:'<p>Repeated request</p>',closingRemarksText:'Repeated request',
      links:[],uploadIds:[],blockWithOpenTasks:false
    });
    assert.equal(duplicate.alreadyClosed,true);
    assert.equal((await pool.query(
      'SELECT count(*)::int AS total FROM public.email_outbox WHERE idempotency_key=$1',
      [`project-closure:${result.closure.id}:appreciation`]
    )).rows[0].total,1);

    const shortReopen = await fetch(`${baseUrl}/${fixture.projectId}/reopen`,{
      method:'POST',
      headers:{ 'Content-Type':'application/json',Authorization:`Bearer ${managerToken}` },
      body:JSON.stringify({ reopeningRemarks:'Too short' })
    });
    assert.equal(shortReopen.status,400);
    const reopenResponse = await fetch(`${baseUrl}/${fixture.projectId}/reopen`,{
      method:'POST',
      headers:{ 'Content-Type':'application/json',Authorization:`Bearer ${managerToken}` },
      body:JSON.stringify({ reopeningRemarks:'Work needs another review' })
    });
    assert.equal(reopenResponse.status,200,await reopenResponse.clone().text());
    const reopened = await reopenResponse.json();
    assert.equal(reopened.status,'active');
    const history = await getProjectClosureHistory(fixture.projectId);
    assert.equal(history.length,1);
    assert.equal(history[0].reopeningRemarks,'Work needs another review');
    assert.ok(history[0].reopenedAt);
    const notifications = await pool.query(
      `SELECT DISTINCT type FROM public.notifications n
       JOIN public.notification_resources nr ON nr.notification_id=n.id
       WHERE nr.target_project_id=$1 ORDER BY type`,
      [fixture.projectId]
    );
    assert.deepEqual(notifications.rows.map((row) => row.type),['project_closed','project_reopened']);
    assert.equal((await pool.query(
      `SELECT count(*)::int AS total FROM public.email_outbox
       WHERE idempotency_key LIKE $1`,
      [`project-closure:${result.closure.id}:%`]
    )).rows[0].total,1);
  } finally {
    if (server) {
      await new Promise((resolve,reject) => server.close((error) => error ? reject(error) : resolve()));
    }
    await cleanup(fixture);
  }
});
