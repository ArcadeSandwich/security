// SEC-PROG-39 (Security · Programs, 2026-10-21): the order store's limits. Run from the repository root:
//   node --test worker/test/sec-prog-39.test.mjs
// A small stand-in for D1 keeps only the submissions table; nothing reaches Cloudflare, Vipps or Resend.
import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../src/index.js';
import { verifyWebhook } from '../src/vipps.js';

function fakeDb() {
  const rows = [];
  const stmt = (sql, args = []) => ({
    bind: (...a) => stmt(sql, a),
    async run() {
      if (/^DELETE FROM submissions/.test(sql)) { for (let i = rows.length - 1; i >= 0; i--) if (rows[i].created_at < args[0]) rows.splice(i, 1); }
      else if (/^INSERT INTO submissions/.test(sql)) rows.push({ ip_hash: args[0], created_at: args[1] });
      return { meta: { changes: 0 } };
    },
    async first() {
      if (/COUNT\(\*\) AS n FROM submissions/.test(sql)) return { n: rows.filter((r) => r.ip_hash === args[0] && r.created_at > args[1]).length };
      return null;
    },
    async all() { return { results: [] }; },
  });
  return { prepare: (sql) => stmt(sql), batch: async () => [], rows };
}
const env = (extra = {}) => ({ DB: fakeDb(), ADMIN_PASSWORD: 'right-password-for-tests', RATE_SALT: 'test', ALLOWED_ORIGINS: 'https://musta.no', ...extra });
const call = (e, path, init = {}, ip = '203.0.113.9') =>
  worker.fetch(new Request('https://musta.no' + path, { ...init, headers: { 'CF-Connecting-IP': ip, ...(init.headers || {}) } }), e, { waitUntil() {} });

test('SEC-PROG-39: wrong admin passwords are limited per visitor (10 in 15 minutes), then 429 even for the right one', async () => {
  const e = env();
  for (let i = 0; i < 10; i++) assert.equal((await call(e, '/api/admin/orders', { headers: { 'X-Admin-Password': 'wrong' + i } })).status, 401);
  assert.equal((await call(e, '/api/admin/orders', { headers: { 'X-Admin-Password': 'right-password-for-tests' } })).status, 429);
});

test('SEC-PROG-39: an IPv6 visitor is one visitor for its whole /64, however the address is written', async () => {
  const e = env();
  const ips = ['2001:db8:1:2::1', '2001:db8:1:2::2', '2001:0db8:0001:0002:ffff::9', '2001:db8:1:2:aaaa:bbbb:cccc:dddd'];
  for (let i = 0; i < 10; i++) await call(e, '/api/admin/orders', { headers: { 'X-Admin-Password': 'wrong' } }, ips[i % ips.length]);
  assert.equal((await call(e, '/api/admin/orders', { headers: { 'X-Admin-Password': 'wrong' } }, '2001:db8:1:2::77')).status, 429);
  assert.equal((await call(e, '/api/admin/orders', { headers: { 'X-Admin-Password': 'wrong' } }, '2001:db8:1:3::1')).status, 401, 'another /64 is another visitor');
});

test('SEC-PROG-39: X-Forwarded-For is never the visitor', async () => {
  const e = env();
  for (let i = 0; i < 10; i++) await call(e, '/api/admin/orders', { headers: { 'X-Admin-Password': 'wrong', 'X-Forwarded-For': '198.51.100.' + i } });
  assert.equal((await call(e, '/api/admin/orders', { headers: { 'X-Admin-Password': 'wrong', 'X-Forwarded-For': '198.51.100.200' } })).status, 429);
});

test('SEC-PROG-39: a body over 16 KB is refused with 413 before it is parsed', async () => {
  const e = env({ ORDERS_OPEN: 'yes' });
  const big = JSON.stringify({ name: 'x'.repeat(20000) });
  assert.equal((await call(e, '/api/orders', { method: 'POST', body: big, headers: { 'Content-Type': 'application/json' } })).status, 413);
});

test('SEC-PROG-39: the order without payment stays closed unless ORDERS_OPEN is "yes"', async () => {
  const r = await call(env(), '/api/orders', { method: 'POST', body: '{}', headers: { 'Content-Type': 'application/json' } });
  assert.equal(r.status, 503);
});

test('SEC-PROG-39: answers carry nosniff, and no stack trace leaves on an error', async () => {
  const e = env({ DB: { prepare() { throw new Error('secret internal detail'); } } });
  const r = await call(e, '/api/counts');
  assert.equal(r.status, 500);
  assert.equal(r.headers.get('X-Content-Type-Options'), 'nosniff');
  assert.deepEqual(await r.json(), { error: 'server error' });
});

// A correctly signed notice, so only its age decides (the made-up secret is for this test only).
async function signed(date) {
  const body = '{}';
  const hash = Buffer.from(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(body))).toString('base64');
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode('test-secret'), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = Buffer.from(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`POST\n/api/vipps/webhook\n${date};musta.no;${hash}`))).toString('base64');
  const req = new Request('https://musta.no/api/vipps/webhook', { method: 'POST', body, headers: { 'x-ms-content-sha256': hash, 'x-ms-date': date, host: 'musta.no', authorization: `HMAC-SHA256 SignedHeaders=x-ms-date;host;x-ms-content-sha256&Signature=${sig}` } });
  return verifyWebhook({ VIPPS_WEBHOOK_SECRET: 'test-secret' }, req, body);
}
test('SEC-PROG-39: a correctly signed Vipps notice is accepted when fresh, refused when older than 5 minutes', async () => {
  assert.equal(await signed(new Date().toUTCString()), true, 'fresh');
  assert.equal(await signed(new Date(Date.now() - 10 * 60_000).toUTCString()), false, 'ten minutes old');
});
