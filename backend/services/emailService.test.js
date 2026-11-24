const test = require('node:test');
const assert = require('node:assert/strict');
const {
  buildRecipients,
  buildAssignmentContent,
  buildAssignmentRejectedContent,
  buildTaskBlockedContent,
  buildStakeholderRecipients,
  SENDER_EMAIL
} = require('./emailService');

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
    clientUrl: 'https://tracker.example.com/',
    acceptUrl: 'https://tracker.example.com/assignment-response?token=accept-token&action=accept',
    rejectUrl: 'https://tracker.example.com/assignment-response?token=reject-token&action=reject'
  });

  assert.equal(content.subject.includes('\r'), false);
  assert.equal(content.subject.includes('\n'), false);
  assert.match(content.html, /&lt;Alice&gt;/);
  assert.match(content.html, /&lt;Project&gt;/);
  assert.match(content.html, /&lt;Admin&gt;/);
  assert.match(content.html, /https:\/\/tracker\.example\.com\/tasks\?project=p1/);
  assert.match(content.html, /Accept assignment/);
  assert.match(content.html, /Reject assignment/);
  assert.match(content.html, /accept-token/);
  assert.match(content.html, /reject-token/);
});

test('rejection email includes the reason safely in text and HTML', () => {
  const content = buildAssignmentRejectedContent({
    kind: 'task',
    title: 'Update <portal>',
    projectName: 'Website',
    rejectedBy: 'Athul KS',
    closingRemarks: 'Blocked <script>\nNeed access'
  });

  assert.match(content.subject, /Task rejected: Update <portal>/);
  assert.match(content.text, /Blocked <script>\nNeed access/);
  assert.match(content.text, /Rejected by: Athul KS/);
  assert.match(content.html, /Blocked &lt;script&gt;<br>Need access/);
  assert.match(content.html, /Rejected by:<\/strong> Athul KS/);
  assert.doesNotMatch(content.html, /<script>/);
});

test('blocked-task email names the blocker and escapes task details', () => {
  const content = buildTaskBlockedContent({
    title: 'Update <portal>',
    projectName: '<Website>',
    blockedBy: '<Alice>'
  });

  assert.equal(content.subject, '[TaskTracker] Task blocked: Update <portal>');
  assert.match(content.text, /Blocked by: <Alice>/);
  assert.match(content.html, /&lt;Website&gt;/);
  assert.match(content.html, /&lt;Alice&gt;/);
  assert.doesNotMatch(content.html, /<Alice>/);
});

test('blocked-task notifications address every stakeholder and deduplicate sender', () => {
  const recipients = buildStakeholderRecipients([
    { id: 'one', name: 'One', email: 'one@example.com' },
    { id: 'two', name: 'Two', email: 'two@example.com' },
    { id: 'duplicate', name: 'Duplicate', email: 'ONE@example.com' },
    { id: 'admin', name: 'Admin', email: SENDER_EMAIL }
  ]);

  assert.deepEqual(recipients.to.map(recipient => recipient.email), [
    'one@example.com',
    'two@example.com',
    SENDER_EMAIL
  ]);
  assert.deepEqual(recipients.cc, []);
});

test('blocked-task notification falls back to the sender when no stakeholders exist', () => {
  const recipients = buildStakeholderRecipients([]);

  assert.deepEqual(recipients.to.map(recipient => recipient.email), [SENDER_EMAIL]);
  assert.deepEqual(recipients.cc, []);
});

test('blocked-task notification rejects stakeholders with invalid email addresses', () => {
  assert.throws(
    () => buildStakeholderRecipients([{ email: 'not-an-email' }]),
    /valid email/
  );
});
