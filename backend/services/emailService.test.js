const test = require('node:test');
const assert = require('node:assert/strict');
const { buildRecipients, buildAssignmentContent, SENDER_EMAIL } = require('./emailService');

test('assignment email sends to the assignee and deduplicates stakeholders in CC', () => {
  const recipients = buildRecipients(
    { _id: 'assignee', name: 'Assignee', email: 'person@example.com' },
    [
      { _id: 'stakeholder', name: 'Stakeholder', email: 'stakeholder@example.com' },
      { _id: 'duplicate', name: 'Duplicate', email: 'PERSON@example.com' },
      { _id: 'admin', name: 'Admin', email: SENDER_EMAIL }
    ]
  );

  assert.equal(recipients.to.email, 'person@example.com');
  assert.deepEqual(recipients.cc.map(recipient => recipient.email), [
    SENDER_EMAIL,
    'stakeholder@example.com'
  ]);
});

test('assignment email requires an assignee email address', () => {
  assert.throws(() => buildRecipients({ name: 'No address' }, []), /valid email/);
  assert.throws(() => buildRecipients({ email: 'not-an-email' }, []), /valid email/);
});

test('assignment email content escapes HTML and strips header newlines from its subject', () => {
  const content = buildAssignmentContent({
    kind: 'issue',
    item: {
      title: 'Bug\r\nBcc: other@example.com <script>',
      assignee: { name: '<Alice>' },
      status: 'Open'
    },
    project: { _id: 'p1', name: '<Project>', key: 'SAFE' },
    assignedBy: '<Admin>',
    clientUrl: 'https://tracker.example.com/'
  });

  assert.equal(content.subject.includes('\r'), false);
  assert.equal(content.subject.includes('\n'), false);
  assert.match(content.html, /&lt;Alice&gt;/);
  assert.match(content.html, /&lt;Project&gt;/);
  assert.match(content.html, /&lt;Admin&gt;/);
  assert.match(content.html, /https:\/\/tracker\.example\.com\/issues\?project=p1/);
});
