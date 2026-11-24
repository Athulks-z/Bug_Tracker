const test = require('node:test');
const assert = require('node:assert/strict');
const {
  buildRecipients,
  buildAssignmentContent,
  buildAssignmentRejectedContent,
  buildTaskBlockedContent,
  buildProjectClosureContent,
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
      taskKey: 'SAFE-12',
      _id: 'task-id-1',
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
  assert.match(content.subject, /SAFE-12/);
  assert.match(content.text, /Task ID: SAFE-12/);
  assert.match(content.html, /<strong>Task ID:<\/strong> SAFE-12/);
  assert.match(content.html, /&lt;Alice&gt;/);
  assert.match(content.html, /&lt;Project&gt;/);
  assert.match(content.html, /&lt;Admin&gt;/);
  assert.match(content.html, /https:\/\/tracker\.example\.com\/tasks\/task-id-1/);
  assert.match(content.html, /Accept assignment/);
  assert.match(content.html, /Reject assignment/);
  assert.match(content.html, /accept-token/);
  assert.match(content.html, /reject-token/);
});

test('rejection email includes the reason safely in text and HTML', () => {
  const content = buildAssignmentRejectedContent({
    kind: 'task',
    taskKey: 'SAFE-13',
    title: 'Update <portal>',
    projectName: 'Website',
    rejectedBy: 'Athul KS',
    closingRemarks: 'Blocked <script>\nNeed access'
  });

  assert.match(content.subject, /Task rejected: SAFE-13: Update <portal>/);
  assert.match(content.text, /Blocked <script>\nNeed access/);
  assert.match(content.text, /Rejected by: Athul KS/);
  assert.match(content.text, /Task ID: SAFE-13/);
  assert.match(content.html, /<strong>Task ID:<\/strong> SAFE-13/);
  assert.match(content.html, /Blocked &lt;script&gt;<br>Need access/);
  assert.match(content.html, /Rejected by:<\/strong> Athul KS/);
  assert.doesNotMatch(content.html, /<script>/);
});

test('blocked-task email names the blocker and escapes task details', () => {
  const content = buildTaskBlockedContent({
    taskKey: 'SAFE-14',
    title: 'Update <portal>',
    projectName: '<Website>',
    blockedBy: '<Alice>'
  });

  assert.equal(content.subject, '[TaskTracker] Task blocked: SAFE-14: Update <portal>');
  assert.match(content.text, /Task ID: SAFE-14/);
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

test('project appreciation email safely renders the closure summary, links, and remarks', () => {
  const content = buildProjectClosureContent({
    project:{ id:'project-1',name:'<Project>',key:'SAFE' },
    closure:{
      closedByName:'<Closer>',
      closedAt:'2026-03-10T12:00:00.000Z',
      closingRemarksHtml:'<p>Completed <strong>safely</strong></p><script>bad()</script>',
      closingRemarksText:'Completed safely',
      links:[{ label:'Guide',url:'https://example.com/guide' }],
      snapshot:{ totalTasks:4,completedTasks:3,rejectedTasks:1,completionPercent:100,durationDays:12 }
    },
    clientUrl:'https://tracker.example.com',
    secureDownloadLink:true
  });

  assert.match(content.subject,/Project closed/);
  assert.match(content.html,/&lt;Project&gt;/);
  assert.match(content.html,/&lt;Closer&gt;/);
  assert.match(content.html,/rel="noopener noreferrer"/);
  assert.match(content.html,/100% completion/);
  assert.doesNotMatch(content.html,/<script>/);
  assert.match(content.html,/Open project in TaskTracker/);
  assert.match(content.text,/Completed safely/);
});
