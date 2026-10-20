'use strict';
// SEC-SECRETS-10 test: node --test <this file>, run from a copy of the Playbook with the patch applied
// (set CHECK_JS to that copy's tools\check.js; default is the Playbook's own).
// Uses FAKE fixture files only; it never reads the real C:\irl-stream or arcade-server files, and prints no value.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const CHECK = process.env.CHECK_JS || 'C:\\server\\playbook\\tools\\check.js';
const { loadExtraSecrets } = require(CHECK);

// Fake values, built from parts. Not real secrets.
const F = {
  json: 'fake' + 'JsonKey' + '12345',
  nested: 'fake' + 'Nested' + 'Token9',
  txt: 'fake' + 'Password' + '42',
  url: 'rtmp://live.example.invalid/app/' + 'fake' + 'StreamKey' + '0099',
};

function fixtures() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sec10-'));
  fs.mkdirSync(path.join(dir, 'private'));
  fs.mkdirSync(path.join(dir, 'private-musta'));
  fs.mkdirSync(path.join(dir, 'public'));
  fs.writeFileSync(path.join(dir, 'private', 'keys.json'), JSON.stringify({ a: F.json, b: { c: [F.nested] }, port: '1935', on: 'true', short: 'abc', server: 'rtmp://127.0.0.1:1935/live' }));
  fs.writeFileSync(path.join(dir, 'private-musta', 'dashboard-password.txt'), F.txt + '\n\n');
  fs.writeFileSync(path.join(dir, 'private-musta', 'stream-urls.txt'), F.url + '\n');
  fs.writeFileSync(path.join(dir, 'public', 'readme.txt'), 'fake' + 'NotSecretAtAll' + '\n');
  fs.writeFileSync(path.join(dir, '.env'), `KEY_A=${'fake' + 'OtherProject' + 'Value'}\n`); // outside private*: never loaded
  fs.writeFileSync(path.join(dir, 'private', 'broken.json'), '{ not json');
  return dir;
}

test('loads whole values from private* folders only, and nothing else', () => {
  const dir = fixtures();
  try {
    const { found, notes } = loadExtraSecrets([
      { label: 'irl', dir, dirPattern: /^private/i },
    ]);
    const values = new Set(found.map((f) => f.value));
    for (const v of Object.values(F)) assert.ok(values.has(v), 'a fake value was not loaded');
    assert.strictEqual(found.length, Object.keys(F).length, 'no extra values (ports, booleans, short strings, plain URLs, public folder)');
    for (const f of found) for (const v of Object.values(F)) assert.ok(!f.name.includes(v), 'a name must never hold a value');
    assert.ok(found.some((f) => f.name === 'irl private keys.json: b.c[0]'));
    assert.ok(found.every((f) => f.name.startsWith('irl private')));
    assert.deepStrictEqual(notes, ['irl private broken.json could not be parsed, its values were not checked']);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('a missing folder is skipped quietly', () => {
  const r = loadExtraSecrets([{ label: 'x', dir: path.join(os.tmpdir(), 'no-such-sec10'), dirPattern: /^private/ }]);
  assert.deepStrictEqual(r, { found: [], notes: [] });
});
