import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { sessionStore } from '../backend/src/services/localSecurity.js';
import { firebaseAuthRequest, firebaseSession, normalizeLoginEmail } from '../backend/src/services/firebaseRequest.js';

test('all frontend modules share the same canonical API/session module URL', async () => {
  const names = await readdir(new URL('../frontend/js/', import.meta.url));
  let apiImports = 0;
  for (const name of names.filter(name => name.endsWith('.js'))) {
    const source = await readFile(new URL(`../frontend/js/${name}`, import.meta.url), 'utf8');
    for (const match of source.matchAll(/(?:from\s*|import\s*)['"]([^'"]*\/api\.js[^'"]*)['"]/g)) {
      apiImports++; assert.equal(match[1], './api.js', `${name} must share the same session instance`);
    }
  }
  assert.ok(apiImports > 2);
});

test('local session revocation, rotation and password reset invalidate both tokens', () => {
  const store = sessionStore(); const user = { id: 'synthetic-user', email: 'test@example.invalid' };
  const first = store.issue(user), second = store.issue(user);
  assert.notEqual(first.access_token, second.access_token);
  store.revoke(first.access_token);
  assert.equal(store.verify(first.access_token), null); assert.equal(store.refresh(first.refresh_token), null);
  const next = store.refresh(second.refresh_token);
  assert.ok(next); assert.equal(store.verify(second.access_token), null); assert.equal(store.refresh(second.refresh_token), null);
  store.revokeUser(user.id); assert.equal(store.refresh(next.refresh_token), null);
  assert.equal(sessionStore().verify(next.access_token), null);
});

test('Firebase authentication forwards the exact supplied password, with no password or account fallback', async () => {
  const calls = [];
  await assert.rejects(firebaseAuthRequest({ apiKey: 'test-key' }, 'signInWithPassword', { email: normalizeLoginEmail('admin'), password: 'wrong-password' }, async (url, options) => {
    calls.push(JSON.parse(options.body));
    return { ok: false, json: async () => ({ error: { message: 'INVALID_LOGIN_CREDENTIALS' } }) };
  }), error => error.status === 401);
  assert.equal(calls.length, 1); assert.equal(calls[0].password, 'wrong-password');
  assert.equal(normalizeLoginEmail('dna.space.sm@gmail.com'), 'dna.space.sm@gmail.com');
});

test('Firebase refresh returns native tokens and rejects incomplete sessions', async () => {
  const result = await firebaseAuthRequest({ apiKey: 'test-key' }, 'refresh', { grant_type: 'refresh_token', refresh_token: 'opaque-test-refresh' }, async (url, options) => {
    assert.match(url, /^https:\/\/securetoken\.googleapis\.com\/v1\/token/);
    assert.equal(new URLSearchParams(options.body).get('refresh_token'), 'opaque-test-refresh');
    return { ok: true, json: async () => ({ id_token: 'native-test-token', refresh_token: 'new-test-refresh', expires_in: '3600' }) };
  });
  assert.equal(firebaseSession(result).access_token, 'native-test-token');
  assert.throws(() => firebaseSession({ idToken: 'missing-refresh' }));
});

test('Vercel serves overview HTML, JSON and vendor assets without rewriting them into the login page', async () => {
  const config = JSON.parse(await readFile(new URL('../vercel.json', import.meta.url), 'utf8'));
  assert.equal(config.outputDirectory, 'public');
  for (const route of config.rewrites) assert.match(route.source, /^\/api/);
  const authSource = await readFile(new URL('../frontend/js/auth.js', import.meta.url), 'utf8');
  assert.equal(authSource.includes('data-fill-pass'), false);
  assert.match(authSource, /role="alert"/);
});
