import test from 'node:test';
import assert from 'node:assert/strict';
import { getStoredAccessToken, resolveApiBaseUrl, shouldAttachAuthToken } from './runtime-config.mjs';

test('uses the configured API base URL and removes trailing slashes', () => {
  assert.equal(
    resolveApiBaseUrl(
      { protocol: 'https:', hostname: 'app.example.com', origin: 'https://app.example.com' },
      'https://api.example.com/v1/'
    ),
    'https://api.example.com/v1'
  );
});

test('keeps localhost development pointed at the local API', () => {
  assert.equal(
    resolveApiBaseUrl(
      { protocol: 'http:', hostname: 'localhost', origin: 'http://localhost:4200' }
    ),
    'http://127.0.0.1:8000'
  );
});

test('uses the deployed app origin by default instead of assuming API port 8000', () => {
  assert.equal(
    resolveApiBaseUrl(
      { protocol: 'https:', hostname: 'app.example.com', origin: 'https://app.example.com' }
    ),
    'https://app.example.com'
  );
});

test('rejects insecure production API configuration and unsafe schemes', () => {
  const location = { protocol: 'https:', hostname: 'app.example.com', origin: 'https://app.example.com' };
  assert.equal(resolveApiBaseUrl(location, 'http://api.example.com'), location.origin);
  assert.equal(resolveApiBaseUrl(location, 'javascript:alert(1)'), location.origin);
});

test('reads only a non-empty access token from the existing stored user object', () => {
  assert.equal(getStoredAccessToken('{"id":7,"email":"user@example.com","access_token":"abc","token_type":"bearer"}'), 'abc');
  assert.equal(getStoredAccessToken('{"id":7,"email":"user@example.com"}'), null);
  assert.equal(getStoredAccessToken('{invalid'), null);
  assert.equal(getStoredAccessToken(null), null);
});

test('only attaches bearer auth to app API calls, never auth or third-party calls', () => {
  const apiBase = 'https://api.example.com';
  assert.equal(shouldAttachAuthToken('https://api.example.com/api/projects', apiBase), true);
  assert.equal(shouldAttachAuthToken('https://api.example.com/api/auth/login', apiBase), false);
  assert.equal(shouldAttachAuthToken('https://api.example.com/api/auth/register', apiBase), false);
  assert.equal(shouldAttachAuthToken('https://api.example.com/api/auth/verify-email', apiBase), false);
  assert.equal(shouldAttachAuthToken('https://api.example.com/api/auth/resend-verification', apiBase), false);
  assert.equal(shouldAttachAuthToken('https://api.example.com/api/auth/paypal-login', apiBase), false);
  assert.equal(shouldAttachAuthToken('https://paypal.com/oauth', apiBase), false);
});
