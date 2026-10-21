'use strict';
// SEC-SECRETS-10 test: node --test <this file>, run from a copy of the Playbook with the patch applied
// (set CHECK_JS to that copy's tools\check.js; default is the Playbook's own).
// Uses FAKE fixture files only; it never reads the real C:\irl-stream files, and prints no value.
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
  labelled: 'fake' + 'Labelled' + 'Secret7',
  streamKey: 'fake' + 'StreamKey' + '0099',
};

function fixtures() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sec10-'));
  for (const d of ['private', 'private-musta', 'public']) fs.mkdirSync(path.join(dir, d));
  // JSON: secret strings load; a plain lowercase user name, an address, a port, a boolean and a short string don't.
  fs.writeFileSync(path.join(dir, 'private', 'keys.json'), JSON.stringify({ a: F.json, b: { c: [F.nested] }, user: 'streamuser', host: '127.0.0.1:4455', port: '1935', on: 'true', short: 'abc', server: 'rtmp://127.0.0.1:1935/live' }));
  fs.writeFileSync(path.join(dir, 'private-musta', 'dashboard-password.txt'), F.txt + '\n\n');
  // Text: an address line, a heading, a "Label: value" line and a URL with the key in its path.
  fs.writeFileSync(path.join(dir, 'private-musta', 'obs-websocket.txt'), `127.0.0.1\n# OBS remote\nPassword: ${F.labelled}\n`);
  fs.writeFileSync(path.join(dir, 'private', 'stream-urls.txt'), `Twitch ingest:\nrtmp://live.example.invalid/app/${F.streamKey}\n`);
  // Notes: prose, capitalised words, a host name, a path and a plain URL load nothing.
  fs.writeFileSync(path.join(dir, 'private-musta', 'SETUP-NOTES.txt'), 'Open Multistream (Musta\'s) at stream.example.invalid then C:\\tools\\obs and http://127.0.0.1:8080/ Dashboard\n');
  fs.writeFileSync(path.join(dir, 'public', 'readme.txt'), 'fake' + 'NotSecret' + '123\n');
  fs.writeFileSync(path.join(dir, '.env'), `KEY_A=${'fake' + 'OtherProject' + 'Value9'}\n`); // outside private*: never loaded
  fs.writeFileSync(path.join(dir, 'private', 'broken.json'), '{ not json');
  return dir;
}

test('loads key-like values from private* folders only, and nothing else', () => {
  const dir = fixtures();
  try {
    const { found, notes } = loadExtraSecrets([{ label: 'irl', dir, dirPattern: /^private/i }]);
    const values = new Set(found.map((f) => f.value));
    for (const v of Object.values(F)) assert.ok(values.has(v), 'a fake value was not loaded');
    assert.strictEqual(found.length, Object.keys(F).length, 'no extra values (user names, addresses, ports, booleans, headings, labels, notes, public folder, .env)');
    for (const f of found) for (const v of Object.values(F)) assert.ok(!f.name.includes(v), 'a name must never hold a value');
    assert.ok(found.some((f) => f.name === 'irl private keys.json: b.c[0]'));
    assert.ok(found.some((f) => f.name === 'irl private-musta obs-websocket.txt: line 3'));
    assert.ok(found.every((f) => f.name.startsWith('irl private')));
    assert.deepStrictEqual(notes, ['irl private broken.json could not be parsed, its values were not checked']);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('a missing folder is skipped quietly', () => {
  const r = loadExtraSecrets([{ label: 'x', dir: path.join(os.tmpdir(), 'no-such-sec10'), dirPattern: /^private/ }]);
  assert.deepStrictEqual(r, { found: [], notes: [] });
});
