const test = require('node:test');
const assert = require('node:assert/strict');
const { TABLES } = require('../services/sheetsStore');
const { parseSheetRows, summarize } = require('./migrateSheets');

test('Sheets dry-run parser reports safe validation codes without including cell values', () => {
  const headers = TABLES.users.columns;
  const columns = (values) => headers.map((field) => values[field] ?? '');
  const parsed = parseSheetRows('users', [
    headers,
    columns({ _id: 'user-1', name: 'Private Name', email: 'person@example.test', bootstrapAdmin: 'true', assignedProjects: '[]' }),
    columns({ _id: 'user-2', name: 'Private Name', email: 'PERSON@example.test', bootstrapAdmin: 'true', assignedProjects: '{invalid' })
  ]);
  const report = summarize({ users: parsed });

  assert.equal(parsed.records.length, 1);
  assert.deepEqual(
    parsed.issues.map(({ code }) => code).sort(),
    ['duplicate_email', 'malformed_value', 'multiple_bootstrap_admins']
  );
  assert.equal(JSON.stringify(report).includes('Private Name'), false);
  assert.equal(JSON.stringify(report).includes('person@example.test'), false);
});

test('Sheets dry-run parser rejects duplicate ids and missing headers', () => {
  const headers = TABLES.projects.columns;
  const row = headers.map((field) => ({ _id: 'project-1', name: 'Private Project' }[field] || ''));
  const duplicateIds = parseSheetRows('projects', [headers, row, row]);
  assert.deepEqual(duplicateIds.issues.map(({ code }) => code), ['duplicate_id']);

  const missingHeaders = parseSheetRows('projects', []);
  assert.equal(missingHeaders.issues[0].code, 'header_mismatch');
});
