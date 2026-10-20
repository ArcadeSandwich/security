import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Duplex } from "node:stream";
import vm from "node:vm";
import { findRoute } from "../features/runtime.mjs";
import setup, {
  newKey, keyMatches, cleanRest, obsRemoteAddress, clientIp, isSecure, isWebSocketUpgrade, buildUpstreamRequest,
  makeRateLimiter, decideAccess, probeObsAuth, refuse, MAX_CONNECTIONS, FAIL_LIMIT, FAIL_WINDOW_MS, KEY_FILE,
} from "../features/obsremote.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const tick = () => new Promise((r) => setImmediate(r));

// ---------- fakes ----------
class FakeSocket extends Duplex {
  constructor() { super(); this.chunks = []; }
  _write(chunk, enc, cb) { this.chunks.push(Buffer.from(chunk)); cb(); }
  _read() {}
  text() { return Buffer.concat(this.chunks).toString("latin1"); }
  setTimeout() { return this; }
  setNoDelay() { return this; }
  setKeepAlive() { return this; }
}

function fakeCtx(over = {}) {
  let settings = {};
  const files = {};
  const logs = [];
  const obsListeners = {};
  return {
    logs, files, obsListeners,
    log: (...a) => logs.push(a.join(" ")),
    settings: () => settings,
    saveSettings: (v) => { settings = v; },
    private: {
      readJson: (f) => (f in files ? JSON.parse(files[f]) : null),
      writeJson: (f, v) => { files[f] = JSON.stringify(v); },
    },
    obs: { state: { connected: false }, on: (ev, fn) => { obsListeners[ev] = fn; } },
    obsHost: "10.0.0.18",
    publicBase: "https://arcadesandwich.com",
    ...over,
  };
}

function wsRequest(key, { ip = "203.0.113.5", proto = "https", extra = [] } = {}) {
  const raw = [
    "Host", "arcadesandwich.com",
    "Upgrade", "websocket",
    "Connection", "Upgrade",
    "Sec-WebSocket-Key", "dGhlIHNhbXBsZSBub25jZQ==",
    "Sec-WebSocket-Version", "13",
    "Sec-WebSocket-Protocol", "obswebsocket.json",
    "User-Agent", "Moblin",
    "CF-Connecting-IP", ip,
    "CF-Ray", "abc123",
    "X-Forwarded-Proto", proto,
    "CF-Visitor", `{"scheme":"${proto}"}`, // SEC-PROG-21: Cloudflare sends this; it is what counts now
    "X-Forwarded-For", ip,
    "Cookie", "irls=session-secret",
    ...extra,
  ];
  const headers = {};
  for (let i = 0; i < raw.length; i += 2) headers[raw[i].toLowerCase()] = raw[i + 1];
  return { method: "GET", url: `/api/stream/ws/obsremote/${key}`, headers, rawHeaders: raw, socket: { remoteAddress: "127.0.0.1" } };
}

// A feature with fake OBS connections. Returns the feature, ctx and the upstream sockets it opened.
async function makeFeature({ probe = async () => true, enabled = false, now } = {}) {
  const ctx = fakeCtx();
  const opened = [];
  const f = await setup(ctx, {
    connect: (opts) => { const s = new FakeSocket(); s.opts = opts; opened.push(s); return s; },
    probe,
    now,
  });
  if (enabled) {
    const r = await f.routes["POST enable"]({ body: { on: true } });
    assert.equal(r.json.ok, true);
  }
  const key = () => ctx.private.readJson(KEY_FILE)?.key;
  const tryKey = (k, opts) => {
    const client = new FakeSocket();
    f.upgrade(wsRequest(k, opts), client, Buffer.alloc(0), { rest: k });
    return client;
  };
  return { f, ctx, opened, key, tryKey };
}

// ---------- the key ----------
test("newKey is long, URL-safe and different every time", () => {
  const a = newKey(), b = newKey();
  assert.equal(a.length, 32);
  assert.match(a, /^[A-Za-z0-9_-]+$/);
  assert.notEqual(a, b);
});

test("keyMatches only says yes to the exact key", () => {
  const k = newKey();
  assert.equal(keyMatches(k, k), true);
  assert.equal(keyMatches(k.slice(0, -1) + (k.endsWith("A") ? "B" : "A"), k), false);
  assert.equal(keyMatches(k + "x", k), false);
  assert.equal(keyMatches("", k), false);
  assert.equal(keyMatches(undefined, k), false);
  assert.equal(keyMatches(k, null), false); // no key yet: nothing matches
  assert.equal(keyMatches("short", "short"), false); // a too-short key is never accepted
});

test("cleanRest ignores a trailing slash", () => {
  assert.equal(cleanRest("abc/"), "abc");
  assert.equal(cleanRest("abc"), "abc");
  assert.equal(cleanRest(undefined), "");
});

test("the address uses wss and the host of the site", () => {
  assert.equal(obsRemoteAddress("https://arcadesandwich.com", "KEY"), "wss://arcadesandwich.com/api/stream/ws/obsremote/KEY");
  assert.equal(obsRemoteAddress("https://arcadesandwich.com/", "KEY"), "wss://arcadesandwich.com/api/stream/ws/obsremote/KEY");
  assert.equal(obsRemoteAddress("http://127.0.0.1:3002", "KEY"), "ws://127.0.0.1:3002/api/stream/ws/obsremote/KEY");
});

// ---------- request checks and rewriting ----------
test("clientIp trusts Cloudflare's header, else the socket", () => {
  assert.equal(clientIp({ headers: { "cf-connecting-ip": "198.51.100.7" }, socket: { remoteAddress: "127.0.0.1" } }), "198.51.100.7");
  assert.equal(clientIp({ headers: {}, socket: { remoteAddress: "127.0.0.1" } }), "127.0.0.1");
  // SEC-PROG-21: from any other connection the header is ignored
  assert.equal(clientIp({ headers: { "cf-connecting-ip": "198.51.100.7" }, socket: { remoteAddress: "10.0.0.9" } }), "10.0.0.9");
});

test("isSecure: from the internet only over https/wss", () => {
  assert.equal(isSecure({}), true); // this PC directly
  // SEC-PROG-21: x-forwarded-proto alone never counts (anyone can send it)
  assert.equal(isSecure({ "cf-connecting-ip": "1.2.3.4", "x-forwarded-proto": "https" }), false);
  assert.equal(isSecure({ "cf-connecting-ip": "1.2.3.4", "x-forwarded-proto": "wss" }), false);
  assert.equal(isSecure({ "cf-connecting-ip": "1.2.3.4", "cf-visitor": '{"scheme":"https"}' }), true);
  assert.equal(isSecure({ "cf-connecting-ip": "1.2.3.4", "x-forwarded-proto": "http" }), false);
  assert.equal(isSecure({ "cf-connecting-ip": "1.2.3.4", "cf-visitor": '{"scheme":"http"}' }), false);
  assert.equal(isSecure({ "cf-connecting-ip": "1.2.3.4" }), false);
});

test("isWebSocketUpgrade wants a GET with a WebSocket key", () => {
  assert.equal(isWebSocketUpgrade(wsRequest("k")), true);
  assert.equal(isWebSocketUpgrade({ method: "GET", headers: { upgrade: "h2c" } }), false);
  assert.equal(isWebSocketUpgrade({ method: "POST", headers: { upgrade: "websocket", "sec-websocket-key": "x" } }), false);
  assert.equal(isWebSocketUpgrade({ method: "GET", headers: { upgrade: "websocket" } }), false);
});

test("buildUpstreamRequest rewrites the path and Host, keeps Sec-WebSocket-*, drops proxy headers and cookies", () => {
  const key = newKey();
  const out = buildUpstreamRequest(wsRequest(key, { extra: ["X-Real-IP", "1.1.1.1", "cdn-loop", "cloudflare", "Sec-WebSocket-Extensions", "permessage-deflate"] }), { host: "10.0.0.18", port: 4455 });
  const lines = out.split("\r\n");
  assert.equal(lines[0], "GET / HTTP/1.1");
  assert.ok(out.endsWith("\r\n\r\n"));
  assert.ok(!out.includes(key), "the access key never reaches OBS");
  const names = lines.slice(1).filter(Boolean).map((l) => l.split(":")[0].toLowerCase());
  assert.deepEqual(names.filter((n) => n === "host"), ["host"]);
  assert.ok(lines.includes("Host: 10.0.0.18:4455"));
  assert.ok(lines.includes("Upgrade: websocket"));
  assert.ok(lines.includes("Connection: Upgrade"));
  assert.ok(lines.includes("Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ=="));
  assert.ok(lines.includes("Sec-WebSocket-Version: 13"));
  assert.ok(lines.includes("Sec-WebSocket-Protocol: obswebsocket.json"));
  assert.ok(lines.includes("Sec-WebSocket-Extensions: permessage-deflate"));
  assert.ok(lines.includes("User-Agent: Moblin"));
  for (const n of names) {
    assert.ok(!n.startsWith("cf-"), n);
    assert.ok(!n.startsWith("x-forwarded-"), n);
    assert.ok(!["cookie", "x-real-ip", "cdn-loop"].includes(n), n);
  }
  assert.ok(!out.includes("session-secret"));
  assert.equal(names.filter((n) => n === "connection" || n === "upgrade").length, 2); // only ours, once each
});

test("buildUpstreamRequest can't be tricked into extra header lines", () => {
  const req = { headers: { "x-evil": "a\r\nInjected: yes", "bad name": "x", "sec-websocket-key": "k" } };
  const out = buildUpstreamRequest(req, { host: "10.0.0.18", port: 4455 });
  assert.ok(!/\r\nInjected:/.test(out));
  assert.ok(out.includes("x-evil: aInjected: yes"));
  assert.ok(!out.includes("bad name"));
  assert.ok(out.includes("sec-websocket-key: k")); // works from req.headers too
});

// ---------- the rate limiter ----------
test("rate limiter: 10 wrong tries in 15 minutes, then refused", () => {
  const rl = makeRateLimiter();
  const t0 = 1_000_000;
  for (let i = 0; i < FAIL_LIMIT - 1; i++) rl.fail("1.2.3.4", t0 + i);
  assert.equal(rl.blocked("1.2.3.4", t0 + 100), false);
  rl.fail("1.2.3.4", t0 + 100);
  assert.equal(rl.blocked("1.2.3.4", t0 + 101), true);
  assert.equal(rl.blocked("5.6.7.8", t0 + 101), false, "other addresses are not affected");
  assert.equal(rl.blockedCount(t0 + 101), 1);
  // the oldest try leaves the window: one more try is allowed
  assert.equal(rl.blocked("1.2.3.4", t0 + FAIL_WINDOW_MS), false);
  assert.equal(rl.blocked("1.2.3.4", t0 + FAIL_WINDOW_MS + 200), false);
  assert.equal(rl.size(), 0, "expired entries are forgotten");
});

test("rate limiter: clear() unblocks, and memory stays bounded", () => {
  const rl = makeRateLimiter({ max: 2, windowMs: 1000, maxTracked: 3 });
  rl.fail("a", 0); rl.fail("a", 1);
  assert.equal(rl.blocked("a", 2), true);
  rl.clear();
  assert.equal(rl.blocked("a", 2), false);
  for (const ip of ["a", "b", "c", "d", "e"]) rl.fail(ip, 5);
  assert.ok(rl.size() <= 3);
  for (let i = 0; i < 50; i++) rl.fail("a", 10 + i);
  assert.equal(rl.blocked("a", 70), true); // still blocked, but only `max` times are kept
});

// ---------- the access decision ----------
test("decideAccess: every way in and out", () => {
  const key = newKey();
  const base = { enabled: true, key, rest: key, ip: "1.2.3.4", secure: true, open: 0, obsPassword: true, now: 1000 };
  const rl = () => makeRateLimiter();
  assert.deepEqual(decideAccess({ ...base, limiter: rl() }), { ok: true });
  assert.equal(decideAccess({ ...base, enabled: false, limiter: rl() }).status, 403);
  assert.equal(decideAccess({ ...base, rest: "nope", limiter: rl() }).status, 403);
  assert.equal(decideAccess({ ...base, obsPassword: false, limiter: rl() }).status, 503);
  assert.deepEqual(decideAccess({ ...base, obsPassword: null, limiter: rl() }), { ok: true }); // unknown: OBS still checks its own password
  assert.equal(decideAccess({ ...base, open: MAX_CONNECTIONS, limiter: rl() }).status, 503);
  assert.deepEqual(decideAccess({ ...base, open: MAX_CONNECTIONS - 1, limiter: rl() }), { ok: true });
  const plain = decideAccess({ ...base, secure: false, limiter: rl() });
  assert.equal(plain.status, 403);
  assert.equal(plain.leaked, true);
  assert.equal(decideAccess({ ...base, secure: false, rest: "x", limiter: rl() }).leaked, undefined);
});

test("decideAccess: only wrong keys count, and a blocked address is refused even with the right key", () => {
  const key = newKey();
  const limiter = makeRateLimiter();
  const base = { enabled: true, key, ip: "9.9.9.9", secure: true, open: 0, obsPassword: true, limiter, now: 5000 };
  decideAccess({ ...base, enabled: false, rest: "x" }); // off: not counted
  decideAccess({ ...base, secure: false, rest: "x" }); // plain ws: not counted
  assert.equal(limiter.size(), 0);
  for (let i = 0; i < FAIL_LIMIT; i++) assert.equal(decideAccess({ ...base, rest: "wrong" + i }).status, 403);
  assert.equal(decideAccess({ ...base, rest: key }).status, 429);
  assert.deepEqual(decideAccess({ ...base, rest: key, ip: "8.8.8.8" }), { ok: true });
});

test("no reason text ever holds the key", () => {
  const key = newKey();
  for (const o of [{ secure: false }, { enabled: false }, { rest: "x" }, { obsPassword: false }, { open: 9 }]) {
    const d = decideAccess({ enabled: true, key, rest: key, ip: "1.1.1.1", secure: true, open: 0, obsPassword: true, limiter: makeRateLimiter(), ...o });
    assert.ok(!JSON.stringify(d).includes(key));
  }
});

// ---------- probing OBS's password setting ----------
function fakeWsClass(behave) {
  return class {
    constructor(url) { this.url = url; this.closed = false; setImmediate(() => behave(this)); }
    close() { this.closed = true; }
  };
}

test("probeObsAuth reads OBS's Hello", async () => {
  const withAuth = fakeWsClass((ws) => ws.onmessage({ data: JSON.stringify({ op: 0, d: { rpcVersion: 1, authentication: { challenge: "c", salt: "s" } } }) }));
  const noAuth = fakeWsClass((ws) => ws.onmessage({ data: JSON.stringify({ op: 0, d: { rpcVersion: 1 } }) }));
  const fails = fakeWsClass((ws) => ws.onerror({}));
  const silent = fakeWsClass(() => {});
  assert.equal(await probeObsAuth({ host: "10.0.0.18", port: 4455, WebSocketImpl: withAuth }), true);
  assert.equal(await probeObsAuth({ host: "10.0.0.18", port: 4455, WebSocketImpl: noAuth }), false);
  assert.equal(await probeObsAuth({ host: "10.0.0.18", port: 4455, WebSocketImpl: fails }), null);
  assert.equal(await probeObsAuth({ host: "10.0.0.18", port: 4455, WebSocketImpl: silent, timeoutMs: 20 }), null);
  let url = null;
  await probeObsAuth({ host: "10.0.0.18", port: 4455, WebSocketImpl: fakeWsClass((ws) => { url = ws.url; ws.onclose({}); }) });
  assert.equal(url, "ws://10.0.0.18:4455");
});

test("refuse writes the status line and closes", async () => {
  const s = new FakeSocket();
  refuse(s, 403);
  await tick();
  assert.equal(s.text(), "HTTP/1.1 403 Forbidden\r\n\r\n");
  assert.equal(s.destroyed, true);
});

// ---------- the whole feature with fake sockets ----------
test("off by default: refused with 403, OBS never contacted", async () => {
  const { f, opened } = await makeFeature();
  assert.equal(f.state().enabled, false);
  const client = new FakeSocket();
  f.upgrade(wsRequest("anything"), client, Buffer.alloc(0), { rest: "anything" });
  await tick();
  assert.equal(client.text(), "HTTP/1.1 403 Forbidden\r\n\r\n");
  assert.equal(client.destroyed, true);
  assert.equal(opened.length, 0);
});

test("the right address opens a pipe to OBS with the rewritten request", async () => {
  const { f, ctx, opened, key } = await makeFeature({ enabled: true });
  const k = key();
  assert.ok(k && k.length >= 16, "turning on makes a key");
  const client = new FakeSocket();
  const req = wsRequest(k);
  f.upgrade(req, client, Buffer.from("early-bytes"), { rest: k + "/" });
  assert.equal(opened.length, 1);
  assert.deepEqual(opened[0].opts, { host: "10.0.0.18", port: 4455 });
  assert.equal(f.state().connections, 1);
  const up = opened[0];
  up.emit("connect");
  await tick();
  const sent = up.text();
  assert.ok(sent.startsWith("GET / HTTP/1.1\r\nHost: 10.0.0.18:4455\r\n"));
  assert.ok(sent.endsWith("\r\n\r\nearly-bytes"), "the bytes that came with the request follow it");
  assert.ok(!sent.includes(k));
  // both ways
  up.push(Buffer.from("HTTP/1.1 101 Switching Protocols\r\n\r\n"));
  client.push(Buffer.from("frame-from-app"));
  await tick();
  assert.ok(client.text().includes("101 Switching Protocols"));
  assert.ok(up.text().endsWith("frame-from-app"));
  // OBS closes: the app is closed too and the count drops
  up.destroy();
  await tick();
  assert.equal(f.state().connections, 0);
  assert.equal(client.writableEnded, true);
  assert.ok(ctx.logs.some((l) => l.includes("An app connected")));
  assert.ok(ctx.logs.some((l) => l.includes("An app disconnected")));
  // never the key in the logs or the page state
  assert.ok(!ctx.logs.join("\n").includes(k));
  assert.ok(!JSON.stringify(f.state()).includes(k));
});

test("the app hanging up closes the OBS side", async () => {
  const { f, opened, key } = await makeFeature({ enabled: true });
  const client = new FakeSocket();
  f.upgrade(wsRequest(key()), client, Buffer.alloc(0), { rest: key() });
  opened[0].emit("connect");
  await tick();
  client.destroy();
  await tick();
  assert.equal(f.state().connections, 0);
  assert.equal(opened[0].writableEnded, true);
});

test("OBS not answering: the app hears 502", async () => {
  const { f, opened, key } = await makeFeature({ enabled: true });
  const client = new FakeSocket();
  f.upgrade(wsRequest(key()), client, Buffer.alloc(0), { rest: key() });
  opened[0].emit("error", Object.assign(new Error("connect ECONNREFUSED"), { code: "ECONNREFUSED" }));
  await tick();
  assert.equal(client.text(), "HTTP/1.1 502 Bad Gateway\r\n\r\n");
  assert.equal(client.destroyed, true);
  assert.equal(f.state().connections, 0);
  assert.match(f.state().lastRefusal.why, /OBS isn't open/); // plain words, no ECONNREFUSED
  assert.doesNotMatch(f.state().lastRefusal.why, /ECONNREFUSED/);
});

test("at most 4 apps at once: a 5th with the right key replaces the oldest (dead phone connections can't lock the owner out)", async () => {
  const { f, opened, key, tryKey } = await makeFeature({ enabled: true });
  const first = tryKey(key());
  for (let i = 1; i < MAX_CONNECTIONS; i++) tryKey(key());
  assert.equal(f.state().connections, MAX_CONNECTIONS);
  const fifth = tryKey(key());
  await tick();
  assert.notEqual(fifth.text(), "HTTP/1.1 503 Service Unavailable\r\n\r\n");
  assert.equal(first.destroyed, true); // the oldest went
  assert.equal(opened.length, MAX_CONNECTIONS + 1);
  assert.equal(f.state().connections, MAX_CONNECTIONS);
  const wrong = tryKey("wrong-key"); // a wrong key never pushes anyone out
  await tick();
  assert.equal(f.state().connections, MAX_CONNECTIONS);
  assert.match(wrong.text(), /^HTTP\/1\.1 4\d\d/);
});

test("10 wrong addresses from one internet address, then even the right one is refused there", async () => {
  const { f, key, tryKey, opened } = await makeFeature({ enabled: true });
  for (let i = 0; i < FAIL_LIMIT; i++) tryKey("wrong-" + i, { ip: "198.51.100.1" });
  const blocked = tryKey(key(), { ip: "198.51.100.1" });
  await tick();
  assert.equal(blocked.text(), "HTTP/1.1 429 Too Many Requests\r\n\r\n");
  assert.equal(f.state().blocked, 1);
  tryKey(key(), { ip: "198.51.100.2" }); // someone else is fine
  assert.equal(opened.length, 1);
  await f.routes["POST unblock"]({ body: {} });
  assert.equal(f.state().blocked, 0);
  tryKey(key(), { ip: "198.51.100.1" });
  assert.equal(opened.length, 2);
});

test("plain ws:// from the internet is refused (no key sent to OBS)", async () => {
  const { f, key, tryKey, opened } = await makeFeature({ enabled: true });
  const c = tryKey(key(), { proto: "http" });
  await tick();
  assert.equal(c.text(), "HTTP/1.1 403 Forbidden\r\n\r\n");
  assert.equal(opened.length, 0);
  assert.match(f.state().lastRefusal.why, /New address/);
});

test("not a WebSocket request: 400", async () => {
  const { f, key } = await makeFeature({ enabled: true });
  const c = new FakeSocket();
  f.upgrade({ method: "GET", headers: { upgrade: "h2c" }, socket: {} }, c, Buffer.alloc(0), { rest: key() });
  await tick();
  assert.equal(c.text(), "HTTP/1.1 400 Bad Request\r\n\r\n");
});

test("New address cuts off open apps and the old address stops working", async () => {
  const { f, opened, key, tryKey } = await makeFeature({ enabled: true });
  const old = key();
  const c = tryKey(old);
  opened[0].emit("connect");
  await tick();
  assert.equal(f.state().connections, 1);
  const r = await f.routes["POST rotate"]({ body: {} });
  assert.equal(r.json.cutOff, 1);
  assert.equal(f.state().connections, 0);
  assert.equal(c.destroyed, true);
  assert.notEqual(key(), old);
  const again = tryKey(old);
  await tick();
  assert.equal(again.text(), "HTTP/1.1 403 Forbidden\r\n\r\n");
  tryKey(key());
  assert.equal(opened.length, 2);
});

test("turning off shuts open connections and refuses new ones", async () => {
  const { f, ctx, opened, key, tryKey } = await makeFeature({ enabled: true });
  const c = tryKey(key());
  opened[0].emit("connect");
  await tick();
  await f.routes["POST enable"]({ body: { on: false } });
  assert.equal(ctx.settings().enabled, false);
  assert.equal(c.destroyed, true);
  assert.equal(opened[0].destroyed, true);
  const again = tryKey(key());
  await tick();
  assert.equal(again.text(), "HTTP/1.1 403 Forbidden\r\n\r\n");
});

test("it won't turn on while OBS has no WebSocket password", async () => {
  const { f, ctx } = await makeFeature({ probe: async () => false });
  const r = await f.routes["POST enable"]({ body: { on: true } });
  assert.equal(r.status, 409);
  assert.match(r.json.error, /no WebSocket password/);
  assert.notEqual(ctx.settings().enabled, true);
  assert.equal(f.state().obsPassword, false);
});

test("OBS losing its password later shuts the door", async () => {
  let answer = true;
  const { f, ctx, opened, key, tryKey } = await makeFeature({ enabled: true, probe: async () => answer });
  const c = tryKey(key());
  opened[0].emit("connect");
  await tick();
  answer = false;
  ctx.obsListeners.connected(); // OBS came back (maybe with new settings): checked again
  await tick(); await tick();
  assert.equal(f.state().obsPassword, false);
  assert.equal(c.destroyed, true);
  const again = tryKey(key());
  await tick();
  assert.equal(again.text(), "HTTP/1.1 503 Service Unavailable\r\n\r\n");
});

test("OBS not reachable when turning on: allowed (OBS still checks its own password), state says unknown", async () => {
  const { f, ctx } = await makeFeature({ probe: async () => null });
  const r = await f.routes["POST enable"]({ body: { on: true } });
  assert.equal(r.json.ok, true);
  assert.equal(ctx.settings().enabled, true);
  assert.equal(f.state().obsPassword, null);
});

test("a probe that throws doesn't jam later checks", async () => {
  let calls = 0;
  const { f } = await makeFeature({ probe: () => { calls++; if (calls === 1) throw new Error("boom"); return Promise.resolve(true); } });
  await f.routes["POST enable"]({ body: { on: true } });
  await f.routes["POST enable"]({ body: { on: true } });
  assert.equal(calls, 2);
  assert.equal(f.state().obsPassword, true);
});

test("the address route gives the wss address; state never holds it", async () => {
  const { f, key } = await makeFeature();
  const r = await f.routes["GET address"]({});
  assert.equal(r.json.address, `wss://arcadesandwich.com/api/stream/ws/obsremote/${key()}`);
  const s = f.state();
  assert.equal(s.hasAddress, true);
  assert.ok(!JSON.stringify(s).includes(key()));
  assert.deepEqual(Object.keys(s).sort(), ["blocked", "connections", "enabled", "hasAddress", "lastConnectAt", "lastRefusal", "maxConnections", "obsPassword"]);
});

test("settings keep other fields and never hold the key", async () => {
  const { f, ctx, key } = await makeFeature();
  ctx.saveSettings({ other: 1 });
  await f.routes["POST enable"]({ body: { on: true } });
  assert.deepEqual(ctx.settings(), { other: 1, enabled: true });
  assert.ok(!JSON.stringify(ctx.settings()).includes(key()));
});

test("stop() closes everything", async () => {
  const { f, opened, key, tryKey } = await makeFeature({ enabled: true });
  const c = tryKey(key());
  opened[0].emit("connect");
  await tick();
  f.stop();
  assert.equal(c.destroyed, true);
  assert.equal(f.state().connections, 0);
});

// ---------- the page script ----------
test("the page script uses no inline styles or HTML strings", () => {
  const src = fs.readFileSync(path.join(HERE, "..", "public", "features", "obsremote.js"), "utf8");
  assert.ok(!/style\s*=/.test(src), "no inline style attributes (CSP)");
  assert.ok(!/innerHTML|outerHTML|insertAdjacentHTML/.test(src), "text is never read as HTML");
  assert.ok(/^\(\(\) => \{/m.test(src), "wrapped so its names don't clash with other features");
});

test("network errors are described in plain words", async () => {
  const { plainNetError } = await import("../features/obsremote.mjs");
  assert.match(plainNetError({ code: "ECONNREFUSED" }), /OBS isn't open/);
  assert.match(plainNetError({ code: "EHOSTUNREACH" }), /main PC isn't reachable/);
  assert.doesNotMatch(plainNetError({ code: "EWHATEVER" }), /E[A-Z]{4,}/);
});

// ================= the page, wired to the real server part through the core's route lookup =================
class PEl {
  constructor(tag) {
    this.tagName = tag.toUpperCase(); this.attrs = {}; this.children = []; this.listeners = {}; this.className = ""; this._text = "";
    this.value = ""; this.checked = false; this.disabled = false; this.dataset = {}; this.parent = null;
    const self = this;
    this.classList = {
      _set: () => new Set(self.className.split(/\s+/).filter(Boolean)),
      add(...cs) { const s = this._set(); for (const c of cs) s.add(c); self.className = [...s].join(" "); },
      remove(...cs) { const s = this._set(); for (const c of cs) s.delete(c); self.className = [...s].join(" "); },
      contains(c) { return this._set().has(c); },
      toggle(c, on) { if (on === undefined) on = !this.contains(c); if (on) this.add(c); else this.remove(c); return on; },
    };
  }
  setAttribute(k, v) { this.attrs[k] = String(v); if (k === "disabled") this.disabled = true; if (k === "id") this.id = String(v); }
  append(...c) { for (const x of c.flat()) { if (x == null) continue; if (x instanceof PEl) { if (x.parent) x.parent.removeChild(x); x.parent = this; this.children.push(x); } else this.children.push(String(x)); } }
  removeChild(n) { const i = this.children.indexOf(n); if (i >= 0) this.children.splice(i, 1); n.parent = null; }
  addEventListener(t, fn) { (this.listeners[t] ||= []).push(fn); }
  async fire(t) { for (const fn of this.listeners[t] || []) await fn({ preventDefault() {}, target: this }); }
  click() { return this.fire("click"); }
  set textContent(v) { this._text = String(v); for (const c of this.children) if (c instanceof PEl) c.parent = null; this.children = []; }
  get textContent() { return this._text + this.children.map((c) => (typeof c === "string" ? c : c.textContent)).join(""); }
  all() { return [this, ...this.children.flatMap((c) => (c instanceof PEl ? c.all() : []))]; }
  visible() { return !this.classList.contains("hidden") && (!this.parent || this.parent.visible()); }
}
function prng(seed) {
  let a = seed >>> 0;
  const next = () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  return { next, int: (n) => Math.floor(next() * n), pick: (arr) => arr[Math.floor(next() * arr.length)], chance: (p) => next() < p };
}

// The page script in a pretend browser whose IRLS.api reaches the real feature's routes the way server.mjs does.
function loadPage({ f, ctx }) {
  const code = fs.readFileSync(path.join(HERE, "..", "public", "features", "obsremote.js"), "utf8");
  const cards = [];
  const toasts = [];
  const calls = [];
  const hooks = [];
  let lastState = null;
  let netDown = false;
  const docListeners = {};
  const document = { hidden: false, activeElement: null, addEventListener: (t, fn) => { (docListeners[t] ||= []).push(fn); } };
  const desc = { name: "obsremote", routes: f.routes, publicRoutes: {}, state: f.state };
  async function api(p, opts = {}) {
    calls.push({ p, body: opts.body === undefined ? undefined : JSON.parse(JSON.stringify(opts.body)) });
    if (netDown) throw new Error("Can't reach the dashboard.");
    const method = opts.body !== undefined ? "POST" : "GET";
    const m = p.match(/^x\/(.+)$/);
    const hit = m && findRoute([desc], "private", method, m[1]);
    if (!hit) throw new Error("not found");
    let r;
    try { r = (await hit.handler({ url: new URL("http://x/api/stream/" + p), body: opts.body ?? null, rest: hit.rest })) || {}; }
    catch (err) { r = { status: 502, json: { error: err.message } }; }
    const status = r.status || 200;
    const json = r.json !== undefined ? r.json : { ok: true };
    if (status >= 400) throw new Error((json && json.error) || "Error " + status);
    return JSON.parse(JSON.stringify(json));
  }
  const stateNow = () => {
    let st;
    try { st = f.state(); } catch (err) { st = { error: err.message }; }
    return { now: Date.now(), obs: { connected: Boolean(ctx.obs.state.connected) }, features: { obsremote: st } };
  };
  const render = (s = stateNow()) => { lastState = s; for (const fn of hooks) fn(s); return s; };
  const IRLS = {
    el(tag, props = {}, ...children) {
      const e = new PEl(tag);
      for (const [k, v] of Object.entries(props || {})) {
        if (k === "class") e.className = v;
        else if (k === "text") e.textContent = v;
        else if (k.startsWith("on") && typeof v === "function") e.addEventListener(k.slice(2), v);
        else if (v === true) e.setAttribute(k, "");
        else if (v !== false && v != null) e.setAttribute(k, v);
      }
      e.append(...children);
      return e;
    },
    card({ id, title }) { const body = new PEl("div"); body.id = id; body.title = title; cards.push(body); return body; },
    css() {},
    state: () => lastState,
    onRender: (fn) => hooks.push(fn),
    api,
    async act(p, body, okMsg) { try { await api(p, { body }); if (okMsg) toasts.push(okMsg); render(); } catch (err) { toasts.push(err.message); } },
    toast: (m) => toasts.push(String(m)),
    copyRow: (label, value) => { const e = new PEl("div"); e.className = "copyrow"; e.append(label + ": " + value); return e; },
  };
  const clock = { now: 1_700_000_000_000, timers: [], id: 0 };
  class FakeDate extends Date { constructor(...a) { super(...(a.length ? a : [clock.now])); } static now() { return clock.now; } }
  const setTimeoutF = (fn, ms) => { const id = ++clock.id; clock.timers.push({ id, at: clock.now + (ms || 0), fn }); return id; };
  const clearTimeoutF = (id) => { clock.timers = clock.timers.filter((t) => t.id !== id); };
  const advance = async (ms) => {
    const end = clock.now + ms;
    for (;;) {
      const due = clock.timers.filter((t) => t.at <= end).sort((a, b) => a.at - b.at)[0];
      if (!due) break;
      clock.now = due.at; clearTimeoutF(due.id); await due.fn();
    }
    clock.now = end;
  };
  const sandbox = { IRLS, document, console, Date: FakeDate, setTimeout: setTimeoutF, clearTimeout: clearTimeoutF };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(code, sandbox, { filename: "obsremote.js" });
  const root = cards[0];
  const all = () => root.all();
  return {
    root, toasts, calls, render, advance, clock,
    setNetDown: (v) => { netDown = v; },
    buttons: () => all().filter((e) => e.tagName === "BUTTON"),
    button: (re) => all().find((e) => e.tagName === "BUTTON" && re.test(e.textContent) && e.visible()),
    hide: async () => { document.hidden = true; for (const fn of docListeners.visibilitychange || []) await fn(); document.hidden = false; },
    text: () => all().filter((e) => e.visible()).map((e) => e._text + e.children.filter((c) => typeof c === "string").join("")).join(" "),
  };
}

test("page + server: On takes two taps, Off one; the address shows only on Show and hides again; New address cuts apps off", async () => {
  const { f, ctx, opened } = await makeFeature({ probe: async () => true });
  const p = loadPage({ f, ctx });
  p.render();
  assert.match(p.text(), /Off\. Apps can't reach OBS from outside your home/);
  assert.ok(!/wss:\/\//.test(p.root.textContent), "no address before Show");
  const on = p.button(/^On$/);
  await on.click();
  assert.equal(on.textContent, "Tap again to turn on");
  assert.equal(f.state().enabled, false, "the first tap only arms");
  await on.click(); // a quick double tap
  assert.equal(f.state().enabled, false);
  await p.advance(650);
  await on.click();
  assert.equal(f.state().enabled, true);
  assert.match(p.toasts.at(-1), /^On\./);
  assert.match(p.text(), /No apps connected right now/);
  assert.equal(on.textContent, "On");
  // Tapping On again does nothing (already on): it neither arms nor calls
  const before = p.calls.length;
  await on.click();
  assert.equal(on.textContent, "On");
  assert.equal(p.calls.length, before);
  // Show address, then it hides when the screen goes off
  await p.button(/^Show address$/).click();
  const addr = f.routes["GET address"] && (await f.routes["GET address"]()).json.address;
  assert.ok(p.root.textContent.includes(addr));
  assert.ok(p.button(/^Hide address$/));
  await p.hide();
  assert.ok(!p.root.textContent.includes(addr));
  assert.ok(p.button(/^Show address$/));
  // An app connects; New address cuts it off and shows the new address when the old one was open
  await p.button(/^Show address$/).click();
  f.upgrade(wsRequest(addr.split("/").pop()), new FakeSocket(), Buffer.alloc(0), { rest: addr.split("/").pop() });
  opened[0].emit("connect");
  await tick();
  p.render();
  assert.match(p.text(), /1 app connected/);
  const nb = p.button(/^New address$/);
  await nb.click();
  assert.match(nb.textContent, /apps using the old address get cut off/);
  await p.advance(650);
  await nb.click();
  await tick();
  assert.match(p.toasts.at(-1), /New address made/);
  const addr2 = (await f.routes["GET address"]()).json.address;
  assert.notEqual(addr2, addr);
  assert.ok(p.root.textContent.includes(addr2), "the new address is shown straight away");
  assert.ok(!p.root.textContent.includes(addr));
  assert.equal(f.state().connections, 0);
  // Off: one tap
  await p.button(/^Off$/).click();
  await tick();
  assert.equal(f.state().enabled, false);
  assert.match(p.toasts.at(-1), /^Off\./);
  f.stop();
});

test("page + server: turning on while OBS has no password is refused in plain words, and the card says what to do", async () => {
  const { f, ctx } = await makeFeature({ probe: async () => false });
  ctx.obs.state.connected = true;
  const p = loadPage({ f, ctx });
  p.render();
  const on = p.button(/^On$/);
  await on.click();
  await p.advance(650);
  await on.click();
  assert.equal(f.state().enabled, false);
  assert.match(p.toasts.at(-1), /OBS has no WebSocket password, so this stays off/);
  p.render();
  assert.match(p.text(), /tick Enable Authentication and set a password/);
  // Unblock shows only when something is blocked
  assert.equal(p.button(/^Unblock$/), undefined);
  p.render({ now: 1, obs: {}, features: { obsremote: { ...f.state(), blocked: 2 } } });
  assert.match(p.text(), /2 internet addresses are blocked/);
  await p.button(/^Unblock$/).click();
  assert.match(p.toasts.at(-1), /Unblocked/);
  f.stop();
});

test("page: a server part that only reports an error, or no state, never throws", async () => {
  const { f, ctx } = await makeFeature();
  const p = loadPage({ f, ctx });
  assert.doesNotThrow(() => p.render({ now: 1, obs: {}, features: { obsremote: { error: "boom" } } }));
  assert.match(p.text(), /This card hit a problem: boom/);
  assert.doesNotThrow(() => p.render({ now: 1, obs: {}, features: {} }));
  assert.match(p.text(), /Not available right now/);
  assert.doesNotThrow(() => p.render({ now: 1, features: { obsremote: { enabled: true, connections: 1, maxConnections: 4, obsPassword: null, lastRefusal: { at: 5, why: "x" }, lastConnectAt: 7, blocked: 0 } } }));
  // and the On/Off buttons still work after a bad update
  p.render();
  await p.button(/^Off$/).click();
  f.stop();
});

test("page fuzz: 300 random taps, updates and faults never throw, leak nodes or leave anything armed or out of step", async () => {
  for (const seed of [11, 12, 13]) {
    const rnd = prng(seed);
    let pw = true;
    const { f, ctx, opened } = await makeFeature({ probe: async () => pw });
    const p = loadPage({ f, ctx });
    const unhandled = [];
    const onUnhandled = (e) => unhandled.push(e);
    process.on("unhandledRejection", onUnhandled);
    p.render();
    const base = p.root.all().length;
    const inflight = new Set();
    try {
      for (let i = 0; i < 300; i++) {
        const what = rnd.int(10);
        if (what < 5) {
          const list = p.buttons().filter((b) => b.visible() && !b.disabled);
          if (list.length) { const pr = rnd.pick(list).click(); inflight.add(pr); pr.finally(() => inflight.delete(pr)); if (rnd.chance(0.7)) await pr; }
        } else if (what < 8) {
          const r = rnd.int(5);
          if (r === 0) ctx.obs.state.connected = !ctx.obs.state.connected;
          if (r === 1) pw = rnd.pick([true, false, null]);
          if (r === 2 && f.state().enabled) { // an app knocks with the right or a wrong key
            const key = rnd.chance(0.5) ? (await f.routes["GET address"]()).json.address.split("/").pop() : "wrong" + i;
            f.upgrade(wsRequest(key, { ip: "203.0.113." + rnd.int(3) }), new FakeSocket(), Buffer.alloc(0), { rest: key });
            const up = opened.at(-1); if (up && rnd.chance(0.7)) up.emit("connect");
          }
          if (r === 3) p.setNetDown(rnd.chance(0.3));
          if (r === 4) await p.advance(rnd.pick([100, 650, 4100]));
          p.render();
        } else {
          await p.hide();
          p.render();
        }
        await tick();
        assert.ok(p.root.all().length < base + 200, `node count grew to ${p.root.all().length} at step ${i} (seed ${seed})`);
      }
      p.setNetDown(false);
      await Promise.allSettled([...inflight]);
      await p.advance(4100);
      const s = p.render();
      const st = s.features.obsremote;
      assert.equal(p.button(/^On$/).classList.contains("on"), Boolean(st.enabled), `the switch shows the server's setting (seed ${seed})`);
      assert.equal(p.button(/^Off$/).classList.contains("on"), !st.enabled);
      assert.match(p.text(), st.enabled ? /^On\.|On\. / : /Off\. Apps can't reach OBS/);
      for (const b of p.buttons()) assert.ok(!b.classList.contains("armed"), `nothing stays armed (seed ${seed})`);
      assert.deepEqual(unhandled, [], `no unhandled rejection (seed ${seed})`);
      assert.ok(!JSON.stringify(st).includes(ctx.files[KEY_FILE] ? JSON.parse(ctx.files[KEY_FILE]).key : "never"), "the key is never in the state");
    } finally {
      process.off("unhandledRejection", onUnhandled);
      f.stop();
    }
  }
});

test("server: on and off at once, two rotations at once, and alternating enable/rotate leave one consistent setting and key", async () => {
  const { f, ctx, opened } = await makeFeature({ probe: async () => true, enabled: true });
  const key0 = JSON.parse(ctx.files[KEY_FILE]).key;
  f.upgrade(wsRequest(key0), new FakeSocket(), Buffer.alloc(0), { rest: key0 });
  opened[0].emit("connect");
  await tick();
  assert.equal(f.state().connections, 1);
  const r = await Promise.all([
    f.routes["POST enable"]({ body: { on: false } }), f.routes["POST enable"]({ body: { on: true } }),
    f.routes["POST rotate"]({}), f.routes["POST rotate"]({}),
    f.routes["POST enable"]({ body: { on: false } }), f.routes["POST unblock"]({}),
  ]);
  assert.ok(r.every((x) => x.json.ok));
  assert.equal(f.state().enabled, false, "the last word wins");
  assert.equal(f.state().connections, 0, "the app was cut off");
  const key1 = JSON.parse(ctx.files[KEY_FILE]).key;
  assert.notEqual(key1, key0);
  assert.equal((await f.routes["GET address"]()).json.address.split("/").pop(), key1, "the address matches the saved key");
  // The old key no longer opens the door; the new one does once it's on
  await f.routes["POST enable"]({ body: { on: true } });
  const s1 = new FakeSocket();
  f.upgrade(wsRequest(key0), s1, Buffer.alloc(0), { rest: key0 });
  await tick();
  assert.match(s1.text(), /^HTTP\/1\.1 403/);
  f.upgrade(wsRequest(key1), new FakeSocket(), Buffer.alloc(0), { rest: key1 });
  opened.at(-1).emit("connect");
  await tick();
  assert.equal(f.state().connections, 1);
  f.stop();
});
