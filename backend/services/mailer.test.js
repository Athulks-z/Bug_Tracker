const test = require('node:test');
const assert = require('node:assert/strict');
const {
  createMailer, validateConfig, GRAPH_SCOPE
} = require('./mailer');

const config = {
  tenantId: 'tenant-id',
  clientId: 'client-id',
  clientSecret: 'client-secret',
  sender: 'sender@example.com'
};

function createMsalClient() {
  const requests = [];
  return {
    requests,
    async acquireTokenByClientCredential(request) {
      requests.push(request);
      return { accessToken: 'test-access-token' };
    }
  };
}

function graphResponse(status, payload = {}, retryAfter = null) {
  return {
    status,
    statusText: '',
    headers: { get: (name) => name.toLowerCase() === 'retry-after' ? retryAfter : null },
    async text() { return JSON.stringify(payload); }
  };
}

test('Microsoft Graph mailer sends recipients, HTML, and file attachments on HTTP 202', async () => {
  const msalClient = createMsalClient();
  let request;
  const mailer = createMailer({
    config,
    msalClient,
    minSendIntervalMs: 0,
    logger: { error() {} },
    fetchImpl: async (url, options) => {
      request = { url, options };
      return graphResponse(202);
    }
  });

  await mailer.sendMail({
    to: ['to@example.com'],
    cc: ['cc@example.com'],
    bcc: ['bcc@example.com'],
    subject: 'Test message',
    html: '<p>Hello</p>',
    text: 'Hello',
    attachments: [{
      filename: 'report.txt',
      content: Buffer.from('report body'),
      contentType: 'text/plain'
    }]
  });

  assert.equal(request.url, 'https://graph.microsoft.com/v1.0/users/sender%40example.com/sendMail');
  assert.equal(request.options.method, 'POST');
  assert.equal(request.options.headers.Authorization, 'Bearer test-access-token');
  const payload = JSON.parse(request.options.body);
  assert.equal(payload.saveToSentItems, false);
  assert.equal(payload.message.body.contentType, 'HTML');
  assert.equal(payload.message.body.content, '<p>Hello</p>');
  assert.deepEqual(payload.message.toRecipients, [{ emailAddress: { address: 'to@example.com' } }]);
  assert.deepEqual(payload.message.ccRecipients, [{ emailAddress: { address: 'cc@example.com' } }]);
  assert.deepEqual(payload.message.bccRecipients, [{ emailAddress: { address: 'bcc@example.com' } }]);
  assert.deepEqual(payload.message.attachments, [{
    '@odata.type': '#microsoft.graph.fileAttachment',
    name: 'report.txt',
    contentType: 'text/plain',
    contentBytes: Buffer.from('report body').toString('base64')
  }]);
  assert.deepEqual(msalClient.requests, [{ scopes: [GRAPH_SCOPE] }]);
});

test('Microsoft Graph mailer retries 429 and honors Retry-After', async () => {
  const delays = [];
  let calls = 0;
  const mailer = createMailer({
    config,
    msalClient: createMsalClient(),
    minSendIntervalMs: 0,
    now: () => 1000,
    sleep: async (milliseconds) => { delays.push(milliseconds); },
    logger: { error() {} },
    fetchImpl: async () => {
      calls += 1;
      return calls === 1
        ? graphResponse(429, { error: { message: 'Throttled' } }, '3')
        : graphResponse(202);
    }
  });

  await mailer.sendMail({ to: ['person@example.com'], subject: 'Retry test', text: 'Hello' });

  assert.equal(calls, 2);
  assert.deepEqual(delays, [3000]);
});

test('Microsoft Graph mailer fails on 403 without retrying', async () => {
  let calls = 0;
  const mailer = createMailer({
    config,
    msalClient: createMsalClient(),
    minSendIntervalMs: 0,
    logger: { error() {} },
    fetchImpl: async () => {
      calls += 1;
      return graphResponse(403, { error: { message: 'Insufficient privileges' } });
    }
  });

  await assert.rejects(
    mailer.sendMail({ to: ['person@example.com'], subject: 'Forbidden', text: 'Hello' }),
    (error) => error.statusCode === 403 && /Insufficient privileges/.test(error.message)
  );
  assert.equal(calls, 1);
});

test('Microsoft Graph mailer reports missing configuration', () => {
  assert.throws(
    () => validateConfig({}),
    /MS_TENANT_ID, MS_CLIENT_ID, MS_CLIENT_SECRET, MS_SENDER/
  );
});

test('Microsoft Graph mailer queues sends at no more than 24 messages per minute', async () => {
  let currentTime = 1000;
  const delays = [];
  const mailer = createMailer({
    config,
    msalClient: createMsalClient(),
    now: () => currentTime,
    sleep: async (milliseconds) => {
      delays.push(milliseconds);
      currentTime += milliseconds;
    },
    logger: { error() {} },
    fetchImpl: async () => graphResponse(202)
  });

  await Promise.all([
    mailer.sendMail({ to: ['one@example.com'], subject: 'One', text: 'Hello' }),
    mailer.sendMail({ to: ['two@example.com'], subject: 'Two', text: 'Hello' })
  ]);

  assert.deepEqual(delays, [2500]);
});
