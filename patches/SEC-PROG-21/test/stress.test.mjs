// Stress tests: the REAL server.mjs runs as a child process against a fake OBS, fake receivers and a scratch folder
// (test/helpers/fake-world.mjs). Nothing here reaches the main PC, the Linux machine, Twitch or multipass.
// Each test stays under about 20 s. If the fake world can't start (no free ports, say), the tests skip.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { startWorld, sleep, prng, percentile } from "./helpers/fake-world.mjs";

let world = null;
let worldError = null;
let token = null; // the owner's session

before(async () => {
  try {
    world = await startWorld();
    token = (await world.dash.login()).token;
    await world.dash.waitObs(true, 15000, token);
    await world.dash.waitFor(token, (s) => s.feeds.length === 1 && s.ingests[0].online, 10000, "the Phone feed and the RTMP ingest");
  } catch (err) {
    worldError = err;
    if (world) await world.stop().catch(() => {});
    world = null;
  }
});
after(async () => { if (world) await world.stop(); });

const { dash, obs, receivers } = new Proxy({}, { get: (_, k) => world ? world[k] : undefined });
const d = () => world.dash;
const o = () => world.obs;
const r = () => world.receivers;

// Skips when the world could not start, and checks the dashboard process is still alive after each test
async function run(t, fn) {
  if (!world) return t.skip("fake world not available: " + (worldError && worldError.message));
  const logStart = d().stdout.length;
  try {
    await fn(t);
    assert.ok(d().alive, "the dashboard process died: " + d().stderr.join("\n"));
    assert.deepEqual(d().logLines(/\d Error: |Unhandled:/), [], "the server logged a crash or an unhandled error");
  } catch (err) {
    err.message += "\n--- server log during this test:\n" + d().stdout.slice(logStart).join("\n") + (d().stderr.length ? "\n--- stderr:\n" + d().stderr.join("\n") : "");
    throw err;
  }
}

// The fewest OBS requests in flight over half a second: a request that is stuck stays, the dashboard's own 1-2 s polls come and go
async function minPendingObs() {
  let m = Infinity;
  for (let i = 0; i < 5; i++) { m = Math.min(m, (await d().debug(token)).pendingObs); await sleep(100); }
  return m;
}

const scenesCfg = { mode: "always", scenes: { live: "MAIN BOT", low: "MAIN BOT weak", offline: "Intermission" }, lowKbps: 1000, offlineKbps: 150, downDelaySec: 3, upDelaySec: 2 };
const resetWorld = async () => {
  o().setBehavior({});
  r().setBehavior({});
  r().live = { rtmp: true, srtla: false, kbps: 3700 };
  o().media.Phone = "OBS_MEDIA_STATE_PLAYING";
  await d().req("POST", "settings", { session: token, body: { switcher: { mode: "off" }, mainIngest: "auto", feedAutoFix: true, chat: { enabled: false } } });
  if (o().streaming.active) o().setStreaming(false);
  if (!o().clientCount) await d().waitObs(true, 15000, token);
  await d().waitObs(true, 15000, token);
};

// The shape every page poll relies on
function checkStateShape(s) {
  assert.equal(typeof s.now, "number");
  for (const k of ["connected", "error", "scene", "scenes", "streaming", "audio", "items"]) assert.ok(k in s.obs, "obs." + k);
  assert.ok(Array.isArray(s.obs.scenes) && Array.isArray(s.obs.audio) && Array.isArray(s.obs.items));
  assert.ok(Array.isArray(s.ingests) && s.ingests.length === 2 && s.ingests[0].id === "rtmp" && s.ingests[1].id === "srtla");
  assert.ok(["rtmp", "srtla"].includes(s.main));
  assert.ok(Array.isArray(s.history) && s.history.length <= 60 && s.history.every((n) => typeof n === "number"));
  assert.ok(Array.isArray(s.feeds));
  assert.ok(s.ready === null || (typeof s.ready.ok === "boolean" && Array.isArray(s.ready.items) && s.ready.items.length === 6));
  assert.ok(["auto", "rtmp", "srtla"].includes(s.settings.mainIngest));
  assert.ok(["off", "streaming", "always"].includes(s.settings.switcher.mode));
  assert.equal(typeof s.settings.switcher.lowKbps, "number");
  assert.equal(typeof s.settings.feedAutoFix, "boolean");
  assert.equal(typeof s.settings.chat.enabled, "boolean");
  assert.equal(typeof s.switcher.status, "string");
  assert.equal(typeof s.chat.connected, "boolean");
  assert.equal(typeof s.features, "object");
  assert.equal(typeof s.system.startedAt, "number");
  const text = JSON.stringify(s);
  for (const secret of [r().rtmpKey, r().playId, r().login.pass, o().password, d().password]) assert.ok(!text.includes(secret), "a secret leaked into /state: " + secret);
}

// ---------- 1. load ----------
test("load: 50 sessions polling for 10 s stay fast, with no 5xx and a steady memory", { timeout: 40000 }, (t) => run(t, async () => {
  const tokens = [];
  for (let i = 0; i < 50; i++) tokens.push((await d().login()).token);
  assert.ok(tokens.every(Boolean), "every session logged in");
  const before = await d().debug(token);
  const lat = [];
  const statuses = new Map();
  const note = (res) => { lat.push(res.ms); statuses.set(res.status, (statuses.get(res.status) || 0) + 1); };
  const errors = [];
  const end = Date.now() + 10000;
  const workers = tokens.map(async (tk, i) => {
    await sleep((i * 20) % 1000); // spread the sessions over the second, like real phones
    let n = 0;
    while (Date.now() < end) {
      const t0 = Date.now();
      try {
        note(await d().req("GET", "state", { session: tk }));
        if (n % 3 === 0) note(await d().req("GET", "preview", { session: tk, raw: true }));
      } catch (err) { errors.push(err.message); }
      n++;
      await sleep(Math.max(0, 1000 - (Date.now() - t0)));
    }
  });
  await Promise.all(workers);
  const afterDbg = await d().debug(token);
  const p95 = percentile(lat, 95);
  const p50 = percentile(lat, 50);
  const fiveHundreds = [...statuses].filter(([st]) => st >= 500).reduce((a, [, n]) => a + n, 0);
  const heapGrowth = (afterDbg.memory.heapUsed - before.memory.heapUsed) / 1048576;
  const rssGrowth = (afterDbg.memory.rss - before.memory.rss) / 1048576;
  t.diagnostic(`load: ${lat.length} requests, p50 ${p50.toFixed(1)} ms, p95 ${p95.toFixed(1)} ms, max ${Math.max(...lat).toFixed(0)} ms; statuses ${JSON.stringify([...statuses])}; ` +
    `loop lag max ${afterDbg.loopLagMaxMs} ms; heap ${(before.memory.heapUsed / 1048576).toFixed(1)} -> ${(afterDbg.memory.heapUsed / 1048576).toFixed(1)} MB (+${heapGrowth.toFixed(1)}); rss +${rssGrowth.toFixed(1)} MB; fetch errors ${errors.length}`);
  assert.equal(errors.length, 0, "fetch errors: " + errors.slice(0, 3).join("; "));
  assert.ok(lat.length >= 400, "enough requests went through: " + lat.length);
  assert.equal(fiveHundreds, 0, "no 5xx");
  assert.ok(p95 < 200, `p95 latency ${p95} ms`);
  assert.ok(afterDbg.loopLagMaxMs < 250, `event loop stalled ${afterDbg.loopLagMaxMs} ms`);
  assert.ok(heapGrowth < 25, `heap grew ${heapGrowth} MB`);
  assert.equal(afterDbg.unhandled, 0);
}));

// ---------- 2. races ----------
test("race: the same settings save fired 10x at once from two sessions never corrupts settings.json", { timeout: 20000 }, (t) => run(t, async () => {
  const other = (await d().login()).token;
  for (let burst = 0; burst < 5; burst++) {
    const sent = [];
    const reqs = [];
    for (let i = 0; i < 10; i++) {
      const lowKbps = 1000 + burst * 100 + i;
      sent.push(lowKbps);
      reqs.push(d().req("POST", "settings", { session: i % 2 ? other : token, body: { switcher: { ...scenesCfg, mode: "off", lowKbps }, feedAutoFix: i % 2 === 0 } }));
    }
    const out = await Promise.all(reqs);
    assert.ok(out.every((x) => x.status === 200), "all saves answered 200: " + out.map((x) => x.status));
    const disk = d().settingsOnDisk(); // throws if the file is not whole JSON
    assert.ok(sent.includes(disk.switcher.lowKbps), "the file holds one of the saved values");
    const live = await d().state(token);
    assert.equal(live.settings.switcher.lowKbps, disk.switcher.lowKbps, "memory and disk agree");
    assert.equal(live.settings.feedAutoFix, disk.feedAutoFix);
  }
}));

test("race: 10 scene changes at once end with the dashboard, OBS and the last request agreeing", { timeout: 20000 }, (t) => run(t, async () => {
  const other = (await d().login()).token;
  const rnd = prng(7);
  for (let round = 0; round < 4; round++) {
    o().clearLog();
    const picks = Array.from({ length: 10 }, () => rnd.pick(o().scenes));
    const out = await Promise.all(picks.map((scene, i) => d().req("POST", "obs/scene", { session: i % 2 ? other : token, body: { scene } })));
    assert.ok(out.every((x) => x.status === 200), out.map((x) => x.status + " " + JSON.stringify(x.json)).join(", "));
    await sleep(200);
    const got = o().requests.filter((q) => q.type === "SetCurrentProgramScene");
    assert.equal(got.length, 10, "every request reached OBS once");
    const last = got[got.length - 1].data.sceneName;
    assert.equal(o().scene, last);
    assert.equal((await d().state(token)).obs.scene, last, "the dashboard shows what OBS shows");
  }
  const bad = await d().req("POST", "obs/scene", { session: token, body: { scene: "No such" } });
  assert.equal(bad.status, 400);
}));

test("race: 10 Go live taps at once send OBS exactly one StartStream (and 10 End taps one StopStream)", { timeout: 20000 }, (t) => run(t, async () => {
  const other = (await d().login()).token;
  o().clearLog();
  let out = await Promise.all(Array.from({ length: 10 }, (_, i) => d().req("POST", "obs/stream", { session: i % 2 ? other : token, body: { action: "start" } })));
  assert.deepEqual(out.map((x) => x.status), Array(10).fill(200), JSON.stringify(out.map((x) => x.json)));
  assert.equal(o().count("StartStream"), 1, "one StartStream");
  assert.equal(o().streaming.active, true);
  assert.equal((await d().state(token)).obs.streaming, true);
  // A start while already live asks OBS nothing (OBS would refuse it) and still says ok
  out = await d().req("POST", "obs/stream", { session: token, body: { action: "start" } });
  assert.equal(out.status, 200);
  assert.equal(out.json.already, true);
  assert.equal(o().count("StartStream"), 1);
  o().clearLog();
  out = await Promise.all(Array.from({ length: 10 }, (_, i) => d().req("POST", "obs/stream", { session: i % 2 ? other : token, body: { action: "stop" } })));
  assert.deepEqual(out.map((x) => x.status), Array(10).fill(200));
  assert.equal(o().count("StopStream"), 1, "one StopStream");
  assert.equal((await d().state(token)).obs.streaming, false);
  // Start and stop interleaved at random from two sessions: only 200 (done / already) or 409 (the other is in flight), never 5xx,
  // and OBS is never asked to start while it is already live or to stop while it is not
  const rnd = prng(11);
  o().clearLog();
  const mixed = await Promise.all(Array.from({ length: 20 }, (_, i) => d().req("POST", "obs/stream", { session: i % 2 ? other : token, body: { action: rnd.pick(["start", "stop"]) } })));
  for (const x of mixed) assert.ok([200, 409].includes(x.status), x.status + " " + JSON.stringify(x.json));
  const refused = o().requests.filter((q) => (q.type === "StartStream" || q.type === "StopStream"));
  let active = false;
  for (const q of refused) { if (q.type === "StartStream") { assert.equal(active, false, "StartStream while live"); active = true; } else { assert.equal(active, true, "StopStream while not live"); active = false; } }
  if (o().streaming.active) await d().req("POST", "obs/stream", { session: token, body: { action: "stop" } });
  assert.equal((await d().req("POST", "obs/stream", { session: token, body: { action: "pause" } })).status, 400);
}));

test("race: 10 Fix feed taps at once restart the phone feed once", { timeout: 20000 }, (t) => run(t, async () => {
  const other = (await d().login()).token;
  o().clearLog();
  const out = await Promise.all(Array.from({ length: 10 }, (_, i) => d().req("POST", "feed/fix", { session: i % 2 ? other : token, body: { name: "Phone" } })));
  assert.deepEqual(out.map((x) => x.status), Array(10).fill(200));
  assert.equal(o().count("TriggerMediaInputAction"), 1, "one restart reached OBS");
  o().clearLog();
  const ff = await Promise.all(Array.from({ length: 10 }, () => d().req("POST", "feed/forcefix", { session: token, body: { name: "Phone" } })));
  assert.deepEqual(ff.map((x) => x.status), Array(10).fill(200));
  assert.equal(o().count("SetInputSettings"), 1, "one rebuild reached OBS");
  assert.equal((await d().req("POST", "feed/fix", { session: token, body: { name: "Nope" } })).status, 400);
  o().media.Phone = "OBS_MEDIA_STATE_PLAYING";
}));

test("race: a password change tapped 10x at once works once and never locks the owner out", { timeout: 20000 }, (t) => run(t, async () => {
  const me = (await d().login()).token;
  const other = (await d().login()).token;
  const next = "a brand new long password 42";
  const out = await Promise.all(Array.from({ length: 10 }, () => d().req("POST", "account/password", { session: me, body: { current: d().password, next } })));
  assert.deepEqual(out.map((x) => x.status), Array(10).fill(200), JSON.stringify(out.map((x) => x.json)));
  assert.equal((await d().req("GET", "state", { session: other })).status, 401, "other devices are signed out");
  assert.equal((await d().req("GET", "state", { session: me })).status, 200, "this device stays signed in");
  assert.equal((await d().login(d().password)).status, 401, "the old password is gone");
  const back = await d().req("POST", "account/password", { session: me, body: { current: next, next: d().password } });
  assert.equal(back.status, 200, "changing it back works at once (no lockout): " + JSON.stringify(back.json));
  token = (await d().login()).token;
  assert.ok(token, "the original password works again");
  await d().waitObs(true, 15000, token);
}));

// ---------- 3. faults ----------
test("fault: OBS that answers after 6 s gives a plain 'did not answer in time', and all recovers", { timeout: 25000 }, (t) => run(t, async () => {
  o().setBehavior({ delayMs: 6000 });
  const t0 = Date.now();
  const res = await d().req("POST", "obs/scene", { session: token, body: { scene: "GAME" } });
  assert.equal(res.status, 502);
  assert.match(res.json.error, /did not answer in time/);
  assert.ok(Date.now() - t0 < 5800, "gave up after the 5 s limit");
  o().setBehavior({});
  await sleep(6500); // the late answers arrive and must be ignored
  const dbg = await d().debug(token);
  assert.equal(dbg.unhandled, 0);
  assert.equal(await minPendingObs(), 0, "no request left hanging");
  const ok = await d().req("POST", "obs/scene", { session: token, body: { scene: "MAIN BOT" } });
  assert.equal(ok.status, 200);
  assert.equal((await d().state(token)).obs.connected, true);
}));

test("fault: OBS drops the link mid-request; the dashboard says so plainly, reconnects, and the switcher restarts its count", { timeout: 25000 }, (t) => run(t, async () => {
  await resetWorld();
  // The switcher is on and counting down to Offline when OBS drops; after the reconnect it must count again from zero
  o().setScene("MAIN BOT");
  await d().req("POST", "settings", { session: token, body: { switcher: scenesCfg } });
  await d().waitFor(token, (s) => s.obs.scene === "MAIN BOT" && /watching: signal good/.test(s.switcher.status), 8000, "the switcher watching");
  r().live.rtmp = false; // the phone stops
  await d().waitFor(token, (s) => /switching soon/.test(s.switcher.status), 5000, "the countdown");
  o().clearLog();
  o().setBehavior({ dropOn: "GetStreamStatus" }); // the next poll kills the link
  const dropped = await d().waitObs(false, 8000, token);
  const droppedAt = Date.now();
  assert.match(dropped.obs.error, /dropped|not answering/);
  assert.equal(dropped.obs.streaming, null, "stream state unknown while disconnected");
  assert.deepEqual(dropped.obs.scenes, []);
  assert.equal(dropped.switcher.status, "waiting for OBS");
  o().setBehavior({});
  await d().waitObs(true, 15000, token);
  const reconnectedAt = Date.now();
  // No switch may happen on the old countdown: the full down delay (3 s) must pass again after the reconnect
  const sw = await d().waitFor(token, (s) => s.obs.scene === "Intermission", 10000, "the switch to Intermission");
  const switchReq = o().requests.find((q) => q.type === "SetCurrentProgramScene");
  assert.ok(switchReq, "the switch reached OBS");
  assert.ok(switchReq.at - reconnectedAt >= 2500, `switched only ${switchReq.at - reconnectedAt} ms after reconnecting (stale countdown)`);
  assert.ok(switchReq.at > droppedAt);
  assert.equal(sw.switcher.lastAutoSwitch.scene, "Intermission");
  assert.equal((await d().debug(token)).unhandled, 0);
  await resetWorld();
}));

test("fault: a refused password, garbage frames and reordered answers never crash the link", { timeout: 25000 }, (t) => run(t, async () => {
  o().setBehavior({ refusePassword: true });
  o().disconnectAll();
  const refused = await d().waitFor(token, (s) => !s.obs.connected && /refused the password/.test(s.obs.error || ""), 10000, "the refused-password message");
  assert.equal(refused.obs.error, "OBS refused the password");
  o().setBehavior({ garbage: true, reorder: true });
  await d().waitObs(true, 15000, token);
  // Requests keep working through the junk, in the right order of answers
  const out = await Promise.all(["GAME", "MAIN BOT", "Intermission", "GAME", "MAIN BOT weak"].map((scene) => d().req("POST", "obs/scene", { session: token, body: { scene } })));
  assert.deepEqual(out.map((x) => x.status), [200, 200, 200, 200, 200], JSON.stringify(out.map((x) => x.json)));
  const pv = await d().req("GET", "preview", { session: token, raw: true });
  assert.equal(pv.status, 200);
  await sleep(1500);
  const dbg = await d().debug(token);
  assert.equal(dbg.unhandled, 0, "garbage caused unhandled errors: " + d().logLines(/Unhandled/).join(" | "));
  assert.equal(await minPendingObs(), 0, "a request was left hanging");
  o().setBehavior({});
  assert.equal((await d().state(token)).obs.connected, true);
  assert.equal((await d().state(token)).obs.scene, o().scene);
  o().setScene("GAME");
}));

test("fault: OBS answers Hello but never identifies, then comes back", { timeout: 25000 }, (t) => run(t, async () => {
  o().setBehavior({ neverIdentify: true });
  o().disconnectAll();
  const s = await d().waitFor(token, (st) => !st.obs.connected && /not answering/.test(st.obs.error || ""), 15000, "the not-answering message");
  assert.match(s.obs.error, /is it open, with the WebSocket server on/);
  o().setBehavior({});
  await d().waitObs(true, 15000, token);
}));

test("fault: the receivers return 500, 401 or hang; the signal shows plain errors and comes back", { timeout: 25000 }, (t) => run(t, async () => {
  r().setBehavior({ apiStatus: 500, slsStatus: 500 });
  let s = await d().waitFor(token, (st) => st.ingests[0].error && st.ingests[1].error, 5000, "receiver errors");
  assert.equal(s.ingests[0].error, "the RTMP receiver is not answering");
  assert.equal(s.ingests[1].error, "the SRTLA receiver is not answering");
  assert.equal(s.ingests[0].online, false);
  assert.equal(s.ready.items.find((i) => i.key === "receivers").ok, false);
  r().setBehavior({ apiStatus: 401 });
  s = await d().waitFor(token, (st) => /login/.test(st.ingests[0].error || ""), 5000, "the login error");
  assert.equal(s.ingests[0].error, "the RTMP receiver refused the dashboard's login (check mediamtx.json in the private folder)");
  r().setBehavior({ apiHang: true, slsHang: true });
  await sleep(2500);
  s = await d().state(token);
  assert.equal(s.ingests[0].error, "the RTMP receiver is not answering");
  r().setBehavior({});
  s = await d().waitFor(token, (st) => st.ingests[0].online && !st.ingests[0].error && !st.ingests[1].error, 6000, "recovery");
  assert.ok(s.ingests[0].kbps > 0 || s.history.length > 0);
  // The SRTLA phone comes on: it becomes the main ingest in auto mode, with its round-trip time
  r().live.srtla = true;
  s = await d().waitFor(token, (st) => st.ingests[1].online, 5000, "SRTLA online");
  assert.equal(s.main, "srtla");
  assert.equal(s.ingests[1].rtt, 42);
  assert.equal(s.ingests[1].links, 2);
  r().live.srtla = false;
  await d().waitFor(token, (st) => !st.ingests[1].online, 5000, "SRTLA offline");
}));

test("fault: the feed watchdog restarts a dead feed after 4 s and never more than once per 10 s", { timeout: 30000 }, (t) => run(t, async () => {
  await resetWorld();
  o().clearLog();
  o().setBehavior({ stickyMedia: "OBS_MEDIA_STATE_ENDED" }); // a restart never helps: the feed stays dead
  o().media.Phone = "OBS_MEDIA_STATE_ENDED";
  const t0 = Date.now();
  const end = t0 + 18000;
  while (o().count("TriggerMediaInputAction") < 2 && Date.now() < end) await sleep(100);
  const restarts = o().requests.filter((q) => q.type === "TriggerMediaInputAction");
  assert.ok(restarts.length >= 2, `only ${restarts.length} restart(s) in 18 s`);
  assert.ok(restarts[0].at - t0 >= 3500, `first restart came after ${restarts[0].at - t0} ms (should wait about 4 s)`);
  assert.ok(restarts[1].at - restarts[0].at >= 9500, `restarts only ${restarts[1].at - restarts[0].at} ms apart`);
  const s = await d().state(token);
  assert.equal(s.feeds[0].state, "no picture (ended)");
  assert.match(s.feeds[0].lastFix.why, /stopped playing while the server was receiving/);
  // Off: no more restarts
  await d().req("POST", "settings", { session: token, body: { feedAutoFix: false } });
  const n = o().count("TriggerMediaInputAction");
  await sleep(1500);
  assert.equal(o().count("TriggerMediaInputAction"), n);
  await resetWorld();
}));

test("fault: a settings file that can't be written gives a plain answer, and the dashboard keeps running", { timeout: 20000 }, (t) => run(t, async () => {
  const file = path.join(d().dataDir, "settings.json");
  fs.rmSync(file, { force: true });
  fs.mkdirSync(file); // a folder where the file should be: every write fails
  try {
    const r1 = await d().req("POST", "settings", { session: token, body: { feedAutoFix: false } });
    assert.equal(r1.status, 502);
    assert.match(r1.json.error, /could not be saved to the settings file/);
    assert.ok(!r1.json.error.includes(":\\"), "no file path in the message: " + r1.json.error);
    assert.equal((await d().state(token)).settings.feedAutoFix, false, "the setting is in use anyway");
  } finally {
    fs.rmSync(file, { recursive: true, force: true });
  }
  const r2 = await d().req("POST", "settings", { session: token, body: { feedAutoFix: true } });
  assert.equal(r2.status, 200);
  assert.equal(d().settingsOnDisk().feedAutoFix, true);
}));

// ---------- 4. auth ----------
const viaCf = (ip, https = true) => ({ "cf-connecting-ip": ip, ...(https ? { "cf-visitor": '{"scheme":"https"}' } : {}) }); // SEC-PROG-21: cf-visitor, never x-forwarded-proto

test("auth: wrong passwords are limited per address, and other addresses never lock the owner out", { timeout: 20000 }, (t) => run(t, async () => {
  for (let i = 0; i < 5; i++) assert.equal((await d().login("nope", viaCf("198.51.100.1"))).status, 401);
  assert.equal((await d().login(d().password, viaCf("198.51.100.1"))).status, 429, "the 6th try is refused even with the right password");
  assert.match((await d().login(d().password, viaCf("198.51.100.1"))).json.error, /Wait 15 minutes/);
  // 30 addresses each guess wrong (and 5 more in one IPv6 /64); the owner on yet another address still gets in
  const tries = [];
  for (let i = 0; i < 30; i++) tries.push(d().login("guess" + i, viaCf("203.0.113." + (i + 1))));
  for (let i = 0; i < 5; i++) tries.push(d().login("guess", viaCf("2001:db8:7:7::" + (i + 1))));
  const out = await Promise.all(tries);
  assert.ok(out.every((x) => x.status === 401), out.map((x) => x.status).join(","));
  assert.equal((await d().login(d().password, viaCf("2001:db8:7:7:dead::1"))).status, 429, "the whole /64 shares one limit");
  const me = await d().login(d().password, viaCf("198.51.100.77"));
  assert.equal(me.status, 200);
  assert.ok(me.token);
}));

test("auth: the cookie is scoped to /api/stream, Secure through Cloudflare, and plain http from the internet is refused", { timeout: 20000 }, (t) => run(t, async () => {
  const local = await d().login();
  assert.ok(local.setCookie[0].startsWith("irls="));
  assert.match(local.setCookie[0], /; Path=\/api\/stream; HttpOnly; SameSite=Strict; Max-Age=2592000$/);
  assert.ok(local.setCookie.some((c) => /^irls=; Path=\/;.*Max-Age=0/.test(c)), "the old site-wide cookie is cleared");
  const remote = await d().login(d().password, viaCf("198.51.100.5"));
  assert.match(remote.setCookie[0], /; Secure$/);
  const page = await d().req("GET", "/stream", { headers: viaCf("198.51.100.5", false), raw: true });
  assert.equal(page.status, 301);
  assert.equal(page.headers.get("location"), `https://127.0.0.1:${d().port}/stream`);
  const post = await d().req("POST", "login", { headers: viaCf("198.51.100.5", false), body: { password: d().password } });
  assert.equal(post.status, 403);
  const get = await d().req("GET", "state", { headers: viaCf("198.51.100.5", false), session: local.token });
  assert.equal(get.status, 403);
  // cf-visitor also counts as https
  const vis = await d().req("GET", "state", { headers: { "cf-connecting-ip": "198.51.100.5", "cf-visitor": '{"scheme":"https"}' }, session: local.token });
  assert.equal(vis.status, 200);
  // the page itself: no secrets, a nonce CSP, no game menu (none here)
  const html = await d().req("GET", "/stream", { raw: true });
  assert.equal(html.status, 200);
  assert.match(html.headers.get("content-security-policy"), /script-src 'nonce-/);
  assert.ok(!html.buf.toString().includes(r().rtmpKey));
  const overlay = await d().req("GET", "overlay", { raw: true });
  assert.equal(overlay.status, 200);
}));

test("auth: a POST must come from the dashboard page (JSON, same origin)", { timeout: 20000 }, (t) => run(t, async () => {
  const text = await d().req("POST", "settings", { session: token, body: "{}", headers: { "content-type": "text/plain" } });
  assert.equal(text.status, 403);
  const form = await d().req("POST", "login", { body: "password=x", headers: { "content-type": "application/x-www-form-urlencoded" } });
  assert.equal(form.status, 403);
  const evil = await d().req("POST", "settings", { session: token, body: {}, headers: { origin: "https://evil.example" } });
  assert.equal(evil.status, 403);
  const same = await d().req("POST", "settings", { session: token, body: {}, headers: { origin: `http://127.0.0.1:${d().port}` } });
  assert.equal(same.status, 200);
  const noOrigin = await d().req("POST", "settings", { session: token, body: {} });
  assert.equal(noOrigin.status, 200);
}));

test("auth: oversized, slow-to-parse and malformed bodies get a plain 4xx answer, not a cut connection", { timeout: 20000 }, (t) => run(t, async () => {
  const big = JSON.stringify({ switcher: { scenes: { live: "x".repeat(20 * 1024) } } });
  const r1 = await d().req("POST", "settings", { session: token, body: big });
  assert.equal(r1.status, 413);
  assert.match(r1.json.error, /too big/);
  // the same without a Content-Length (chunked): still 413, still an answer
  const res = await fetch(d().base + "/api/stream/settings", { method: "POST", headers: { cookie: `irls=${token}`, "content-type": "application/json" }, duplex: "half",
    body: new ReadableStream({ start(c) { for (let i = 0; i < 5; i++) c.enqueue(new TextEncoder().encode("x".repeat(5000))); c.close(); } }), signal: AbortSignal.timeout(5000) });
  assert.equal(res.status, 413);
  await res.arrayBuffer();
  const r2 = await d().req("POST", "settings", { session: token, body: "{not json" });
  assert.equal(r2.status, 400);
  assert.match(r2.json.error, /JSON/);
  const r3 = await d().req("POST", "login", { body: "null" });
  assert.equal(r3.status, 400);
  const r4 = await d().req("POST", "settings", { session: token, body: "123" }); // a number is JSON, but not a settings object
  assert.equal(r4.status, 400);
  assert.match(r4.json.error, /JSON object/);
  const r5 = await d().req("POST", "obs/scene", { session: token, body: '"GAME"' });
  assert.equal(r5.status, 400);
  for (const b of ["false", "[]", "[1]", '""', "0"]) assert.equal((await d().req("POST", "obs/scene", { session: token, body: b, timeout: 3000 })).status, 400, "body " + b);
  const r6 = await d().req("POST", "login", { body: { password: { $ne: 1 } } });
  assert.equal(r6.status, 401);
  // a login body of 16 KB exactly is fine (the limit is 16 KB)
  const edge = await d().req("POST", "login", { body: JSON.stringify({ password: "p".repeat(16 * 1024 - 20) }) });
  assert.equal(edge.status, 401);
  // the server is still fine afterwards
  assert.equal((await d().req("GET", "state", { session: token })).status, 200);
}));

test("auth: path tricks on feature routes and dot-dot never reach anything, and never 5xx", { timeout: 20000 }, (t) => run(t, async () => {
  const paths = ["/api/stream/x/../state", "/api/stream/x/%2e%2e/state", "/api/stream/pub/../../stream", "/api/stream//state", "/api/stream/state/",
    "/api/stream/x/vmcontrol/restart", "/api/stream/x/wake/pc", "/api/stream/pub/sharing/watch/x", "/api/stream/x/", "/api/stream/x", "/api/stream/pub/",
    "/api/stream/x/UPPER/case", "/api/stream/x/a%00b/c", "/api/stream/ws/obsremote/key", "/api/stream/%", "/stream/../api/stream/state", "/api/stream/connect/..",
    "/api/stream/x/multistream/status?a=../..", "/api/stream/debug/../state", "/api/stream/x/nofeature/" + "a".repeat(3000)];
  for (const p of paths) {
    // The browser (and the server) fold ".." before routing, so a trick path is simply whatever it folds to
    const folded = new URL(p, "http://x").pathname;
    const legit = ["/api/stream/state", "/api/stream/debug", "/stream"].includes(folded);
    const g = await d().req("GET", p, { session: token, raw: true });
    assert.equal(g.status, legit ? 200 : 404, `GET ${p} (${folded}) -> ${g.status}`);
    const po = await d().req("POST", p, { session: token, body: {} });
    assert.ok(po.status === 404 || po.status === 400, `POST ${p} -> ${po.status}`);
  }
  // without a login, feature routes are 401 (never a hint whether the feature exists)
  assert.equal((await d().req("GET", "x/vmcontrol/status")).status, 401);
  assert.equal((await d().req("POST", "x/vmcontrol/restart", { body: {} })).status, 401);
  assert.equal((await d().req("GET", "connect")).status, 401);
  assert.equal((await d().req("GET", "debug")).status, 401);
  // odd methods
  for (const m of ["PUT", "DELETE", "PATCH", "OPTIONS", "HEAD"]) {
    const x = await d().req(m, "state", { session: token, raw: true });
    assert.ok(x.status < 500, m + " " + x.status);
  }
}));

test("auth: logout, sign out other devices, and a stale token", { timeout: 20000 }, (t) => run(t, async () => {
  const a = (await d().login()).token;
  const b = (await d().login()).token;
  const c = (await d().login()).token;
  const n = await d().req("POST", "account/logout-others", { session: b, body: {} });
  assert.equal(n.status, 200);
  assert.ok(n.json.signedOut >= 2);
  assert.equal((await d().req("GET", "state", { session: a })).status, 401);
  assert.equal((await d().req("GET", "state", { session: c })).status, 401);
  assert.equal((await d().req("GET", "state", { session: b })).status, 200);
  const out = await d().req("POST", "logout", { session: b, body: {} });
  assert.equal(out.status, 200);
  assert.match(out.headers.getSetCookie().join("\n"), /irls=; Path=\/api\/stream;.*Max-Age=0/);
  assert.equal((await d().req("GET", "state", { session: b })).status, 401);
  // two cookies (an old site-wide one and the real one): the live one is used
  token = (await d().login()).token;
  const two = await d().req("GET", "state", { headers: { cookie: `irls=stale-old-cookie; irls=${token}` } });
  assert.equal(two.status, 200);
  const twoB = await d().req("GET", "state", { headers: { cookie: `irls=${token}; irls=stale-old-cookie` } });
  assert.equal(twoB.status, 200);
  const broken = await d().req("GET", "state", { headers: { cookie: "irls=%E0%A4%A; other=%; irls=" + token } });
  assert.equal(broken.status, 200, "a stray % in a cookie never breaks the dashboard");
  await d().waitObs(true, 15000, token);
}));

// ---------- 5. random-order fuzz ----------
test("fuzz: 500 random valid and invalid requests across every core route give only 2xx/4xx, and /state keeps its shape", { timeout: 30000 }, (t) => run(t, async () => {
  await resetWorld();
  const seed = Number(process.env.STRESS_SEED) || 20261018;
  const rnd = prng(seed);
  t.diagnostic("fuzz seed " + seed + " (STRESS_SEED=... to repeat)");
  const ips = Array.from({ length: 20 }, (_, i) => "192.0.2." + (i + 1));
  let session = token;
  const other = (await d().login()).token;
  const junk = () => rnd.pick([null, true, 0, -1, 1e308, "", "x", "GAME", "Phone", "Mic/Aux", "Alerts", [], {}, [1, 2], { a: { b: { c: 1 } } }, "x".repeat(300), "\u0000", "💥", 42.5, "start", "stop"]);
  const body = (shape) => {
    const b = {};
    for (const [k, v] of Object.entries(shape)) if (rnd.chance(0.8)) b[k] = rnd.chance(0.7) ? v() : junk();
    return rnd.chance(0.05) ? junk() : b;
  };
  const scene = () => rnd.pick([...o().scenes, "Nope", ""]);
  const routes = [
    ["GET", "state"], ["GET", "state"], ["GET", "state"], ["GET", "connect"], ["GET", "preview"], ["GET", "preview?source=feed"], ["GET", "debug"], ["GET", "overlay"], ["GET", "/stream"],
    ["GET", "nope"], ["GET", "x/vmcontrol/status"], ["GET", "pub/sharing/watch"], ["POST", "x/wake/now"], ["POST", "pub/x/y"],
    ["POST", "login", () => ({ password: rnd.chance(0.3) ? d().password : junk() })],
    ["POST", "settings", () => body({ switcher: () => ({ ...scenesCfg, mode: rnd.pick(["off", "streaming", "always", "x"]), lowKbps: junk(), scenes: rnd.chance(0.5) ? scenesCfg.scenes : junk() }), mainIngest: () => rnd.pick(["auto", "rtmp", "srtla", "x"]), feedAutoFix: () => rnd.chance(0.5), chat: () => ({ enabled: rnd.chance(0.5), channel: rnd.pick(["", "cade", "https://twitch.tv/x", "!!"]), levels: { start: rnd.pick(["mod", "x"]) } }) })],
    ["POST", "obs/scene", () => body({ scene })],
    ["POST", "obs/stream", () => body({ action: () => rnd.pick(["start", "stop", "x"]) })],
    ["POST", "obs/record", () => body({ action: () => rnd.pick(["start", "stop", "x"]) })],
    ["POST", "obs/mute", () => body({ input: () => rnd.pick(["Mic/Aux", "Desktop Audio", "Phone", "x"]), muted: () => rnd.chance(0.5) })],
    ["POST", "obs/item", () => body({ id: () => rnd.pick([1, 2, 3, 99, "1"]), scene, name: () => rnd.pick(["Phone", "Alerts", "x"]), enabled: () => rnd.chance(0.5) })],
    ["POST", "obs/refresh", () => body({ name: () => rnd.pick(["Alerts", "Phone", "x"]) })],
    ["POST", "feed/fix", () => body({ name: () => rnd.pick(["Phone", "BRB clip", "x"]) })],
    ["POST", "feed/forcefix", () => body({ name: () => rnd.pick(["Phone", "x"]) })],
    ["POST", "feed/mute", () => body({ name: () => rnd.pick(["Phone", "x"]), muted: () => rnd.chance(0.5) })],
    ["POST", "account/password", () => body({ current: () => rnd.pick(["wrong", ""]), next: () => rnd.pick(["short", "a long enough new password"]) })],
    ["POST", "state"], ["POST", "connect", () => junk()], ["POST", "logout"],
  ];
  const seen = new Map();
  const bad = [];
  let relogins = 0;
  for (let i = 0; i < 500; i++) {
    const [method, route, mk] = rnd.pick(routes);
    // wrong guesses always come from a pooled remote address, so the fuzz never locks out its own (local) address
    const headers = route === "login" || route === "account/password" || rnd.chance(0.5) ? viaCf(rnd.pick(ips)) : {};
    if (rnd.chance(0.03)) headers["content-type"] = "text/plain";
    if (rnd.chance(0.03)) headers.origin = "https://evil.example";
    const useSession = rnd.chance(0.9) ? (rnd.chance(0.8) ? session : other) : rnd.chance(0.5) ? "garbage-token" : undefined;
    const raw = route.startsWith("preview") || route === "overlay" || route === "/stream";
    let payload;
    if (method === "POST") payload = mk ? (rnd.chance(0.05) ? "{bad json" : JSON.stringify(mk())) : rnd.chance(0.5) ? "{}" : undefined;
    let res;
    try { res = await d().req(method, route, { session: useSession, headers, body: payload, raw }); }
    catch (err) { bad.push(`${method} ${route}: ${err.message}`); continue; }
    const key = `${method} ${route.split("?")[0]} ${res.status}`;
    seen.set(key, (seen.get(key) || 0) + 1);
    if (res.status >= 500) bad.push(`${method} ${route} -> ${res.status} ${res.text || ""} (body ${payload})`);
    if (!raw && res.status !== 200 && res.json && typeof res.json.error !== "string") bad.push(`${method} ${route} -> ${res.status} without a plain error message`);
    if ((res.status === 401 || route === "logout") && useSession === session) { session = (await d().login()).token || session; relogins++; }
    if (i % 50 === 49) {
      let s = await d().state(session);
      if (!s || s.error) { session = (await d().login()).token; relogins++; assert.ok(session, "re-login failed"); s = await d().state(session); }
      checkStateShape(s);
    }
  }
  const dbg = await d().debug(session);
  t.diagnostic(`fuzz: ${[...seen].filter(([k]) => / 5\d\d$/.test(k)).length} five-hundreds; ${relogins} re-logins; unhandled ${dbg.unhandled}; pending OBS ${dbg.pendingObs}; outcomes: ${[...seen].sort().map(([k, n]) => k + "x" + n).join(", ")}`);
  assert.deepEqual(bad, []);
  assert.equal(dbg.unhandled, 0);
  checkStateShape(await d().state(session));
  assert.doesNotThrow(() => d().settingsOnDisk());
  token = session;
  await resetWorld();
}));
