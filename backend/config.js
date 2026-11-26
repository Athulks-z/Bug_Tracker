const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '.env') });

const DEFAULT_JWT_EXPIRES_IN = '12h';

function parseClientOrigins(value, nodeEnv) {
  if (!value) {
    if (nodeEnv === 'production') {
      throw new Error('CLIENT_URL is required in production');
    }
    return ['http://localhost:3000'];
  }

  return value.split(',').map((entry) => {
    const configuredUrl = entry.trim();
    let url;
    try {
      url = new URL(configuredUrl);
    } catch {
      throw new Error(`Invalid CLIENT_URL origin: ${configuredUrl}`);
    }
    if (!['http:', 'https:'].includes(url.protocol)) {
      throw new Error(`CLIENT_URL must use HTTP or HTTPS: ${configuredUrl}`);
    }
    return url.origin;
  });
}

function loadConfig(env = process.env) {
  const nodeEnv = env.NODE_ENV || 'development';
  if (!env.DATABASE_URL && !(env.DB_HOST && env.DB_NAME && env.DB_USER && env.DB_PASSWORD)) {
    throw new Error('DATABASE_URL or DB_HOST, DB_NAME, DB_USER, and DB_PASSWORD are required');
  }
  if (!env.JWT_SECRET || env.JWT_SECRET.length < 32) {
    throw new Error('JWT_SECRET must be set to at least 32 characters');
  }

  const port = Number(env.PORT || 5000);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('PORT must be an integer between 1 and 65535');
  }

  const maxUploadMb = Number(env.MAX_UPLOAD_MB || 5);
  if (!Number.isInteger(maxUploadMb) || maxUploadMb < 1 || maxUploadMb > 50) {
    throw new Error('MAX_UPLOAD_MB must be an integer between 1 and 50');
  }

  const jwtExpiresIn = env.JWT_EXPIRES_IN || DEFAULT_JWT_EXPIRES_IN;
  if (!/^\d+(s|m|h|d)$/i.test(jwtExpiresIn)) {
    throw new Error('JWT_EXPIRES_IN must be a duration such as 12h');
  }

  const databasePoolMax = Number(env.DATABASE_POOL_MAX || 10);
  if (!Number.isInteger(databasePoolMax) || databasePoolMax < 1 || databasePoolMax > 100) {
    throw new Error('DATABASE_POOL_MAX must be an integer between 1 and 100');
  }

  const maxAttachmentMb = Number(env.MAX_ATTACHMENT_MB || 10);
  if (!Number.isInteger(maxAttachmentMb) || maxAttachmentMb < 1 || maxAttachmentMb > 100) {
    throw new Error('MAX_ATTACHMENT_MB must be an integer between 1 and 100');
  }
  const maxAttachmentsPerTask = Number(env.MAX_ATTACHMENTS_PER_TASK || 10);
  if (!Number.isInteger(maxAttachmentsPerTask) || maxAttachmentsPerTask < 1 || maxAttachmentsPerTask > 100) {
    throw new Error('MAX_ATTACHMENTS_PER_TASK must be an integer between 1 and 100');
  }
  const exportMaxRows = Number(env.EXPORT_MAX_ROWS || 50000);
  if (!Number.isInteger(exportMaxRows) || exportMaxRows < 1 || exportMaxRows > 1000000) {
    throw new Error('EXPORT_MAX_ROWS must be an integer between 1 and 1000000');
  }
  const exportTimezone = env.EXPORT_TIMEZONE || 'Asia/Kolkata';
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: exportTimezone });
  } catch {
    throw new Error('EXPORT_TIMEZONE must be a valid IANA timezone');
  }
  const storageLimitMb = env.STORAGE_LIMIT_MB ? Number(env.STORAGE_LIMIT_MB) : null;
  if (storageLimitMb !== null
    && (!Number.isInteger(storageLimitMb) || storageLimitMb < 1 || storageLimitMb > 1000000000)) {
    throw new Error('STORAGE_LIMIT_MB must be a positive integer');
  }
  const blockCloseWithOpenTasksValue = String(env.BLOCK_CLOSE_WITH_OPEN_TASKS || 'false').toLowerCase();
  if (!['true','false'].includes(blockCloseWithOpenTasksValue)) {
    throw new Error('BLOCK_CLOSE_WITH_OPEN_TASKS must be true or false');
  }

  return {
    nodeEnv,
    port,
    databaseUrl: env.DATABASE_URL,
    databaseSsl: env.DATABASE_SSL === 'true',
    databasePoolMax,
    jwtSecret: env.JWT_SECRET,
    jwtExpiresIn,
    clientOrigins: parseClientOrigins(env.CLIENT_URL, nodeEnv),
    allowSelfRegistration: env.ALLOW_SELF_REGISTRATION === 'true',
    maxUploadMb,
    maxAttachmentMb,
    maxAttachmentsPerTask,
    exportMaxRows,
    exportTimezone,
    storageLimitMb,
    blockCloseWithOpenTasks: blockCloseWithOpenTasksValue === 'true',
    jsonLimit: `${Math.ceil(Math.max(maxUploadMb, maxAttachmentMb) * 1.4)}mb`
  };
}

module.exports = { loadConfig };
