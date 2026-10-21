"use strict";
// SEC-PROG-47 (Security · Programs, 2026-10-21): the recording route makes the m4a only under the memory guard, and one meeting is
// never built twice at the same time. Uses this PC's ffmpeg on tiny generated pieces (no voice, no model), like listen-11.test.js.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs"), os = require("os"), path = require("path"), http = require("http");
const { execFileSync } = require("child_process");

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "sec47-"));
process.env.LISTEN_DATA = tmp();
const store = require("../listen/store");
const recording = require("../listen/recording");
const { addKey } = require("../listen/keys");
const { handler, createWorker } = require("../listen/server");

const ADMIN = "admin@example.com";
function piece(dir, ms) {
  fs.mkdirSync(dir, { recursive: true });
  execFileSync("ffmpeg", ["-loglevel", "error", "-y", "-f", "lavfi", "-i", "sine=f=440:r=16000", "-t", "1", "-c:a", "libopus", "-f", "webm", path.join(dir, `${ms}000.audio`)]);
}
async function serve(d, guardOk) {
  const keysFile = path.join(d, "keys.json");
  const k = addKey(keysFile, "Phone");
  const worker = createWorker({ dataDir: d, whisper: { transcribe: async () => "x" }, guard: { ok: guardOk }, sort: async () => [], settings: {}, log: () => {} });
  const srv = http.createServer(handler({ dataDir: d, keysFile, settings: { adminLogin: ADMIN }, worker, log: () => {} }));
  await new Promise((r) => srv.listen(0, "127.0.0.1", r));
  const base = `http://127.0.0.1:${srv.address().port}`;
  const get = (p) => fetch(base + p, { headers: { "tailscale-user-login": ADMIN, "x-listen-key": k } });
  return { srv, get };
}

test("SEC-PROG-47: two builds of one meeting at the same time share one ffmpeg run", async () => {
  const d = tmp();
  const m = store.createMeeting(d);
  const dir = path.join(d, m.id, "audio");
  piece(dir, 1000); piece(dir, 2000);
  const a = recording.buildRecording(d, m.id);
  const b = recording.buildRecording(d, m.id);
  assert.equal(a, b, "the second call waits for the first build");
  const [fa, fb] = await Promise.all([a, b]);
  assert.equal(fa, fb);
  assert.ok(fs.statSync(fa).size > 0);
  assert.ok(!fs.existsSync(path.join(dir, "recording.part.m4a")), "no half-made file is left");
});

test("SEC-PROG-47: the route makes the recording only when the memory guard allows (503 otherwise); a ready file is sent anyway", async () => {
  const d = tmp();
  const m = store.createMeeting(d);
  store.updateMeeting(d, m.id, { state: "stopped" });
  piece(path.join(d, m.id, "audio"), 1000);
  let room = false;
  const { srv, get } = await serve(d, () => room);
  try {
    assert.equal((await get(`/listen/api/meetings/${m.id}/recording`)).status, 503, "low memory: no ffmpeg");
    assert.ok(!fs.existsSync(path.join(d, m.id, "audio", "recording.m4a")));
    room = true;
    const ok = await get(`/listen/api/meetings/${m.id}/recording`);
    assert.equal(ok.status, 200);
    await ok.arrayBuffer();
    room = false;
    assert.equal((await get(`/listen/api/meetings/${m.id}/recording`)).status, 200, "already made: sent even while memory is low");
  } finally { srv.close(); }
});
