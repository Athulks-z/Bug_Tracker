const test = require('node:test');
const assert = require('node:assert/strict');
const {
  createMailer, validateConfig, GRAPH_SCOPE, appendEmailFooter, getEmailFooter
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
  assert.match(payload.message.body.content, /^<p>Hello<\/p>/);
  assert.match(payload.message.body.content, /<strong>Note:<\/strong>/);
  assert.match(payload.message.body.content, /<strong>PS:<\/strong>/);
  assert.equal(payload.message.body.content.split('This e-mail is generated from Task Tracker.').length - 1, 1);
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

test('email footer is appended once to HTML and plain text, with an opt-out', () => {
  const mail = appendEmailFooter({ html: '<p>Hello</p>', text: 'Hello' });
  const footer = getEmailFooter();
  assert.ok(mail.html.endsWith(footer.html));
  assert.ok(mail.text.endsWith(footer.text));
  assert.match(mail.text, /\n\n-{4,}\nRegards,/);
  assert.equal(mail.html.split('This e-mail is generated from Task Tracker.').length - 1, 1);
  assert.equal(mail.text.split('This e-mail is generated from Task Tracker.').length - 1, 1);

  const alreadyAppended = appendEmailFooter(mail);
  assert.equal(alreadyAppended.html, mail.html);
  assert.equal(alreadyAppended.text, mail.text);

  const skipped = appendEmailFooter({ html: '<p>Hello</p>', text: 'Hello', skipFooter: true });
  assert.equal(skipped.html, '<p>Hello</p>');
  assert.equal(skipped.text, 'Hello');
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

test('Microsoft Graph mailer retries 500, 502, 503, and 504 with backoff', async () => {
  for (const status of [500, 502, 503, 504]) {
    const delays = [];
    let calls = 0;
    const mailer = createMailer({
      config,
      msalClient: createMsalClient(),
      minSendIntervalMs: 0,
      sleep: async (milliseconds) => { delays.push(milliseconds); },
      logger: { error() {} },
      fetchImpl: async () => {
        calls += 1;
        return calls === 1
          ? graphResponse(status, { error: { message: `Temporary ${status} failure` } })
          : graphResponse(202);
      }
    });

    await mailer.sendMail({
      to: ['person@example.com'],
      subject: `Retry ${status} test`,
      text: 'Hello'
    });

    assert.equal(calls, 2, `status ${status} should retry once`);
    assert.deepEqual(delays, [1000], `status ${status} should use exponential backoff`);
  }
});

test('Microsoft Graph mailer does not retry 501', async () => {
  let calls = 0;
  const delays = [];
  const mailer = createMailer({
    config,
    msalClient: createMsalClient(),
    minSendIntervalMs: 0,
    sleep: async (milliseconds) => { delays.push(milliseconds); },
    logger: { error() {} },
    fetchImpl: async () => {
      calls += 1;
      return graphResponse(501, { error: { message: 'Not implemented' } });
    }
  });

  await assert.rejects(
    mailer.sendMail({ to: ['person@example.com'], subject: 'No retry', text: 'Hello' }),
    (error) => error.statusCode === 501
  );
  assert.equal(calls, 1);
  assert.deepEqual(delays, []);
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

test('Microsoft Graph mailer skips sends disabled by global or per-event settings', async () => {
  let calls = 0;
  const skippedEvents = [];
  const makeMailerWith = (settings) => createMailer({
    config,
    msalClient:createMsalClient(),
    settingsProvider:async () => settings,
    minSendIntervalMs:0,
    logger:{ error() {},info(_message,context) { skippedEvents.push(context.eventType) } },
    fetchImpl:async () => { calls += 1;return graphResponse(202) }
  });

  const globallyDisabled = await makeMailerWith({
    emailEnabled:false,emailEvents:{ task_assigned:true }
  }).sendMail({ eventType:'task_assigned',to:['person@example.com'],subject:'Disabled',text:'Hello' });
  const eventDisabled = await makeMailerWith({
    emailEnabled:true,emailEvents:{ task_assigned:false }
  }).sendMail({ eventType:'task_assigned',to:['person@example.com'],subject:'Disabled',text:'Hello' });

  assert.deepEqual(globallyDisabled,{ skipped:true });
  assert.deepEqual(eventDisabled,{ skipped:true });
  assert.equal(calls,0);
  assert.deepEqual(skippedEvents,['task_assigned','task_assigned']);
});

test('Microsoft Graph mailer sends through a custom sender when provided', async () => {
  let requestUrl;
  const mailer = createMailer({
    config,
    msalClient:createMsalClient(),
    minSendIntervalMs:0,
    logger:{ error() {} },
    fetchImpl:async (url) => { requestUrl = url;return graphResponse(202) }
  });
  await mailer.sendMail({
    sender:'custom@example.com',
    to:['person@example.com'],
    subject:'Custom sender',
    text:'Hello'
  });
  assert.equal(requestUrl,'https://graph.microsoft.com/v1.0/users/custom%40example.com/sendMail');
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
