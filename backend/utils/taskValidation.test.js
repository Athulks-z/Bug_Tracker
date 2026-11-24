const test = require('node:test');
const assert = require('node:assert/strict');
const {
  plainCustomType,
  sanitizeTaskDescription,
  validateAttachmentFilename,
  startDateOrToday,
  validateCustomTypeName
} = require('./taskValidation');

test('Other custom type is trimmed, plain text, and limited', () => {
  assert.equal(plainCustomType('  <Calibration>  '), 'Calibration');
  assert.equal(plainCustomType('x'.repeat(140)).length, 100);
});

test('rich text sanitizer removes scripts and keeps safe formatting', () => {
  const sanitized = sanitizeTaskDescription('<h2 onclick="bad()">Steps</h2><script>alert(1)</script><p><a href="https://example.com" target="_self" onclick="bad()">Link</a></p>');
  assert.doesNotMatch(sanitized, /<script|onclick|javascript:/i);
  assert.match(sanitized, /<h2>Steps<\/h2>/);
  assert.match(sanitized, /rel="noopener noreferrer"/);
  assert.match(sanitized, /target="_blank"/);
});

test('blocked extensions and double extensions are rejected', () => {
  assert.equal(validateAttachmentFilename('installer.exe').valid, false);
  assert.equal(validateAttachmentFilename('report.pdf.exe').valid, false);
  assert.equal(validateAttachmentFilename('report.final.pdf').valid, false);
  assert.equal(validateAttachmentFilename('photo.png').valid, true);
});

test('start date defaults to today when empty', () => {
  assert.equal(startDateOrToday(''), new Date().toISOString().slice(0, 10));
  assert.equal(startDateOrToday('2026-12-01'), '2026-12-01');
});

test('custom type is required only for Other', () => {
  assert.equal(validateCustomTypeName('other', '').valid, false);
  assert.deepEqual(validateCustomTypeName('other', '  Calibration  '), {
    valid:true,
    type:'other',
    customTypeName:'Calibration'
  });
  assert.equal(validateCustomTypeName('bug', 'Calibration').valid, false);
  assert.equal(validateCustomTypeName('bug', '').valid, true);
});
