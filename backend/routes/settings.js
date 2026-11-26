const router = require('express').Router();
const crypto = require('crypto');
const fs = require('fs/promises');
const path = require('path');
const { isDeepStrictEqual } = require('util');
const rateLimit = require('express-rate-limit');
const sanitizeHtml = require('sanitize-html');
const { auth } = require('../middleware/auth');
const { requireRoles } = require('../middleware/roles');
const pool = require('../config/db');
const mailer = require('../services/mailer');
const {
  DEFAULT_EMAIL_EVENTS, getSettings, getSenderEmail, isEmailEnabled,
  invalidateSettingsCache
} = require('../services/settingsService');

const SETTINGS_ROLES = Object.freeze(['super_admin', 'admin']);
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MAX_ANNOUNCEMENT_TITLE = 150;
const MAX_ANNOUNCEMENT_MESSAGE = 10000;
const testEmailApprovals = new Map();
let storageCache;
let storageCacheAt = 0;
const userAnnouncementsRouter = require('express').Router();

router.use(auth, requireRoles(...SETTINGS_ROLES));

function isSuperAdmin(user) {
  return user?.role === 'super_admin';
}

function normalizeSender(value) {
  return typeof value === 'string' ? value.trim().toLowerCase() : '';
}

function validateSender(value) {
  const sender = normalizeSender(value);
  if (!EMAIL_PATTERN.test(sender)) return { valid:false, message:'Enter a valid sender email address' };
  const allowedDomains = String(process.env.ALLOWED_SENDER_DOMAINS || '')
    .split(',')
    .map((domain) => domain.trim().toLowerCase())
    .filter(Boolean);
  if (!allowedDomains.length) {
    return { valid:false, message:'Configure ALLOWED_SENDER_DOMAINS before setting a custom sender' };
  }
  const domain = sender.split('@')[1];
  if (!allowedDomains.includes(domain)) {
    return { valid:false, message:`Sender domain must be one of: ${allowedDomains.join(', ')}` };
  }
  return { valid:true, sender };
}

function sanitizeAnnouncementMessage(value) {
  if (typeof value !== 'string') return '';
  return sanitizeHtml(value, { allowedTags:[], allowedAttributes:{} }).trim();
}

function validateAnnouncement(body = {}) {
  const title = typeof body.title === 'string' ? body.title.trim() : '';
  const message = sanitizeAnnouncementMessage(body.message);
  const audienceRole = body.audienceRole === '' || body.audienceRole === 'all'
    ? null
    : body.audienceRole;
  const allowedRoles = ['super_admin','admin','manager','employee','trainee'];
  if (!title || title.length > MAX_ANNOUNCEMENT_TITLE) {
    return { error:`Title is required and must be at most ${MAX_ANNOUNCEMENT_TITLE} characters` };
  }
  if (!message || message.length > MAX_ANNOUNCEMENT_MESSAGE) {
    return { error:`Message is required and must be at most ${MAX_ANNOUNCEMENT_MESSAGE} characters` };
  }
  if (audienceRole && !allowedRoles.includes(audienceRole)) return { error:'Invalid announcement audience' };
  let expiresAt = null;
  if (body.expiresAt) {
    const date = new Date(body.expiresAt);
    if (Number.isNaN(date.getTime())) return { error:'Expiry date is invalid' };
    expiresAt = date.toISOString();
  }
  if (body.sendEmail !== undefined && typeof body.sendEmail !== 'boolean') {
    return { error:'Send email must be true or false' };
  }
  return {
    value: { title, message, audienceRole, expiresAt, sendEmail:body.sendEmail === true }
  };
}

async function writeAudit(client, actorId, key, oldValue, newValue) {
  await client.query(
    `INSERT INTO public.settings_audit_log (id,actor_user_id,setting_key,old_value,new_value)
     VALUES ($1,$2,$3,$4::jsonb,$5::jsonb)`,
    [
      crypto.randomUUID().replace(/-/g, ''), actorId, key,
      JSON.stringify(oldValue === undefined ? null : oldValue),
      JSON.stringify(newValue === undefined ? null : newValue)
    ]
  );
}

async function rollbackSettingsTransaction(client) {
  if (!client) return;
  try {
    await client.query('ROLLBACK');
  } catch (error) {
    console.error('Unable to roll back settings transaction:', error.name);
  }
}

function publicSettings(settings, sender) {
  return {
    ...settings,
    senderEmail:sender.custom ? sender.custom : sender.default,
    senderSource:sender.custom ? 'Custom' : 'Default from environment',
    defaultSender:sender.default,
    canChangeSender:true
  };
}

router.get('/', async (req, res) => {
  try {
    const settings = await getSettings();
    const sender = {
      custom:settings.senderEmail,
      default:process.env.MS_SENDER || ''
    };
    res.json({
      ...publicSettings(settings, sender),
      canChangeSender:isSuperAdmin(req.user)
    });
  } catch (error) {
    console.error('Unable to load application settings:', error.name);
    res.status(500).json({ message:'Unable to load settings' });
  }
});

router.put('/', async (req, res) => {
  if (!req.body || typeof req.body !== 'object' || Array.isArray(req.body)) {
    return res.status(400).json({ message:'Settings payload must be an object' });
  }
  if (Object.prototype.hasOwnProperty.call(req.body, 'senderEmail')) {
    if (!isSuperAdmin(req.user)) return res.status(403).json({ message:'Only a Super Admin can change the sender address' });
  }
  const allowed = new Set(['emailEnabled','emailEvents','inAppNotificationsEnabled','senderEmail']);
  if (Object.keys(req.body).some((key) => !allowed.has(key))) {
    return res.status(400).json({ message:'Unsupported setting' });
  }
  const { emailEnabled, emailEvents, inAppNotificationsEnabled } = req.body;
  if (emailEnabled !== undefined && typeof emailEnabled !== 'boolean') {
    return res.status(400).json({ message:'Email notifications must be true or false' });
  }
  if (inAppNotificationsEnabled !== undefined && typeof inAppNotificationsEnabled !== 'boolean') {
    return res.status(400).json({ message:'In-app notifications must be true or false' });
  }
  if (emailEvents !== undefined) {
    if (!emailEvents || typeof emailEvents !== 'object' || Array.isArray(emailEvents)
      || Object.keys(emailEvents).some((key) => !Object.prototype.hasOwnProperty.call(DEFAULT_EMAIL_EVENTS, key))
      || Object.values(emailEvents).some((value) => typeof value !== 'boolean')) {
      return res.status(400).json({ message:'Email event settings are invalid' });
    }
  }
  let customSender;
  if (Object.prototype.hasOwnProperty.call(req.body, 'senderEmail')) {
    if (req.body.senderEmail === null || req.body.senderEmail === '') {
      return res.status(400).json({ message:'Use the reset-sender endpoint to restore the environment sender' });
    }
    const result = validateSender(req.body.senderEmail);
    if (!result.valid) return res.status(400).json({ message:result.message });
    customSender = result.sender;
    const approval = testEmailApprovals.get(String(req.user._id));
    if (!approval || approval.sender !== customSender || approval.expiresAt < Date.now()) {
      return res.status(409).json({ message:'Send and confirm a successful test email from this sender before saving it' });
    }
  }

  const changes = [];
  if (emailEnabled !== undefined) changes.push(['email_enabled',emailEnabled]);
  if (emailEvents !== undefined) changes.push(['email_events',emailEvents]);
  if (inAppNotificationsEnabled !== undefined) changes.push(['in_app_notifications_enabled',inAppNotificationsEnabled]);
  if (customSender !== undefined) changes.push(['sender_email',customSender]);

  let client;
  try {
    client = await pool.connect();
    await client.query('BEGIN');
    for (const [key, value] of changes) {
      const { rows } = await client.query('SELECT value FROM public.app_settings WHERE key=$1 FOR UPDATE', [key]);
      const oldValue = rows[0]?.value ?? null;
      if (isDeepStrictEqual(oldValue, value)) continue;
      await client.query(
        `INSERT INTO public.app_settings (key,value,updated_by_user_id,updated_at)
         VALUES ($1,$2::jsonb,$3,now())
         ON CONFLICT (key) DO UPDATE
         SET value=EXCLUDED.value,updated_by_user_id=EXCLUDED.updated_by_user_id,updated_at=now()`,
        [key,JSON.stringify(value),String(req.user._id)]
      );
      await writeAudit(client, String(req.user._id), key, oldValue, value);
    }
    await client.query('COMMIT');
    invalidateSettingsCache();
    if (customSender) testEmailApprovals.delete(String(req.user._id));
    const settings = await getSettings({ forceRefresh:true });
    res.json({
      ...publicSettings(settings, {
      custom:settings.senderEmail,
      default:process.env.MS_SENDER || ''
      }),
      canChangeSender:isSuperAdmin(req.user)
    });
  } catch (error) {
    await rollbackSettingsTransaction(client);
    console.error('Unable to save application settings:', error.name);
    res.status(500).json({ message:'Unable to save settings' });
  } finally {
    if (client) client.release();
  }
});

router.post('/reset-sender', async (req, res) => {
  if (!isSuperAdmin(req.user)) return res.status(403).json({ message:'Only a Super Admin can reset the sender address' });
  let client;
  try {
    client = await pool.connect();
    await client.query('BEGIN');
    const { rows } = await client.query('SELECT value FROM public.app_settings WHERE key=$1 FOR UPDATE', ['sender_email']);
    const oldValue = rows[0]?.value ?? null;
    await client.query(
      `INSERT INTO public.app_settings (key,value,updated_by_user_id,updated_at)
       VALUES ('sender_email','null'::jsonb,$1,now())
       ON CONFLICT (key) DO UPDATE SET value='null'::jsonb,updated_by_user_id=$1,updated_at=now()`,
      [String(req.user._id)]
    );
    if (oldValue !== null) await writeAudit(client, String(req.user._id), 'sender_email', oldValue, null);
    await client.query('COMMIT');
    invalidateSettingsCache();
    testEmailApprovals.delete(String(req.user._id));
    res.json({ senderEmail:process.env.MS_SENDER || '', senderSource:'Default from environment' });
  } catch (error) {
    await rollbackSettingsTransaction(client);
    console.error('Unable to reset sender address:', error.name);
    res.status(500).json({ message:'Unable to reset sender address' });
  } finally {
    if (client) client.release();
  }
});

const testEmailLimiter = rateLimit({
  windowMs:60 * 60 * 1000,
  limit:3,
  standardHeaders:'draft-7',
  legacyHeaders:false,
  keyGenerator:(req) => String(req.user._id),
  message:{ message:'Test email limit reached. Try again later.' }
});

router.post('/test-email', testEmailLimiter, async (req, res) => {
  const userEmail = String(req.user.email || '').trim().toLowerCase();
  if (!EMAIL_PATTERN.test(userEmail)) return res.status(400).json({ message:'Your account does not have a valid email address' });
  try {
    let sender;
    if (isSuperAdmin(req.user)) {
      const senderValidation = validateSender(req.body?.senderEmail);
      if (!senderValidation.valid) return res.status(400).json({ message:senderValidation.message });
      sender = senderValidation.sender;
    } else {
      if (req.body?.senderEmail) return res.status(403).json({ message:'Only a Super Admin can choose a test sender' });
      sender = await getSenderEmail();
    }
    if (!await isEmailEnabled('settings_test')) {
      return res.status(409).json({ message:'Email notifications are turned off. Enable them before testing email.' });
    }
    testEmailApprovals.delete(String(req.user._id));
    await mailer.sendMail({
      sender,
      to:[userEmail],
      subject:'TaskTracker sender test',
      text:'This is a test email for your TaskTracker sender configuration.'
    });
    testEmailApprovals.set(String(req.user._id), {
      sender,
      expiresAt:Date.now() + 15 * 60 * 1000
    });
    res.json({ sent:true, recipient:userEmail, message:`Test email sent to ${userEmail}` });
  } catch (error) {
    console.error('Settings test email failed:', error.name, error.statusCode || '');
    res.status(502).json({ message:error.message || 'Test email failed' });
  }
});

async function directorySize(directory) {
  let total = 0;
  let entries;
  try {
    entries = await fs.readdir(directory, { withFileTypes:true });
  } catch (error) {
    if (error.code === 'ENOENT') return 0;
    throw error;
  }
  for (const entry of entries) {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) total += await directorySize(fullPath);
    else if (entry.isFile()) total += (await fs.stat(fullPath)).size;
  }
  return total;
}

async function readStorageStats() {
  const [databaseResult, tableResult, uploadsBytes] = await Promise.all([
    pool.query('SELECT pg_database_size(current_database())::bigint AS bytes'),
    pool.query(
      `SELECT schemaname,relname AS table_name,
              pg_total_relation_size(format('%I.%I',schemaname,relname))::bigint AS bytes,
              GREATEST(n_live_tup,0)::bigint AS row_count
       FROM pg_stat_user_tables
       ORDER BY pg_total_relation_size(format('%I.%I',schemaname,relname)) DESC
       LIMIT 10`
    ),
    directorySize(path.resolve(__dirname,'..','..','uploads'))
  ]);
  const databaseBytes = Number(databaseResult.rows[0].bytes);
  const storageLimitMb = Number(process.env.STORAGE_LIMIT_MB || 0);
  const limitBytes = Number.isFinite(storageLimitMb) && storageLimitMb > 0
    ? storageLimitMb * 1024 * 1024
    : null;
  return {
    databaseBytes,
    uploadsBytes,
    totalUsedBytes:databaseBytes + uploadsBytes,
    limitBytes,
    tables:tableResult.rows.map((row) => ({
      name:`${row.schemaname}.${row.table_name}`,
      bytes:Number(row.bytes),
      rowCount:Number(row.row_count)
    })),
    refreshedAt:new Date().toISOString()
  };
}

router.get('/storage-stats', async (req, res) => {
  try {
    const forceRefresh = req.query.refresh === 'true';
    if (forceRefresh || !storageCache || Date.now() - storageCacheAt >= 60000) {
      storageCache = await readStorageStats();
      storageCacheAt = Date.now();
    }
    res.json(storageCache);
  } catch (error) {
    console.error('Unable to read storage statistics:', error.name);
    res.status(500).json({ message:'Unable to load storage statistics' });
  }
});

async function activeAudienceUsers(client, audienceRole) {
  const result = await client.query(
    `SELECT id,name,email,role_code AS role FROM public.users
     WHERE active AND ($1::text IS NULL OR role_code=$1)
     ORDER BY id`,
    [audienceRole || null]
  );
  return result.rows;
}

async function notifyAnnouncementUsers(client, announcement, users, actorId, { sendEmail = false } = {}) {
  const settings = await getSettings();
  for (const user of users) {
    const idempotencyKey = `announcement:${announcement.id}:${user.id}`;
    if (settings.inAppNotificationsEnabled) {
      await client.query(
        `INSERT INTO public.notifications
         (id,recipient_user_id,actor_user_id,type,details,title,message,link,entity_type,entity_id,announcement_id,idempotency_key)
         VALUES ($1,$2,$3,'announcement',$4,$5,$4,NULL,'announcement',$6,$6,$7)
         ON CONFLICT (idempotency_key) DO NOTHING`,
        [
          crypto.randomUUID().replace(/-/g, ''),user.id,String(actorId || ''),announcement.message,
          announcement.title,announcement.id,idempotencyKey
        ]
      );
    }
    if (sendEmail && user.email && await isEmailEnabled('announcement')) {
      const { rows } = await client.query(
        `INSERT INTO public.email_outbox (event_type,subject,payload,status,idempotency_key)
         VALUES ('announcement',$1,$2::jsonb,'pending',$3)
         ON CONFLICT (idempotency_key) DO NOTHING RETURNING id`,
        [
          `TaskTracker announcement: ${announcement.title}`,
          JSON.stringify({ text:announcement.message,html:`<p>${announcement.message.replace(/\n/g,'<br>')}</p>` }),
          `announcement-email:${announcement.id}:${user.id}`
        ]
      );
      if (rows.length) {
        await client.query(
          `INSERT INTO public.email_recipients
           (email_outbox_id,user_id,email_snapshot,name_snapshot,recipient_type,delivery_status)
           VALUES ($1,$2,$3,$4,'to','pending')`,
          [rows[0].id,user.id,user.email,user.name || '']
        );
      }
    }
  }
}

function announcementShape(row) {
  return {
    id:row.id,
    title:row.title,
    message:row.message,
    audienceRole:row.audience_role,
    audience:row.audience_role || 'all',
    expiresAt:row.expires_at,
    sendEmail:Boolean(row.send_email),
    createdAt:row.created_at,
    updatedAt:row.updated_at,
    createdBy:row.created_by_name || '',
    acknowledgedCount:Number(row.acknowledged_count || 0),
    audienceCount:Number(row.audience_count || 0),
    deletedAt:row.deleted_at
  };
}

router.get('/announcements', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT a.*,u.name AS created_by_name,
              count(DISTINCT ack.user_id)::int AS acknowledged_count,
              count(DISTINCT target.id)::int AS audience_count
       FROM public.announcements a
       LEFT JOIN public.users u ON u.id=a.created_by_user_id
       LEFT JOIN public.announcement_acknowledgements ack ON ack.announcement_id=a.id
       LEFT JOIN public.users target ON target.active AND (a.audience_role IS NULL OR target.role_code=a.audience_role)
       WHERE a.deleted_at IS NULL
       GROUP BY a.id,u.name
       ORDER BY a.created_at DESC,a.id DESC`
    );
    res.json(rows.map(announcementShape));
  } catch (error) {
    console.error('Unable to list announcements:', error.name);
    res.status(500).json({ message:'Unable to load announcements' });
  }
});

async function saveAnnouncement(req, res, existingId = null) {
  const validation = validateAnnouncement(req.body);
  if (validation.error) return res.status(400).json({ message:validation.error });
  const value = validation.value;
  let client;
  try {
    client = await pool.connect();
    await client.query('BEGIN');
    let announcement;
    let before = null;
    if (existingId) {
      const existing = await client.query(
        'SELECT * FROM public.announcements WHERE id=$1 AND deleted_at IS NULL FOR UPDATE',
        [existingId]
      );
      if (!existing.rows.length) {
        await client.query('ROLLBACK');
        return res.status(404).json({ message:'Announcement not found' });
      }
      before = existing.rows[0];
      const updated = await client.query(
        `UPDATE public.announcements SET title=$2,message=$3,audience_role=$4,expires_at=$5,
         send_email=$6,updated_at=now() WHERE id=$1 RETURNING *`,
        [existingId,value.title,value.message,value.audienceRole,value.expiresAt,value.sendEmail]
      );
      announcement = updated.rows[0];
      await client.query(
        `UPDATE public.notifications n SET title=$2,message=$3,details=$3
         WHERE n.announcement_id=$1`,
        [existingId,value.title,value.message]
      );
      await client.query(
        `DELETE FROM public.notifications n
         WHERE n.announcement_id=$1
           AND NOT EXISTS (SELECT 1 FROM public.announcement_acknowledgements ack
                           WHERE ack.announcement_id=$1 AND ack.user_id=n.recipient_user_id)
           AND NOT EXISTS (SELECT 1 FROM public.users u
                           WHERE u.id=n.recipient_user_id AND u.active
                             AND ($2::text IS NULL OR u.role_code=$2))`,
        [existingId,value.audienceRole]
      );
    } else {
      const inserted = await client.query(
        `INSERT INTO public.announcements
         (id,title,message,audience_role,expires_at,created_by_user_id,send_email)
         VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
        [
          crypto.randomUUID().replace(/-/g, ''),value.title,value.message,value.audienceRole,
          value.expiresAt,String(req.user._id),value.sendEmail
        ]
      );
      announcement = inserted.rows[0];
    }
    const users = await activeAudienceUsers(client, value.audienceRole);
    await notifyAnnouncementUsers(client, announcement, users, String(req.user._id), { sendEmail:value.sendEmail });
    await writeAudit(client, String(req.user._id), `announcement.${existingId ? 'updated' : 'created'}`,
      before, announcement);
    await client.query('COMMIT');
    const result = await pool.query(
      `SELECT a.*,u.name AS created_by_name,
              (SELECT count(*)::int FROM public.announcement_acknowledgements ack WHERE ack.announcement_id=a.id) AS acknowledged_count,
              (SELECT count(*)::int FROM public.users target WHERE target.active AND (a.audience_role IS NULL OR target.role_code=a.audience_role)) AS audience_count
       FROM public.announcements a LEFT JOIN public.users u ON u.id=a.created_by_user_id WHERE a.id=$1`,
      [announcement.id]
    );
    return res.status(existingId ? 200 : 201).json(announcementShape(result.rows[0]));
  } catch (error) {
    await rollbackSettingsTransaction(client);
    console.error('Unable to save announcement:', error.name);
    return res.status(500).json({ message:'Unable to save announcement' });
  } finally {
    if (client) client.release();
  }
}

router.post('/announcements', (req, res) => saveAnnouncement(req, res));
router.put('/announcements/:id', (req, res) => saveAnnouncement(req, res, req.params.id));

router.delete('/announcements/:id', async (req, res) => {
  let client;
  try {
    client = await pool.connect();
    await client.query('BEGIN');
    const { rows } = await client.query(
      'UPDATE public.announcements SET deleted_at=now(),updated_at=now() WHERE id=$1 AND deleted_at IS NULL RETURNING *',
      [req.params.id]
    );
    if (!rows.length) {
      await client.query('ROLLBACK');
      return res.status(404).json({ message:'Announcement not found' });
    }
    const announcement = rows[0];
    await client.query(
      `DELETE FROM public.notifications n WHERE n.announcement_id=$1
       AND NOT EXISTS (SELECT 1 FROM public.announcement_acknowledgements ack
                       WHERE ack.announcement_id=$1 AND ack.user_id=n.recipient_user_id)`,
      [req.params.id]
    );
    await writeAudit(client,String(req.user._id),'announcement.deleted',announcement,{ ...announcement,deleted_at:new Date().toISOString() });
    await client.query('COMMIT');
    res.json({ deleted:true });
  } catch (error) {
    await rollbackSettingsTransaction(client);
    console.error('Unable to delete announcement:', error.name);
    res.status(500).json({ message:'Unable to delete announcement' });
  } finally {
    if (client) client.release();
  }
});

userAnnouncementsRouter.get('/pending', auth, async (req, res) => {
  try {
    const settings = await getSettings();
    const { rows } = await pool.query(
      `SELECT a.id,a.title,a.message,a.created_at,a.expires_at
       FROM public.announcements a
       WHERE a.deleted_at IS NULL AND (a.expires_at IS NULL OR a.expires_at>now())
         AND (a.audience_role IS NULL OR a.audience_role=$2)
         AND NOT EXISTS (
           SELECT 1 FROM public.announcement_acknowledgements ack
           WHERE ack.announcement_id=a.id AND ack.user_id=$1
         )
       ORDER BY a.created_at DESC,a.id DESC`,
      [String(req.user._id),req.user.role]
    );
    if (settings.inAppNotificationsEnabled && rows.length) {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        for (const announcement of rows) {
          await client.query(
            `INSERT INTO public.notifications
             (id,recipient_user_id,type,details,title,message,entity_type,entity_id,announcement_id,idempotency_key)
             VALUES ($1,$2,'announcement',$3,$4,$3,'announcement',$5,$5,$6)
             ON CONFLICT (idempotency_key) DO NOTHING`,
            [
              crypto.randomUUID().replace(/-/g, ''),String(req.user._id),
              announcement.message,announcement.title,announcement.id,
              `announcement:${announcement.id}:${req.user._id}`
            ]
          );
        }
        await client.query('COMMIT');
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      } finally {
        client.release();
      }
    }
    res.json(rows);
  } catch (error) {
    console.error('Unable to load pending announcements:', error.name);
    res.status(500).json({ message:'Unable to load announcements' });
  }
});

userAnnouncementsRouter.post('/:id/acknowledge', auth, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `INSERT INTO public.announcement_acknowledgements (announcement_id,user_id)
       SELECT id,$2 FROM public.announcements
       WHERE id=$1 AND deleted_at IS NULL AND (expires_at IS NULL OR expires_at>now())
         AND (audience_role IS NULL OR audience_role=$3)
       ON CONFLICT (announcement_id,user_id) DO NOTHING
       RETURNING announcement_id`,
      [req.params.id,String(req.user._id),req.user.role]
    );
    const exists = rows.length || (await pool.query(
      `SELECT 1 FROM public.announcement_acknowledgements WHERE announcement_id=$1 AND user_id=$2`,
      [req.params.id,String(req.user._id)]
    )).rowCount;
    if (!exists) return res.status(404).json({ message:'Announcement not found' });
    await pool.query(
      `UPDATE public.notifications SET read_at=COALESCE(read_at,now())
       WHERE announcement_id=$1 AND recipient_user_id=$2`,
      [req.params.id,String(req.user._id)]
    );
    res.json({ acknowledged:true });
  } catch (error) {
    console.error('Unable to acknowledge announcement:', error.name);
    res.status(500).json({ message:'Unable to acknowledge announcement' });
  }
});

module.exports = {
  router,
  userAnnouncementsRouter,
  validateSender,
  validateAnnouncement,
  sanitizeAnnouncementMessage,
  readStorageStats
};
