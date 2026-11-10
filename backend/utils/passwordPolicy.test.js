const test = require('node:test');
const assert = require('node:assert/strict');
const { isStrongPassword } = require('./passwordPolicy');

test('accepts passwords with the required length and character classes', () => {
  assert.equal(isStrongPassword('BugTracker2026'), true);
});

test('rejects short passwords and passwords missing a required character class', () => {
  for (const password of ['Bug1', 'alllowercase1', 'ALLUPPERCASE1', 'NoDigitsHere']) {
    assert.equal(isStrongPassword(password), false, password);
  }
});
