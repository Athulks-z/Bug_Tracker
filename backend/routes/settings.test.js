const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const express = require('express');
const jwt = require('jsonwebtoken');
const pool = require('../config/db');
const {
  validateSender,
  validateAnnouncement,
  sanitizeAnnouncementMessage
} = require('./settings');

test('custom sender validation normalizes addresses and enforces the allowed domain list', () => {
  const previous = process.env.ALLOWED_SENDER_DOMAINS;
  process.env.ALLOWED_SENDER_DOMAINS = 'z-crossing.com, example.org';
  try {
    assert.deepEqual(validateSender('  Mailbox@Z-Crossing.com '), {
      valid:true,sender:'mailbox@z-crossing.com'
    });
    assert.equal(validateSender('not-an-email').valid,false);
    assert.equal(validateSender('mailbox@unlisted.com').valid,false);
  } finally {
    if (previous === undefined) delete process.env.ALLOWED_SENDER_DOMAINS;
    else process.env.ALLOWED_SENDER_DOMAINS = previous;
  }
});

test('announcement messages strip unsafe markup and validate audience and size', () => {
  assert.equal(sanitizeAnnouncementMessage('<script>alert(1)</script><b>Hello</b>'), 'Hello');
  assert.deepEqual(validateAnnouncement({
    title:'  Planned maintenance ',
    message:'<img src=x onerror=alert(1)>Maintenance tonight',
    audienceRole:'employee',
    sendEmail:true
  }).value, {
    title:'Planned maintenance',
    message:'Maintenance tonight',
    audienceRole:'employee',
    expiresAt:null,
    sendEmail:true
  });
  assert.match(validateAnnouncement({ title:'x',message:'ok',audienceRole:'root' }).error,/audience/i);
  assert.match(validateAnnouncement({ title:'x',message:'<script></script>' }).error,/Message is required/);
});

test('settings APIs enforce administrator roles and announcements are private, acknowledged once, and sanitized', async (t) => {
  const { rows:users } = await pool.query(
    `SELECT id,email,role_code AS role FROM public.users
     WHERE active AND role_code IN ('super_admin','admin','employee','trainee')
     ORDER BY CASE role_code WHEN 'super_admin' THEN 0 WHEN 'admin' THEN 1 WHEN 'employee' THEN 2 ELSE 3 END`
  );
  const byRole = Object.fromEntries(users.map((user) => [user.role,user]));
  const administrator = byRole.super_admin || byRole.admin;
  const employee = byRole.employee;
  if (!administrator || !employee) {
    t.skip('Requires active administrator and employee database fixtures');
    return;
  }
  const tokenFor = (user) => jwt.sign({ id:user.id },process.env.JWT_SECRET,{ expiresIn:'10m' });
  const app = express();
  app.use(express.json());
  const { router,userAnnouncementsRouter } = require('./settings');
  const mailer = require('../services/mailer');
  const { invalidateSettingsCache } = require('../services/settingsService');
  app.use('/api/settings/announcements',userAnnouncementsRouter);
  app.use('/api/settings',router);
  const server = await new Promise((resolve) => {
    const listeningServer = app.listen(0,'127.0.0.1',() => resolve(listeningServer));
  });
  const baseUrl = `http://127.0.0.1:${server.address().port}/api/settings`;
  const authHeaders = (user) => ({ Authorization:`Bearer ${tokenFor(user)}` });
  const announcementIds = [];
  let senderSettingsBackup;
  let testedSenderAddress = '';
  let senderTestLock;
  let allowedSenderDomains = process.env.ALLOWED_SENDER_DOMAINS;
  const originalSendMail = mailer.sendMail;
  const sentTestMails = [];
  try {
    const unauthenticated = await fetch(`${baseUrl}`,{ method:'GET' });
    assert.equal(unauthenticated.status,401);
    const forbidden = await fetch(baseUrl,{ headers:authHeaders(employee) });
    assert.equal(forbidden.status,403);
    const pendingForEmployee = await fetch(`${baseUrl}/announcements/pending`,{ headers:authHeaders(employee) });
    assert.equal(pendingForEmployee.status,200);
    const adminSettings = await fetch(baseUrl,{ headers:authHeaders(administrator) });
    assert.equal(adminSettings.status,200);
    assert.equal((await adminSettings.clone().json()).canChangeSender,Boolean(byRole.super_admin));
    if (byRole.admin) {
      const senderChange = await fetch(baseUrl,{
        method:'PUT',
        headers:{ ...authHeaders(byRole.admin),'Content-Type':'application/json' },
        body:JSON.stringify({ senderEmail:'sender@example.org' })
      });
      assert.equal(senderChange.status,403);
      const senderReset = await fetch(`${baseUrl}/reset-sender`,{
        method:'POST',headers:authHeaders(byRole.admin)
      });
      assert.equal(senderReset.status,403);
    }

    const storageResponse = await fetch(`${baseUrl}/storage-stats`,{ headers:authHeaders(administrator) });
    assert.equal(storageResponse.status,200);
    const storage = await storageResponse.json();
    assert.equal(typeof storage.databaseBytes,'number');
    assert.equal(typeof storage.uploadsBytes,'number');
    assert.ok(Array.isArray(storage.tables));

    if (byRole.super_admin) {
      senderTestLock = await pool.connect();
      await senderTestLock.query('SELECT pg_advisory_lock($1)', [671230980]);
      const { rows } = await pool.query(
        'SELECT value,updated_by_user_id,updated_at FROM public.app_settings WHERE key=$1',
        ['sender_email']
      );
      senderSettingsBackup = rows[0] || null;
      const currentSettings = await require('../services/settingsService').getSettings({ forceRefresh:true });
      if (currentSettings.emailEnabled) {
        process.env.ALLOWED_SENDER_DOMAINS = 'z-crossing.com';
        const senderAddress = `settings-test-${crypto.randomUUID()}@z-crossing.com`;
        testedSenderAddress = senderAddress;
        mailer.sendMail = async (mail) => {
          sentTestMails.push(mail);
          return { skipped:false };
        };
        const testEmailResponse = await fetch(`${baseUrl}/test-email`,{
          method:'POST',
          headers:{ ...authHeaders(byRole.super_admin),'Content-Type':'application/json' },
          body:JSON.stringify({ senderEmail:senderAddress })
        });
        assert.equal(testEmailResponse.status,200);
        assert.deepEqual(sentTestMails[0].to,[byRole.super_admin.email].filter(Boolean));
        assert.equal(sentTestMails[0].sender,senderAddress);
        const saveSenderResponse = await fetch(baseUrl,{
          method:'PUT',
          headers:{ ...authHeaders(byRole.super_admin),'Content-Type':'application/json' },
          body:JSON.stringify({ senderEmail:senderAddress })
        });
        assert.equal(saveSenderResponse.status,200);
        assert.equal((await saveSenderResponse.json()).senderSource,'Custom');
        const resetSenderResponse = await fetch(`${baseUrl}/reset-sender`,{
          method:'POST',headers:authHeaders(byRole.super_admin)
        });
        assert.equal(resetSenderResponse.status,200);
      }
    }

    const publish = async (payload) => {
      const response = await fetch(`${baseUrl}/announcements`,{
        method:'POST',
        headers:{ ...authHeaders(administrator),'Content-Type':'application/json' },
        body:JSON.stringify(payload)
      });
      assert.equal(response.status,201);
      const item = await response.json();
      announcementIds.push(item.id);
      return item;
    };
    const active = await publish({
      title:`Settings test ${crypto.randomUUID()}`,
      message:'<img src=x onerror=alert(1)>Maintenance notice',
      audienceRole:'employee',
      sendEmail:false
    });
    assert.equal(active.message,'Maintenance notice');
    const employeePendingResponse = await fetch(`${baseUrl}/announcements/pending`,{ headers:authHeaders(employee) });
    const employeePending = await employeePendingResponse.json();
    assert.ok(employeePending.some((item) => item.id === active.id));
    await pool.query(
      'DELETE FROM public.notifications WHERE recipient_user_id=$1 AND announcement_id=$2',
      [employee.id,active.id]
    );
    const lateUserPendingResponse = await fetch(`${baseUrl}/announcements/pending`,{ headers:authHeaders(employee) });
    assert.ok((await lateUserPendingResponse.json()).some((item) => item.id === active.id));
    const replenishedNotification = await pool.query(
      `SELECT 1 FROM public.notifications WHERE recipient_user_id=$1 AND announcement_id=$2`,
      [employee.id,active.id]
    );
    assert.equal(replenishedNotification.rowCount,1);

    const ackResponse = await fetch(`${baseUrl}/announcements/${active.id}/acknowledge`,{
      method:'POST',headers:authHeaders(employee)
    });
    assert.equal(ackResponse.status,200);
    const afterAck = await fetch(`${baseUrl}/announcements/pending`,{ headers:authHeaders(employee) });
    assert.equal((await afterAck.json()).some((item) => item.id === active.id),false);
    const notification = await pool.query(
      `SELECT read_at FROM public.notifications
       WHERE recipient_user_id=$1 AND announcement_id=$2`,
      [employee.id,active.id]
    );
    assert.ok(notification.rows[0]?.read_at);

    const unseen = await publish({
      title:`Unseen settings test ${crypto.randomUUID()}`,
      message:'This should disappear when deleted',
      audienceRole:'employee'
    });
    const deleteResponse = await fetch(`${baseUrl}/announcements/${unseen.id}`,{
      method:'DELETE',headers:authHeaders(administrator)
    });
    assert.equal(deleteResponse.status,200);
    const pendingAfterDelete = await fetch(`${baseUrl}/announcements/pending`,{ headers:authHeaders(employee) });
    assert.equal((await pendingAfterDelete.json()).some((item) => item.id === unseen.id),false);
    const deletedNotification = await pool.query(
      'SELECT 1 FROM public.notifications WHERE recipient_user_id=$1 AND announcement_id=$2',
      [employee.id,unseen.id]
    );
    assert.equal(deletedNotification.rowCount,0);

    const expired = await publish({
      title:`Expired settings test ${crypto.randomUUID()}`,
      message:'Expired notice',
      audienceRole:'employee',
      expiresAt:new Date(Date.now() - 60000).toISOString()
    });
    const employeePendingAfterExpired = await fetch(`${baseUrl}/announcements/pending`,{ headers:authHeaders(employee) });
    assert.equal((await employeePendingAfterExpired.json()).some((item) => item.id === expired.id),false);
  } finally {
    mailer.sendMail = originalSendMail;
    if (allowedSenderDomains === undefined) delete process.env.ALLOWED_SENDER_DOMAINS;
    else process.env.ALLOWED_SENDER_DOMAINS = allowedSenderDomains;
    try {
      if (senderSettingsBackup !== undefined) {
        if (senderSettingsBackup) {
          await pool.query(
            `UPDATE public.app_settings SET value=$1::jsonb,updated_by_user_id=$2,updated_at=$3 WHERE key='sender_email'`,
            [
              JSON.stringify(senderSettingsBackup.value),senderSettingsBackup.updated_by_user_id,
              senderSettingsBackup.updated_at
            ]
          );
        } else {
          await pool.query("DELETE FROM public.app_settings WHERE key='sender_email'");
        }
        await pool.query(
          `DELETE FROM public.settings_audit_log
           WHERE setting_key='sender_email' AND (
            old_value=to_jsonb($1::text) OR new_value=to_jsonb($1::text)
          )`,
          [testedSenderAddress]
        );
        invalidateSettingsCache();
      }
    } finally {
      if (senderTestLock) {
        try {
          await senderTestLock.query('SELECT pg_advisory_unlock($1)', [671230980]);
        } finally {
          senderTestLock.release();
        }
      }
    }
    if (announcementIds.length) {
      await pool.query('DELETE FROM public.notifications WHERE announcement_id=ANY($1::text[])',[announcementIds]);
      await pool.query(
        `DELETE FROM public.settings_audit_log
         WHERE old_value->>'id'=ANY($1::text[]) OR new_value->>'id'=ANY($1::text[])`,
        [announcementIds]
      );
      await pool.query('DELETE FROM public.announcements WHERE id=ANY($1::text[])',[announcementIds]);
    }
    await new Promise((resolve,reject) => server.close((error) => error ? reject(error) : resolve()));
  }
});
