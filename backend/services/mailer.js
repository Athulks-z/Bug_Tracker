const fs = require('fs/promises');
const { ConfidentialClientApplication } = require('@azure/msal-node');

const GRAPH_SCOPE = 'https://graph.microsoft.com/.default';
const GRAPH_SEND_MAIL_ENDPOINT = 'https://graph.microsoft.com/v1.0/users';
const RETRYABLE_STATUSES = new Set([429, 500, 502, 503, 504]);
const MAX_RETRIES = 3;
const MIN_SEND_INTERVAL_MS = 2500;

class GraphMailError extends Error {
  constructor(status, message) {
    super(message || `Microsoft Graph email request failed with status ${status}`);
    this.name = 'GraphMailError';
    this.statusCode = status;
    this.responseCode = status;
    this.code = 'GRAPH_MAIL_ERROR';
  }
}

function readConfig(env = process.env) {
  return {
    tenantId: env.MS_TENANT_ID,
    clientId: env.MS_CLIENT_ID,
    clientSecret: env.MS_CLIENT_SECRET,
    sender: env.MS_SENDER
  };
}

function validateConfig(config = readConfig()) {
  const required = [
    ['tenantId', 'MS_TENANT_ID'],
    ['clientId', 'MS_CLIENT_ID'],
    ['clientSecret', 'MS_CLIENT_SECRET'],
    ['sender', 'MS_SENDER']
  ];
  const missing = required
    .filter(([key]) => !String(config[key] || '').trim())
    .map(([, envName]) => envName);
  if (missing.length) {
    throw new Error(`Microsoft Graph email configuration is missing: ${missing.join(', ')}`);
  }
  return config;
}

function recipientAddress(recipient) {
  if (typeof recipient === 'string') return recipient;
  return recipient?.emailAddress?.address || recipient?.address || recipient?.email || '';
}

function graphRecipients(recipients) {
  return (Array.isArray(recipients) ? recipients : recipients ? [recipients] : [])
    .map(recipientAddress)
    .filter(Boolean)
    .map((address) => ({ emailAddress: { address } }));
}

function retryDelay(retryAfter, retryNumber, now = Date.now) {
  if (retryAfter) {
    const seconds = Number(retryAfter);
    if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1000;
    const dateDelay = Date.parse(retryAfter) - now();
    if (Number.isFinite(dateDelay) && dateDelay > 0) return dateDelay;
  }
  return 1000 * (2 ** (retryNumber - 1));
}

async function graphAttachment(attachment) {
  const name = attachment.filename || attachment.name;
  let content;
  if (Buffer.isBuffer(attachment.content)) {
    content = attachment.content;
  } else if (attachment.contentBytes) {
    return {
      '@odata.type': '#microsoft.graph.fileAttachment',
      name,
      contentType: attachment.contentType || attachment.content_type || 'application/octet-stream',
      contentBytes: attachment.contentBytes
    };
  } else if (attachment.path) {
    content = await fs.readFile(attachment.path);
  } else {
    throw new TypeError(`Email attachment "${name || 'unnamed'}" must have a path or content`);
  }
  return {
    '@odata.type': '#microsoft.graph.fileAttachment',
    name,
    contentType: attachment.contentType || attachment.content_type || 'application/octet-stream',
    contentBytes: content.toString('base64')
  };
}

function createMailer({
  config: suppliedConfig = readConfig(),
  msalClient: suppliedMsalClient,
  fetchImpl = globalThis.fetch,
  sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)),
  now = Date.now,
  minSendIntervalMs = MIN_SEND_INTERVAL_MS,
  logger = console
} = {}) {
  const config = validateConfig(suppliedConfig);
  if (typeof fetchImpl !== 'function') throw new Error('Node.js fetch is required for Microsoft Graph email delivery');
  const msalClient = suppliedMsalClient || new ConfidentialClientApplication({
    auth: {
      clientId: config.clientId,
      authority: `https://login.microsoftonline.com/${config.tenantId}`,
      clientSecret: config.clientSecret
    }
  });
  let queue = Promise.resolve();
  let nextSendAt = 0;

  async function sendNow(mail) {
    const attachments = await Promise.all((mail.attachments || []).map(graphAttachment));
    const body = mail.html
      ? { contentType: 'HTML', content: mail.html }
      : { contentType: 'Text', content: mail.text || '' };
    const message = {
      subject: mail.subject || '',
      body,
      toRecipients: graphRecipients(mail.to),
      ccRecipients: graphRecipients(mail.cc),
      bccRecipients: graphRecipients(mail.bcc)
    };
    if (attachments.length) message.attachments = attachments;

    for (let attempt = 0; attempt <= MAX_RETRIES; attempt += 1) {
      const waitMs = Math.max(0, nextSendAt - now());
      if (waitMs) await sleep(waitMs);
      nextSendAt = now() + minSendIntervalMs;

      const tokenResult = await msalClient.acquireTokenByClientCredential({ scopes: [GRAPH_SCOPE] });
      if (!tokenResult?.accessToken) throw new Error('Microsoft identity platform returned no access token');

      const response = await fetchImpl(
        `${GRAPH_SEND_MAIL_ENDPOINT}/${encodeURIComponent(config.sender)}/sendMail`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${tokenResult.accessToken}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({ message, saveToSentItems: false })
        }
      );

      if (response.status === 202) return;
      let payload = {};
      const responseText = await response.text();
      if (responseText) {
        try {
          payload = JSON.parse(responseText);
        } catch {
          payload = { error: { message: responseText } };
        }
      }
      const graphMessage = payload?.error?.message || response.statusText || 'Unknown Graph error';
      if (RETRYABLE_STATUSES.has(response.status) && attempt < MAX_RETRIES) {
        await sleep(retryDelay(response.headers?.get('Retry-After'), attempt + 1, now));
        continue;
      }
      throw new GraphMailError(response.status, graphMessage);
    }
  }

  function sendMail(mail) {
    const job = queue.then(async () => {
      try {
        await sendNow(mail);
      } catch (error) {
        const status = error.statusCode || error.responseCode || '';
        const message = String(error.message || 'Email delivery failed')
          .replace(/[\r\n\x00-\x1f\x7f]+/g, ' ')
          .slice(0, 500);
        logger.error('Microsoft Graph email delivery failed', {
          recipientCount: graphRecipients(mail.to).length
            + graphRecipients(mail.cc).length
            + graphRecipients(mail.bcc).length,
          subject: String(mail.subject || '').slice(0, 200),
          status,
          message
        });
        throw error;
      }
    });
    queue = job.catch(() => {});
    return job;
  }

  return { sendMail };
}

let defaultMailer;

function sendMail(mail) {
  if (!defaultMailer) defaultMailer = createMailer();
  return defaultMailer.sendMail(mail);
}

module.exports = {
  GraphMailError,
  createMailer,
  readConfig,
  validateConfig,
  sendMail,
  GRAPH_SCOPE,
  MAX_RETRIES
};
