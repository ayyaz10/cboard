import test from 'node:test';
import assert from 'node:assert/strict';
import { createUsernameLoginHandler } from './handler.js';

const config = {
  SUPABASE_URL: 'https://project.example',
  SUPABASE_SECRET_KEYS: JSON.stringify({ default: 'server-secret-key' }),
  SUPABASE_SERVICE_ROLE_KEY: 'server-only-key',
};

function setup({ profile, profileError, authStatus = 200, authBody = { access_token: 'access', refresh_token: 'refresh' } } = {}) {
  const calls = { profile: [], auth: [] };
  const handler = createUsernameLoginHandler({
    env: key => config[key],
    createClient: (_url, key, options) => {
      assert.equal(key, config.SUPABASE_SERVICE_ROLE_KEY);
      assert.equal(options.auth.persistSession, false);
      return {
        from: table => {
          assert.equal(table, 'profiles');
          return {
            select: columns => { assert.equal(columns, 'email'); return { eq: (column, username) => {
              assert.equal(column, 'username');
              calls.profile.push(username);
              return { maybeSingle: async () => ({ data: profile ? { email: profile } : null, error: profileError }) };
            } }; },
          };
        },
      };
    },
    fetchImpl: async (url, init) => {
      calls.auth.push({ url, init, body: JSON.parse(init.body) });
      return new Response(JSON.stringify(authBody), { status: authStatus, headers: { 'content-type': 'application/json' } });
    },
  });
  return { handler, calls };
}

const post = body => new Request('https://project.example/functions/v1/username-login', {
  method: 'POST', headers: { 'content-type': 'application/json', 'x-forwarded-for': '203.0.113.8, 10.0.0.1' }, body: JSON.stringify(body),
});

test('username login queries only the email server-side and returns only session tokens', async () => {
  const { handler, calls } = setup({ profile: 'person@example.com', authBody: { access_token: 'a', refresh_token: 'r', user: { email: 'person@example.com' } } });
  const response = await handler(post({ username: 'Person_1', password: 'secret' }));
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { access_token: 'a', refresh_token: 'r' });
  assert.deepEqual(calls.profile, ['person_1']);
  assert.equal(calls.auth[0].body.email, 'person@example.com');
  assert.equal(calls.auth[0].init.headers.apikey, 'server-secret-key');
  assert.equal(calls.auth[0].init.headers['sb-forwarded-for'], '203.0.113.8');
});

test('unknown usernames still use the Auth password endpoint and receive the same credential error', async () => {
  const { handler, calls } = setup({ authStatus: 400, authBody: { msg: 'Invalid login credentials' } });
  const response = await handler(post({ username: 'missing_user', password: 'wrong' }));
  assert.equal(response.status, 401);
  assert.deepEqual(await response.json(), { error: 'Invalid login credentials.' });
  assert.equal(calls.auth[0].body.email, 'unknown-missing_user@invalid.local');
});

test('malformed usernames are rejected without database or Auth requests', async () => {
  const { handler, calls } = setup();
  const response = await handler(post({ username: 'bad@domain.com', password: 'secret' }));
  assert.equal(response.status, 401);
  assert.equal(calls.profile.length, 0);
  assert.equal(calls.auth.length, 0);
});

test('database errors fail closed without attempting password authentication', async () => {
  const { handler, calls } = setup({ profileError: new Error('database unavailable') });
  const response = await handler(post({ username: 'valid_user', password: 'secret' }));
  assert.equal(response.status, 503);
  assert.equal(calls.auth.length, 0);
});

test('preflight requests are supported and other methods are rejected', async () => {
  const { handler } = setup();
  assert.equal((await handler(new Request('https://project.example', { method: 'OPTIONS' }))).status, 200);
  assert.equal((await handler(new Request('https://project.example', { method: 'GET' }))).status, 405);
});
