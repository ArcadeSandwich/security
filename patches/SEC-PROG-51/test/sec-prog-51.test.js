"use strict";
// SEC-PROG-51 (Security · Programs, 2026-10-21): the main PC's answer is data. A redirect, an answer over 2 MB or one that isn't
// JSON is refused, and the tower reads that piece itself; text is clipped. Stand-in servers on this PC only.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs"), os = require("os"), path = require("path"), http = require("http");
const { execFileSync } = require("child_process");
const { createWhisper } = require("../listen/whisper");

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sec51-"));
const audio = path.join(dir, "1000000.audio");
execFileSync("ffmpeg", ["-loglevel", "error", "-y", "-f", "lavfi", "-i", "sine=f=440:r=16000", "-t", "1", "-c:a", "libopus", "-f", "webm", audio]);

function stand(answer) {
  return new Promise((resolve) => {
    let elsewhere = 0;
    const srv = http.createServer((req, res) => {
      if (req.url === "/elsewhere/inference") { elsewhere++; req.resume(); res.writeHead(200, { "content-type": "application/json" }); return res.end('{"text":"went elsewhere"}'); }
      if (req.url === "/inference") { req.resume(); return answer(res, srv); }
      res.writeHead(200); res.end("ok");
    });
    srv.listen(0, "127.0.0.1", () => resolve({ srv, url: `http://127.0.0.1:${srv.address().port}`, elsewhere: () => elsewhere }));
  });
}
const tower = () => { const s = { starts: 0 }; s.start = async () => { s.starts++; return false; }; return s; };

test("SEC-PROG-51: a redirect from the main PC is never followed; the tower reads the piece", async () => {
  const r = await stand((res, srv) => { res.writeHead(307, { location: `http://127.0.0.1:${srv.address().port}/elsewhere/inference` }); res.end(); });
  const t = tower();
  try {
    const w = createWhisper({ remote: r.url, remotePattern: /./, startLocal: t.start });
    await assert.rejects(w.transcribe(audio, "", { readings: 1 }), /not available/);
    assert.equal(r.elsewhere(), 0, "the wav was not sent on");
    assert.equal(t.starts, 1, "the tower took the piece");
  } finally { r.srv.close(); }
});

test("SEC-PROG-51: an answer over 2 MB, or not JSON, is refused; the tower reads the piece", async () => {
  for (const body of ['{"text":"' + "x".repeat(3 * 1024 * 1024) + '"}', "<html>not json</html>"]) {
    const r = await stand((res) => { res.writeHead(200, { "content-type": "application/json" }); res.end(body); });
    const t = tower();
    try {
      const w = createWhisper({ remote: r.url, remotePattern: /./, startLocal: t.start });
      await assert.rejects(w.transcribe(audio, "", { readings: 1 }), /not available/);
      assert.equal(t.starts, 1);
    } finally { r.srv.close(); }
  }
});

test("SEC-PROG-51: a long text is clipped to 4000 characters, and a non-text field gives no text", async () => {
  const long = await stand((res) => { res.writeHead(200, { "content-type": "application/json" }); res.end(JSON.stringify({ text: "y".repeat(10000), language: "en" })); });
  try {
    const got = await createWhisper({ remote: long.url, remotePattern: /./, startLocal: async () => false }).transcribe(audio, "", { readings: 1 });
    assert.equal(got.text.length, 4000);
  } finally { long.srv.close(); }
  const odd = await stand((res) => { res.writeHead(200, { "content-type": "application/json" }); res.end(JSON.stringify({ text: { evil: 1 }, language: "en" })); });
  try {
    const got = await createWhisper({ remote: odd.url, remotePattern: /./, startLocal: async () => false }).transcribe(audio, "", { readings: 1 });
    assert.equal(got.text, "");
  } finally { odd.srv.close(); }
});
