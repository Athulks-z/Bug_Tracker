const test = require('node:test');
const assert = require('node:assert/strict');
const { loadConfig } = require('./config');

const validEnv = {
  MONGODB_URI: 'mongodb://127.0.0.1:27017/bugtracker',
  JWT_SECRET: 'test-secret-with-more-than-thirty-two-characters',
  NODE_ENV: 'development'
};

test('loads safe local defaults and a 12-hour token lifetime', () => {
  const config = loadConfig(validEnv);
  assert.equal(config.jwtExpiresIn, '12h');
  assert.deepEqual(config.clientOrigins, ['http://localhost:3000']);
  assert.equal(config.allowSelfRegistration, false);
  assert.equal(config.maxUploadMb, 5);
});

test('accepts a comma-separated client origin allow-list', () => {
  const config = loadConfig({
    ...validEnv,
    CLIENT_URL: 'https://app.example.com, http://localhost:3001'
  });
  assert.deepEqual(config.clientOrigins, ['https://app.example.com', 'http://localhost:3001']);
});

test('rejects missing production configuration and invalid secrets', () => {
  assert.throws(() => loadConfig({
    ...validEnv,
    NODE_ENV: 'production',
    CLIENT_URL: undefined
  }), /CLIENT_URL is required/);
  assert.throws(() => loadConfig({ ...validEnv, JWT_SECRET: 'short' }), /JWT_SECRET/);
});
