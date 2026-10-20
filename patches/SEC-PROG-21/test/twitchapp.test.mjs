import { test, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import vm from "node:vm";
import {
  buildAuthorizeUrl, callbackUrl, playerUrl, hostOf, StateStore, parseClipId, parseClipList, filterClips, publicClip,
  refreshDelay, needsRefresh, tokenFromResponse, botFileText, botFileLogin, botFileIsOurs, RateLimiter, scrub,
  shuffle, playOrder, embedUrl, videoUrlFrom, cleanClipSettings, cleanAppInput, clipsQuery, clipsPageHtml, clipsCsp, resultPage,
  removePrivateFile, createTwitchApp, APP_FILE, OAUTH_FILE, BOT_FILE, REFRESH_LEAD_MS, RETRY_MS, STATE_TTL_MS,
  CLIPS_CACHE_MS, VALIDATE_EVERY_MS, DEFAULT_CLIPS, TICK_MS, MAX_CLIP_PAGES, collectPages, ipBucket, clientKey,
} from "../features/twitchapp.mjs";
import { makePrivateStore, findRoute } from "../features/runtime.mjs";

const CLIENT = "abcdefghijklmnopqrstuvwxyz0123";
const SECRET = "s3cr3tsecretsecretsecretsecret";
const BASE = "https://arcadesandwich.com";
const REDIRECT = BASE + "/api/stream/pub/twitchapp/callback";
const T0 = Date.parse("2026-10-07T12:00:00Z");
const DAY = 24 * 3600 * 1000;
const SECRETS = [SECRET, "useraccess", "userrefresh", "apptok"];

const made = [];
after(() => { for (const d of made) fs.rmSync(d, { recursive: true, force: true }); });

// ---------- pure helpers ----------
test("the authorize address has everything Twitch needs", () => {
  const u = new URL(buildAuthorizeUrl({ clientId: CLIENT, redirectUri: REDIRECT, state: "st4te" }));
  assert.equal(u.origin + u.pathname, "https://id.twitch.tv/oauth2/authorize");
  assert.equal(u.searchParams.get("client_id"), CLIENT);
  assert.equal(u.searchParams.get("redirect_uri"), REDIRECT);
  assert.equal(u.searchParams.get("response_type"), "code");
  assert.equal(u.searchParams.get("scope"), "chat:read chat:edit");
  assert.equal(u.searchParams.get("state"), "st4te");
  assert.equal(u.searchParams.get("force_verify"), "true");
});

test("callback and player addresses come from the public base", () => {
  assert.equal(callbackUrl(BASE), REDIRECT);
  assert.equal(callbackUrl(BASE + "/"), REDIRECT);
  assert.equal(playerUrl(BASE), BASE + "/api/stream/pub/twitchapp/clips");
  assert.equal(hostOf(BASE), "arcadesandwich.com");
  assert.equal(hostOf("not a url"), "");
});

test("a Connect state works once, only for 10 minutes", () => {
  const s = new StateStore();
  const a = s.create(1000);
  const b = s.create(1000);
  assert.notEqual(a, b);
  assert.ok(a.length >= 32);
  assert.equal(s.take("wrong", 1000), false);
  assert.equal(s.take(a, 2000), true);
  assert.equal(s.take(a, 2000), false, "used once already");
  assert.equal(s.take(b, 1000 + STATE_TTL_MS), false, "expired");
  assert.equal(s.take(undefined, 1000), false);
  assert.equal(s.take({}, 1000), false);
  assert.equal(s.take("x".repeat(500), 1000), false);
});

test("the state store keeps only the newest few and stores no plain states", () => {
  const s = new StateStore({ max: 3 });
  const list = [1, 2, 3, 4].map(() => s.create(0));
  assert.equal(s.size, 3);
  assert.equal(s.take(list[0], 0), false, "the oldest was dropped");
  assert.equal(s.take(list[3], 0), true);
  assert.ok(!JSON.stringify(s.items).includes(list[1]));
});

test("clip IDs come out of every kind of clip link", () => {
  const id = "AgreeableFurryEggnogPeanutButterJellyTime-8oLyQ8tYl9aZq1Sx";
  assert.equal(parseClipId(`https://clips.twitch.tv/${id}`), id);
  assert.equal(parseClipId(`https://www.twitch.tv/cade/clip/${id}?filter=clips&range=all&sort=time`), id);
  assert.equal(parseClipId(`https://m.twitch.tv/clip/${id}`), id);
  assert.equal(parseClipId(`https://m.twitch.tv/cade/clip/${id}`), id);
  assert.equal(parseClipId(`clips.twitch.tv/${id}`), id);
  assert.equal(parseClipId(`www.twitch.tv/cade/clip/${id}`), id);
  assert.equal(parseClipId(`https://clips.twitch.tv/embed?clip=${id}&parent=x`), id);
  assert.equal(parseClipId(`  ${id}  `), id);
  assert.equal(parseClipId("https://clips.twitch.tv/embed"), null);
  assert.equal(parseClipId(`https://evil.example/cade/clip/${id}`), null);
  assert.equal(parseClipId(`https://twitch.tv.evil.example/clip/${id}`), null);
  assert.equal(parseClipId("https://www.twitch.tv/cade"), null);
  assert.equal(parseClipId("not a <clip>"), null);
  assert.equal(parseClipId(""), null);
});

test("a typed clip list becomes unique IDs, and nonsense is counted", () => {
  const r = parseClipList("https://clips.twitch.tv/AaaBbb-1\nAaaBbb-1, CccDdd\n\n  https://evil.example/clip/X  <oops>");
  assert.deepEqual(r.ids, ["AaaBbb-1", "CccDdd"]);
  assert.equal(r.bad, 2);
  assert.deepEqual(parseClipList(["A1", "A1", "B2"]).ids, ["A1", "B2"]);
  assert.equal(parseClipList(Array.from({ length: 500 }, (_, i) => "C" + i)).ids.length, 200);
});

const clip = (id, { views = 100, daysAgo = 1, duration = 20.4, title = "Title " + id } = {}) => ({
  id, title, view_count: views, created_at: new Date(T0 - daysAgo * DAY).toISOString(), duration, creator_name: "fan_" + id,
  broadcaster_name: "cade", url: "https://clips.twitch.tv/" + id, thumbnail_url: "https://x/y.jpg", embed_url: "https://clips.twitch.tv/embed?clip=" + id,
});

test("the clip filter: views, days, block list, allow list", () => {
  const raw = [clip("A", { views: 5 }), clip("B", { views: 50 }), clip("C", { views: 50, daysAgo: 40 }), clip("D", { views: 1, daysAgo: 400 }), clip("E"), clip("B"), clip("Z", { duration: 0 })];
  const s = { ...DEFAULT_CLIPS, minViews: 10, days: 30, block: ["E"], allow: ["D"] };
  assert.deepEqual(filterClips(raw, s, T0).map((c) => c.id), ["B", "D"], "A too few views, C too old, D allowed anyway, E blocked, B once, Z no length");
  assert.deepEqual(filterClips(raw, { ...s, onlyAllow: true }, T0).map((c) => c.id), ["D"]);
  assert.deepEqual(filterClips(raw, { ...s, block: ["D"], onlyAllow: true }, T0).map((c) => c.id), [], "the block list wins");
  assert.deepEqual(filterClips(raw, { ...s, days: 0, minViews: 0, allow: [] }, T0).map((c) => c.id), ["A", "B", "C", "D"], "0 days = all time");
});

test("only public clip info goes to the player", () => {
  const out = publicClip(clip("A", { duration: 29.94 }));
  assert.deepEqual(Object.keys(out).sort(), ["creator", "date", "duration", "id", "title", "views"]);
  assert.equal(out.duration, 29.9);
  assert.equal(publicClip({ id: "bad id!", duration: 3 }), null);
  assert.equal(publicClip({ id: "Ok", duration: "x" }), null);
});

test("renewal timing: 10 minutes before the login runs out", () => {
  const exp = T0 + 4 * 3600 * 1000;
  assert.equal(refreshDelay(exp, T0), 3600 * 1000, "capped at 1 hour, so the hourly check runs too");
  assert.equal(refreshDelay(exp, exp - 30 * 60 * 1000), 20 * 60 * 1000);
  assert.equal(refreshDelay(exp, exp - REFRESH_LEAD_MS), 5000, "never less than 5 s");
  assert.equal(refreshDelay(exp, exp + 999999), 5000);
  assert.equal(refreshDelay(undefined, T0), 5000);
  assert.equal(needsRefresh(exp, exp - REFRESH_LEAD_MS - 1), false);
  assert.equal(needsRefresh(exp, exp - REFRESH_LEAD_MS), true);
  assert.equal(needsRefresh(NaN, T0), true);
});

test("Twitch's token answer is read safely", () => {
  const t = tokenFromResponse({ access_token: "a1", refresh_token: "r1", expires_in: 100, scope: ["chat:read"] }, 1000);
  assert.deepEqual(t, { access: "a1", refresh: "r1", expiresAt: 101000, scopes: ["chat:read"] });
  assert.equal(tokenFromResponse({ access_token: "a" }, 0).expiresAt, 3600 * 1000);
  assert.equal(tokenFromResponse({ access_token: "a" }, 0).refresh, null);
  assert.throws(() => tokenFromResponse({}), /no login token/);
});

test("bot login file: two lines, and a hand-made one for another account is not ours", () => {
  assert.equal(botFileText("cadebot", "tok"), "cadebot\ntok\n");
  assert.equal(botFileLogin("﻿ CadeBot \r\ntok"), "cadebot");
  assert.equal(botFileIsOurs(null, "cadebot"), true);
  assert.equal(botFileIsOurs("", "cadebot"), true);
  assert.equal(botFileIsOurs("CadeBot\nold", "cadebot"), true);
  assert.equal(botFileIsOurs("otherbot\nold", "cadebot"), false);
});

test("rate limiter counts per key per window", () => {
  const r = new RateLimiter({ max: 2, windowMs: 1000, maxKeys: 3 });
  assert.equal(r.hit("a", 0), true);
  assert.equal(r.hit("a", 10), true);
  assert.equal(r.hit("a", 20), false);
  assert.equal(r.hit("b", 20), true);
  assert.equal(r.hit("a", 1000), true, "a new window");
  for (const k of ["c", "d", "e", "f"]) r.hit(k, 1000);
  assert.ok(r.hits.size <= 3, "memory stays bounded");
});

test("scrub takes secrets out of a message", () => {
  assert.equal(scrub(`bad secret ${SECRET} here`, [SECRET, null, "abc"]), "bad secret *** here");
  assert.equal(scrub("abc stays (too short to be a secret)", ["abc"]), "abc stays (too short to be a secret)");
});

test("shuffle keeps every clip, and a new round never starts with the last one", () => {
  const list = ["a", "b", "c", "d", "e"].map((id) => ({ id }));
  let seed = 7;
  const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const s = shuffle(list, rand);
  assert.deepEqual(s.map((x) => x.id).sort(), ["a", "b", "c", "d", "e"]);
  assert.equal(list.map((x) => x.id).join(""), "abcde", "the original list is untouched");
  for (let i = 0; i < 50; i++) assert.notEqual(playOrder(list, "a", rand)[0].id, "a");
  assert.equal(playOrder([{ id: "a" }], "a")[0].id, "a", "one clip just repeats");
});

test("the embed address has the clip, the parent and sound on", () => {
  assert.equal(embedUrl("Abc-1", ["arcadesandwich.com"]), "https://clips.twitch.tv/embed?clip=Abc-1&parent=arcadesandwich.com&autoplay=true&muted=false");
  assert.match(embedUrl("A", ["a.com", "b.com"]), /parent=a\.com&parent=b\.com/);
});

test("clip settings are tidied, and a partial save keeps the rest", () => {
  const { settings, bad } = cleanClipSettings({ channel: "https://www.twitch.tv/Cade_Live/clips", minViews: "25", days: -3, block: "https://clips.twitch.tv/X1\n<bad>", showTitle: false, junk: 1 });
  assert.equal(settings.channel, "cade_live");
  assert.equal(settings.minViews, 25);
  assert.equal(settings.days, 0);
  assert.deepEqual(settings.block, ["X1"]);
  assert.equal(settings.showTitle, false);
  assert.equal(bad.block, 1);
  assert.ok(!("junk" in settings));
  const next = cleanClipSettings({ allow: ["Y2"] }, settings).settings;
  assert.deepEqual(next.block, ["X1"]);
  assert.deepEqual(next.allow, ["Y2"]);
  assert.equal(next.minViews, 25);
  assert.equal(cleanClipSettings({ minViews: "", days: "abc" }, settings).settings.minViews, 25, "an empty box keeps the saved value");
  assert.deepEqual(cleanClipSettings(null, { weird: true, minViews: -1 }).settings, DEFAULT_CLIPS);
});

test("app input: an empty secret keeps the saved one only for the same client ID", () => {
  assert.match(cleanAppInput({ clientId: "short", clientSecret: SECRET }).error, /client ID/);
  assert.match(cleanAppInput({ clientId: CLIENT, clientSecret: "x y" }).error, /secret/);
  assert.match(cleanAppInput({ clientId: CLIENT, clientSecret: "" }).error, /secret too/);
  assert.deepEqual(cleanAppInput({ clientId: ` ${CLIENT} `, clientSecret: "" }, { clientId: CLIENT, clientSecret: SECRET }).app, { clientId: CLIENT, clientSecret: SECRET });
  assert.ok(!JSON.stringify(cleanAppInput({ clientId: CLIENT, clientSecret: "bad secret!" })).includes("bad secret!"), "the typed secret is never echoed");
});

test("the clips query sends a start and an end date (Twitch's default end is start + 1 week)", () => {
  const q = new URLSearchParams(clipsQuery({ broadcasterId: "42", days: 30, now: T0, after: "cur" }));
  assert.equal(q.get("broadcaster_id"), "42");
  assert.equal(q.get("first"), "100");
  assert.equal(q.get("started_at"), "2026-09-07T12:00:00Z");
  assert.equal(q.get("ended_at"), "2026-10-07T12:00:00Z");
  assert.equal(q.get("after"), "cur");
  assert.equal(new URLSearchParams(clipsQuery({ broadcasterId: "42", days: 0, now: T0 })).get("started_at"), null);
});

test("the callback answer page has a strict CSP and escapes text", () => {
  const r = resultPage({ ok: false, heading: "Not connected", text: "Twitch said: <script>x</script>" });
  assert.equal(r.status, 400);
  assert.match(r.headers["Content-Security-Policy"], /default-src 'none'/);
  assert.ok(!r.body.includes("<script>"));
  assert.ok(r.body.includes("&lt;script&gt;"));
});

test("removing a private file works with the real private folder too", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "irls-twitchapp-"));
  made.push(dir);
  const store = makePrivateStore(dir);
  store.write("twitch-bot.txt", "a\nb\n");
  removePrivateFile(store, "twitch-bot.txt");
  assert.equal(store.read("twitch-bot.txt"), null);
  removePrivateFile(store, "twitch-bot.txt"); // already gone: no error
});

// ---------- the feature, with a fake toolbox, a fake Twitch and a fake clock ----------
function fakeTimers() {
  const list = [];
  return {
    list,
    setTimeout: (fn, ms) => { const t = { fn, ms, cleared: false, unref() {} }; list.push(t); return t; },
    clearTimeout: (t) => { if (t) t.cleared = true; },
    intervals: [],
    setInterval(fn, ms) { const t = { fn, ms, cleared: false, unref() {} }; this.intervals.push(t); return t; },
    clearInterval: (t) => { if (t) t.cleared = true; },
    pending: () => list.filter((t) => !t.cleared),
    pendingIntervals() { return this.intervals.filter((t) => !t.cleared); },
  };
}

function makeClips(n) {
  return Array.from({ length: n }, (_, i) => clip("Clip" + i, { views: i, daysAgo: 1 + (i % 20) }));
}

function setupApp({ files = {}, settings = {}, handlers = {}, chatChannel = "cade" } = {}) {
  let t = T0;
  const clock = { now: () => t, advance: (ms) => { t += ms; } };
  const store = new Map(Object.entries(files).map(([k, v]) => [k, typeof v === "string" ? v : JSON.stringify(v)]));
  const logs = [];
  let saved = settings;
  const chat = { syncs: 0, sync() { this.syncs++; }, getConfig: () => ({ enabled: Boolean(chatChannel), channel: chatChannel }), state: { canReply: false, channel: chatChannel } };
  const ctx = {
    log: (...a) => logs.push(a.join(" ")),
    publicBase: BASE,
    settings: () => saved,
    saveSettings: (v) => { saved = v; },
    private: {
      path: (f) => "/nowhere/" + f,
      read: (f) => (store.has(f) ? store.get(f) : null),
      readJson: (f) => { try { return JSON.parse(store.get(f)); } catch { return null; } },
      write: (f, c) => { store.set(f, String(c)); },
      writeJson: (f, v) => { store.set(f, JSON.stringify(v)); },
      remove: (f) => { store.delete(f); },
    },
    chat,
  };
  const calls = [];
  const n = { appTok: 0, access: 1 };
  const clipsList = makeClips(350);
  const base = {
    "POST https://id.twitch.tv/oauth2/token": ({ body }) => {
      if (body.get("client_id") !== CLIENT || body.get("client_secret") !== SECRET) return [403, { status: 403, message: "invalid client secret" }];
      const g = body.get("grant_type");
      if (g === "client_credentials") return [200, { access_token: "apptok" + ++n.appTok, expires_in: 5000000, token_type: "bearer" }];
      if (g === "authorization_code") {
        if (body.get("code") !== "goodcode" || body.get("redirect_uri") !== REDIRECT) return [400, { status: 400, message: "Invalid authorization code" }];
        return [200, { access_token: "useraccess1", refresh_token: "userrefresh1", expires_in: 14400, scope: ["chat:edit", "chat:read"], token_type: "bearer" }];
      }
      if (g === "refresh_token") {
        n.access++;
        return [200, { access_token: "useraccess" + n.access, refresh_token: "userrefresh" + n.access, expires_in: 14400, scope: ["chat:edit", "chat:read"] }];
      }
      return [400, { message: "bad grant" }];
    },
    "GET https://api.twitch.tv/helix/users": ({ url, headers }) => {
      if (headers["Client-Id"] !== CLIENT) return [401, { message: "Client-Id missing" }];
      if (url.searchParams.get("login")) return [200, { data: url.searchParams.get("login") === "cade" ? [{ id: "1234", login: "cade" }] : [] }];
      return [200, { data: [{ id: "999", login: "CadeBot", display_name: "CadeBot" }] }];
    },
    "GET https://api.twitch.tv/helix/clips": ({ url }) => {
      const ids = url.searchParams.getAll("id");
      if (ids.length) return [200, { data: ids.map((id) => clip(id, { views: 0, daysAgo: 900 })), pagination: {} }];
      if (url.searchParams.get("broadcaster_id") !== "1234") return [400, { message: "bad broadcaster" }];
      const page = Number((url.searchParams.get("after") || "p0").slice(1));
      const data = clipsList.slice(page * 100, page * 100 + 100);
      return [200, { data, pagination: page * 100 + 100 < clipsList.length ? { cursor: "p" + (page + 1) } : {} }];
    },
    "GET https://id.twitch.tv/oauth2/validate": () => [200, { client_id: CLIENT, login: "cadebot", expires_in: 3000 }],
    "POST https://id.twitch.tv/oauth2/revoke": () => [200, undefined],
  };
  const table = { ...base, ...handlers };
  const fetch = async (url, init = {}) => {
    const u = new URL(url);
    const method = init.method || "GET";
    const body = init.body ? new URLSearchParams(String(init.body)) : new URLSearchParams();
    const headers = init.headers || {};
    calls.push({ key: method + " " + u.origin + u.pathname, url: u, body, headers });
    const h = table[method + " " + u.origin + u.pathname];
    if (!h) return new Response(JSON.stringify({ message: "no fake for this" }), { status: 404 });
    const [status, data] = await h({ url: u, body, headers });
    return new Response(data === undefined ? "" : JSON.stringify(data), { status, headers: { "Content-Type": "application/json" } });
  };
  const timers = fakeTimers();
  const feature = createTwitchApp(ctx, { fetch, now: clock.now, timers });
  return { feature, store, calls, timers, clock, chat, logs, getSaved: () => saved, n };
}

const APP = { clientId: CLIENT, clientSecret: SECRET };
const oauthFile = (o = {}) => ({ login: "cadebot", userId: "999", clientId: CLIENT, access: "useraccess1", refresh: "userrefresh1", expiresAt: T0 + 14400 * 1000, scopes: ["chat:edit", "chat:read"], ...o });
const req = (ip = "1.2.3.4") => ({ headers: { "cf-connecting-ip": ip }, socket: { remoteAddress: "127.0.0.1" } });
const get = (f, route, query = "", ip) => f.feature.publicRoutes["GET " + route]({ url: new URL("http://x/api/stream/pub/twitchapp/" + route + query), req: req(ip) });
const noSecrets = (text, label) => { for (const s of SECRETS) assert.ok(!String(text).includes(s), `${label} must not contain ${s}`); };

async function connected(opts = {}) {
  const f = setupApp({ files: { [APP_FILE]: APP }, ...opts });
  const { json } = await f.feature.routes["GET connect"]({});
  const state = new URL(json.url).searchParams.get("state");
  const r = await get(f, "callback", `?code=goodcode&scope=chat%3Aread&state=${encodeURIComponent(state)}`);
  assert.equal(r.status, 200, r.body);
  return { ...f, state, page: r };
}

test("saving the app: checked with Twitch, the secret kept private", async () => {
  const f = setupApp();
  assert.equal((await f.feature.routes["POST app"]({ body: { clientId: "x", clientSecret: SECRET } })).status, 400);
  const wrong = await f.feature.routes["POST app"]({ body: { clientId: CLIENT, clientSecret: "wrongwrongwrongwrongwrong123" } });
  assert.equal(wrong.status, 400);
  assert.match(wrong.json.error, /didn't accept/);
  assert.equal(f.store.has(APP_FILE), false, "a refused app is not saved");
  const ok = await f.feature.routes["POST app"]({ body: { clientId: CLIENT, clientSecret: SECRET } });
  assert.deepEqual(ok.json, { ok: true, checked: true });
  assert.equal(JSON.parse(f.store.get(APP_FILE)).clientSecret, SECRET);
  const st = f.feature.state();
  assert.equal(st.app.saved, true);
  assert.equal(st.app.clientId, CLIENT);
  assert.equal(st.redirectUrl, REDIRECT);
  noSecrets(JSON.stringify(st), "state");
  noSecrets(f.logs.join("\n"), "logs");
  // same client ID, empty secret: keeps the saved one
  assert.equal((await f.feature.routes["POST app"]({ body: { clientId: CLIENT, clientSecret: "" } })).json.ok, true);
  assert.equal(JSON.parse(f.store.get(APP_FILE)).clientSecret, SECRET);
});

test("an app saved while Twitch can't be reached is kept, marked not checked", async () => {
  const f = setupApp({ handlers: { "POST https://id.twitch.tv/oauth2/token": () => { throw new Error("offline"); } } });
  const r = await f.feature.routes["POST app"]({ body: { clientId: CLIENT, clientSecret: SECRET } });
  assert.deepEqual(r.json, { ok: true, checked: false });
  assert.equal(f.feature.state().app.checked.ok, false);
});

test("Connect needs a saved app", async () => {
  const f = setupApp();
  const r = await f.feature.routes["GET connect"]({});
  assert.equal(r.status, 400);
  assert.match(r.json.error, /Save the Twitch app/);
});

test("the callback refuses a wrong state without calling Twitch", async () => {
  const f = setupApp({ files: { [APP_FILE]: APP } });
  await f.feature.routes["GET connect"]({});
  const r = await get(f, "callback", "?code=goodcode&state=madeup");
  assert.equal(r.status, 400);
  assert.match(r.body, /expired/);
  assert.equal(f.calls.length, 0);
  assert.equal(f.store.has(OAUTH_FILE), false);
});

test("Connect -> Twitch -> callback saves the login and the chat's bot file", async () => {
  const f = await connected();
  const tokenCall = f.calls.find((c) => c.key === "POST https://id.twitch.tv/oauth2/token");
  assert.equal(tokenCall.body.get("grant_type"), "authorization_code");
  assert.equal(tokenCall.body.get("redirect_uri"), REDIRECT);
  assert.equal(tokenCall.body.get("client_secret"), SECRET);
  const oauth = JSON.parse(f.store.get(OAUTH_FILE));
  assert.equal(oauth.login, "cadebot");
  assert.equal(oauth.access, "useraccess1");
  assert.equal(oauth.refresh, "userrefresh1");
  assert.equal(oauth.expiresAt, T0 + 14400 * 1000);
  assert.equal(f.store.get(BOT_FILE), "cadebot\nuseraccess1\n");
  assert.equal(f.chat.syncs, 1, "the chat is told at once");
  // the answer page
  assert.match(f.page.body, /Connected as cadebot/);
  noSecrets(f.page.body, "callback page");
  assert.match(f.page.headers["Content-Security-Policy"], /^default-src 'none'/);
  assert.match(f.page.headers["Content-Type"], /text\/html/);
  // the state was one-time
  const again = await get(f, "callback", `?code=goodcode&state=${encodeURIComponent(f.state)}`);
  assert.equal(again.status, 400);
  // state for the page: who, until when; never a token
  const st = f.feature.state();
  assert.equal(st.bot.connected, true);
  assert.equal(st.bot.login, "cadebot");
  noSecrets(JSON.stringify(st), "state");
  noSecrets(f.logs.join("\n"), "logs");
  // the renewal is planned: the hourly check first (the login lasts 4 hours)
  assert.equal(f.timers.pending().at(-1).ms, VALIDATE_EVERY_MS);
});

test("a state older than 10 minutes is refused", async () => {
  const f = setupApp({ files: { [APP_FILE]: APP } });
  const { json } = await f.feature.routes["GET connect"]({});
  f.clock.advance(STATE_TTL_MS + 1);
  const r = await get(f, "callback", `?code=goodcode&state=${new URL(json.url).searchParams.get("state")}`);
  assert.equal(r.status, 400);
  assert.equal(f.calls.length, 0);
});

test("saying no on Twitch changes nothing", async () => {
  const f = setupApp({ files: { [APP_FILE]: APP } });
  const { json } = await f.feature.routes["GET connect"]({});
  const st = new URL(json.url).searchParams.get("state");
  const r = await get(f, "callback", `?error=access_denied&error_description=The+user+denied+you+access&state=${st}`);
  assert.equal(r.status, 400);
  assert.match(r.body, /You said no/);
  assert.equal(f.store.has(OAUTH_FILE), false);
});

test("a bad login code shows a plain error with no secret in it", async () => {
  const f = setupApp({ files: { [APP_FILE]: APP } });
  const { json } = await f.feature.routes["GET connect"]({});
  const st = new URL(json.url).searchParams.get("state");
  const r = await get(f, "callback", `?code=badcode&state=${st}`);
  assert.equal(r.status, 502);
  assert.match(r.body, /connect: Twitch refused the login code \(400: Invalid authorization code\)/);
  noSecrets(r.body, "error page");
});

test("the callback is rate limited", async () => {
  const f = setupApp({ files: { [APP_FILE]: APP } });
  for (let i = 0; i < 10; i++) await get(f, "callback", "?state=x", "9.9.9.9");
  assert.equal((await get(f, "callback", "?state=x", "9.9.9.9")).status, 429);
  assert.equal((await get(f, "callback", "?state=x", "8.8.8.8")).status, 400, "another address still gets an answer");
  f.clock.advance(60000);
  assert.equal((await get(f, "callback", "?state=x", "9.9.9.9")).status, 400, "a minute later it works again");
});

test("strangers can't use up the owner's limits: there is no shared limit across addresses", async () => {
  const f = setupApp({ files: { [APP_FILE]: APP } });
  for (let i = 0; i < 100; i++) await get(f, "callback", "?state=x", `10.0.${i >> 8}.${i & 255}`);
  for (let i = 0; i < 400; i++) await get(f, "clips", "", `10.1.${i >> 8}.${i & 255}`);
  for (let i = 0; i < 400; i++) await get(f, "clips/list", "", `10.2.${i >> 8}.${i & 255}`);
  const { json } = await f.feature.routes["GET connect"]({});
  const st = new URL(json.url).searchParams.get("state");
  assert.equal((await get(f, "callback", `?code=goodcode&state=${st}`, "203.0.113.9")).status, 200, "the owner's callback still works");
  assert.equal((await get(f, "clips", "", "203.0.113.9")).status, undefined, "the owner's OBS still gets the page");
  assert.equal((await get(f, "clips/list", "", "203.0.113.9")).status, undefined, "and the clip list");
});

test("the callback's limit and the clips page's limits never block each other", async () => {
  const f = setupApp({ files: { [APP_FILE]: APP } });
  for (let i = 0; i < 20; i++) await get(f, "callback", "?state=x", "9.9.9.9"); // failed callback tries
  assert.equal((await get(f, "callback", "?state=x", "9.9.9.9")).status, 429);
  assert.equal((await get(f, "clips", "", "9.9.9.9")).status, undefined, "the clips page still loads from that address");
  assert.notEqual((await get(f, "clips/list", "", "9.9.9.9")).status, 429, "and its list");
  for (let i = 0; i < 40; i++) { await get(f, "clips", "", "7.7.7.7"); await get(f, "clips/list", "", "7.7.7.7"); }
  assert.equal((await get(f, "clips", "", "7.7.7.7")).status, 429);
  assert.equal((await get(f, "clips/list", "", "7.7.7.7")).status, 429);
  const { json } = await f.feature.routes["GET connect"]({});
  const st = new URL(json.url).searchParams.get("state");
  assert.equal((await get(f, "callback", `?code=goodcode&state=${st}`, "7.7.7.7")).status, 200, "the callback still works from that address");
});

test("the limits count IPv6 visitors per /64, from Cloudflare's address header", async () => {
  const f = setupApp({ files: { [APP_FILE]: APP } });
  for (let i = 1; i <= 10; i++) await get(f, "callback", "?state=x", "2001:db8:1:2::" + i.toString(16));
  assert.equal((await get(f, "callback", "?state=x", "2001:db8:1:2:abcd:ef01:2345:6789")).status, 429, "same /64: same visitor");
  assert.equal((await get(f, "callback", "?state=x", "2001:db8:1:3::1")).status, 400, "another /64 is another visitor");
});

test("clientKey: the visitor's address, IPv6 grouped by /64", () => {
  const r = (h, remote = "127.0.0.1") => ({ headers: h === undefined ? {} : { "cf-connecting-ip": h }, socket: { remoteAddress: remote } });
  assert.equal(clientKey(r("198.51.100.7")), "198.51.100.7");
  assert.equal(clientKey(r(" 198.51.100.7 ")), "198.51.100.7");
  assert.equal(clientKey(r(["198.51.100.8"])), "198.51.100.8");
  assert.equal(clientKey(r(undefined, "10.0.0.5")), "10.0.0.5", "no Cloudflare header: the connection's own address");
  assert.equal(clientKey(r(undefined, "::ffff:10.0.0.5")), "10.0.0.5");
  assert.equal(clientKey(r("not an address", "10.0.0.6")), "10.0.0.6");
  assert.equal(clientKey({}), "?");
  assert.equal(clientKey(r("198.51.100.7", "10.0.0.5")), "10.0.0.5", "SEC-PROG-21: the header counts only from this PC");
  assert.equal(clientKey(r("2001:DB8:1:2::1")), "2001:db8:1:2::/64");
  assert.equal(ipBucket("2001:0db8:0001:0002:0000:0000:0000:0001"), ipBucket("2001:db8:1:2:ffff::"));
  assert.notEqual(ipBucket("2001:db8:1:2::1"), ipBucket("2001:db8:1:3::1"));
  assert.equal(ipBucket("::ffff:203.0.113.9"), "203.0.113.9");
  assert.equal(ipBucket("::ffff:cb00:7109"), "203.0.113.9", "IPv4 written in hex is still IPv4");
  assert.equal(ipBucket("fe80::1%eth0"), "fe80:0:0:0::/64");
  assert.equal(ipBucket("[2001:db8::1]"), "2001:db8:0:0::/64");
  assert.equal(ipBucket("a:b::c:d:e:1.2.3.4"), "a:b:0:c::/64", "an IPv4 tail counts as two groups");
  assert.equal(ipBucket("::"), "0:0:0:0::/64");
  assert.equal(ipBucket("1.2.3"), null);
  assert.equal(ipBucket("2001:db8::g"), null);
  assert.equal(ipBucket(""), null);
  assert.equal(ipBucket(undefined), null);
});

test("the login is renewed 10 minutes before it runs out, and the bot file rewritten", async () => {
  const f = await connected();
  f.clock.advance(14400 * 1000 - REFRESH_LEAD_MS + 1000); // 9 min 40 s left
  await f.feature.internals.tick();
  const call = f.calls.findLast((c) => c.key === "POST https://id.twitch.tv/oauth2/token");
  assert.equal(call.body.get("grant_type"), "refresh_token");
  assert.equal(call.body.get("refresh_token"), "userrefresh1");
  assert.equal(f.store.get(BOT_FILE), "cadebot\nuseraccess2\n");
  const oauth = JSON.parse(f.store.get(OAUTH_FILE));
  assert.equal(oauth.refresh, "userrefresh2");
  assert.equal(oauth.expiresAt, f.clock.now() + 14400 * 1000);
  assert.equal(f.chat.syncs, 2);
  assert.equal(f.feature.state().bot.error, null);
  noSecrets(f.logs.join("\n"), "logs");
});

test("the exact timer renews too", async () => {
  const f = await connected();
  f.clock.advance(14400 * 1000 - REFRESH_LEAD_MS);
  await f.feature.internals.onTimer();
  assert.equal(f.store.get(BOT_FILE), "cadebot\nuseraccess2\n");
  // next one planned from the new expiry
  assert.equal(f.timers.pending().at(-1).ms, VALIDATE_EVERY_MS);
});

test("a refused renewal asks the owner to connect again, and stops trying", async () => {
  const g = setupApp({
    files: { [APP_FILE]: APP, [OAUTH_FILE]: oauthFile(), [BOT_FILE]: botFileText("cadebot", "useraccess1") },
    handlers: { "POST https://id.twitch.tv/oauth2/token": () => [400, { status: 400, message: `Invalid refresh token ${SECRET}` }] },
  });
  const r = await g.feature.internals.refreshNow("test");
  assert.equal(r.ok, false);
  const st = g.feature.state();
  assert.equal(st.bot.needsReconnect, true);
  assert.match(st.bot.error, /Connect bot account again/);
  noSecrets(JSON.stringify(st), "state");
  noSecrets(g.logs.join(" | "), "logs");
  assert.ok(g.logs.some((l) => l.includes("Invalid refresh token ***")), "Twitch's reason is logged with the secret taken out");
  assert.equal(g.timers.pending().length, 0, "no more timers once Twitch said no");
});

test("no internet during a renewal: try again in 2 minutes, not in a loop", async () => {
  const g = setupApp({
    files: { [APP_FILE]: APP, [OAUTH_FILE]: oauthFile({ expiresAt: T0 - 1 }), [BOT_FILE]: botFileText("cadebot", "useraccess1") },
    handlers: { "POST https://id.twitch.tv/oauth2/token": () => { throw new Error("ENOTFOUND"); } },
  });
  assert.equal(g.timers.pending().at(-1).ms, 5000, "a run-out login is renewed within seconds of starting");
  const r = await g.feature.internals.refreshNow("test");
  assert.match(r.error, /Couldn't reach Twitch/);
  assert.equal(g.feature.state().bot.needsReconnect, false);
  assert.ok(g.timers.pending().at(-1).ms >= RETRY_MS);
  const before = g.calls.length;
  await g.feature.internals.tick(); // too soon after the failure
  assert.equal(g.calls.length, before);
  g.clock.advance(RETRY_MS);
  await g.feature.internals.tick();
  assert.equal(g.calls.length, before + 1);
});

test("the hourly check renews a login Twitch stopped accepting", async () => {
  const g = setupApp({
    files: { [APP_FILE]: APP, [OAUTH_FILE]: oauthFile(), [BOT_FILE]: botFileText("cadebot", "useraccess1") },
    handlers: { "GET https://id.twitch.tv/oauth2/validate": () => [401, { status: 401, message: "invalid access token" }] },
  });
  g.clock.advance(VALIDATE_EVERY_MS);
  await g.feature.internals.tick();
  assert.ok(g.calls.some((c) => c.key === "GET https://id.twitch.tv/oauth2/validate"));
  assert.equal(g.store.get(BOT_FILE), "cadebot\nuseraccess2\n");
});

test("a renewal leaves a hand-made bot file for another account alone", async () => {
  const f = await connected();
  f.store.set(BOT_FILE, "otherbot\nhandmade\n");
  await f.feature.internals.refreshNow("test");
  assert.equal(f.store.get(BOT_FILE), "otherbot\nhandmade\n");
  assert.match(f.feature.state().bot.fileNote, /different account/);
});

test("Disconnect logs out at Twitch and deletes the token files", async () => {
  const f = await connected();
  const r = await f.feature.routes["POST disconnect"]({ body: {} });
  assert.equal(r.json.ok, true);
  const revoke = f.calls.find((c) => c.key === "POST https://id.twitch.tv/oauth2/revoke");
  assert.equal(revoke.body.get("token"), "useraccess1");
  assert.equal(f.store.has(OAUTH_FILE), false);
  assert.equal(f.store.has(BOT_FILE), false);
  assert.equal(f.store.has(APP_FILE), true, "the app stays");
  assert.equal(f.chat.syncs, 2);
  assert.equal(f.feature.state().bot.connected, false);
  assert.equal(f.timers.pending().length, 0);
});

test("Disconnect keeps a hand-made bot file for another account, and works offline", async () => {
  const f = await connected({ handlers: { "POST https://id.twitch.tv/oauth2/revoke": () => { throw new Error("offline"); } } });
  f.store.set(BOT_FILE, "otherbot\nhandmade\n");
  await f.feature.routes["POST disconnect"]({ body: {} });
  assert.equal(f.store.has(OAUTH_FILE), false);
  assert.equal(f.store.get(BOT_FILE), "otherbot\nhandmade\n");
});

test("removing the app keeps the bot login but warns it can't be renewed", async () => {
  const f = await connected();
  await f.feature.routes["POST app/remove"]({ body: {} });
  assert.equal(f.store.has(APP_FILE), false);
  const st = f.feature.state();
  assert.equal(st.app.saved, false);
  assert.match(st.bot.error, /app was removed/);
});

test("clips list: app token, the channel from chat, 3 pages max, filtered, public info only", async () => {
  const f = setupApp({ files: { [APP_FILE]: APP }, settings: { clips: { minViews: 10, days: 30, block: ["Clip20"] } } });
  const r = await get(f, "clips/list");
  assert.equal(r.status, undefined);
  const ids = r.json.clips.map((c) => c.id);
  assert.equal(ids.length, 300 - 10 - 1, "300 fetched, 10 under 10 views, 1 blocked");
  assert.ok(!ids.includes("Clip20"));
  assert.ok(!ids.includes("Clip300"), "nothing past 300");
  assert.deepEqual(Object.keys(r.json.clips[0]).sort(), ["creator", "date", "duration", "id", "title", "views"]);
  assert.equal(r.json.showTitle, true);
  noSecrets(JSON.stringify(r.json), "public clip list");
  const keys = f.calls.map((c) => c.key);
  assert.equal(keys.filter((k) => k === "POST https://id.twitch.tv/oauth2/token").length, 1);
  assert.equal(keys.filter((k) => k === "GET https://api.twitch.tv/helix/users").length, 1);
  assert.equal(keys.filter((k) => k === "GET https://api.twitch.tv/helix/clips").length, 3);
  const first = f.calls.find((c) => c.key === "GET https://api.twitch.tv/helix/clips");
  assert.equal(first.url.searchParams.get("broadcaster_id"), "1234");
  assert.ok(first.url.searchParams.get("started_at") && first.url.searchParams.get("ended_at"));
  assert.equal(first.headers.Authorization, "Bearer apptok1");
  assert.equal(first.headers["Client-Id"], CLIENT);
  // cached for 10 minutes
  await get(f, "clips/list");
  assert.equal(f.calls.length, keys.length);
  f.clock.advance(CLIPS_CACHE_MS);
  await get(f, "clips/list");
  assert.equal(f.calls.filter((c) => c.key === "GET https://api.twitch.tv/helix/users").length, 1, "the channel's ID is remembered");
  assert.ok(f.calls.length > keys.length, "asked again after 10 minutes");
  assert.equal(f.calls.filter((c) => c.key === "POST https://id.twitch.tv/oauth2/token").length, 1, "the app token is reused");
  const st = f.feature.state();
  assert.equal(st.clips.count, 289);
  assert.equal(st.clips.channel, "cade");
  noSecrets(JSON.stringify(st), "state");
});

test("collectPages: at most 5 pages and 300 clips, and it stops on an empty page or a repeated cursor", async () => {
  assert.equal(MAX_CLIP_PAGES, 5);
  const run = async (answer, opts) => {
    const asked = [];
    const items = await collectPages(async (after) => { asked.push(after); return answer(asked.length, after); }, opts);
    return { items, asked };
  };
  // short pages with a new cursor every time: 5 pages, then it stops
  let r = await run((n) => ({ data: [{ id: "c" + n }], pagination: { cursor: "p" + n } }));
  assert.equal(r.asked.length, 5);
  assert.deepEqual(r.asked, [null, "p1", "p2", "p3", "p4"]);
  assert.equal(r.items.length, 5);
  // empty pages that still send a cursor: one ask
  r = await run(() => ({ data: [], pagination: { cursor: "more" } }));
  assert.equal(r.asked.length, 1);
  assert.equal(r.items.length, 0);
  // an empty page after a good one stops it too
  r = await run((n) => ({ data: n === 1 ? [{ id: "a" }] : [], pagination: { cursor: "p" + n } }));
  assert.equal(r.asked.length, 2);
  // the same cursor again: stop
  r = await run(() => ({ data: [{ id: "x" }], pagination: { cursor: "same" } }));
  assert.deepEqual(r.asked, [null, "same"]);
  // a cursor from an earlier page (a loop of two): stop
  r = await run((n) => ({ data: [{ id: "x" + n }], pagination: { cursor: n % 2 ? "A" : "B" } }));
  assert.deepEqual(r.asked, [null, "A", "B"]);
  // no cursor, or a broken one: stop
  r = await run(() => ({ data: [{ id: "x" }], pagination: {} }));
  assert.equal(r.asked.length, 1);
  r = await run(() => ({ data: [{ id: "x" }], pagination: { cursor: 42 } }));
  assert.equal(r.asked.length, 1);
  r = await run(() => ({ data: "nonsense", pagination: { cursor: "c" } }));
  assert.equal(r.asked.length, 1);
  // 300 clips at most, even when one page sends far more than asked
  r = await run((n) => ({ data: makeClips(100), pagination: { cursor: "p" + n } }));
  assert.equal(r.asked.length, 3);
  assert.equal(r.items.length, 300);
  r = await run(() => ({ data: makeClips(5000), pagination: { cursor: "p" } }));
  assert.equal(r.asked.length, 1);
  assert.equal(r.items.length, 300);
});

test("the clip list stops asking Twitch after 5 short pages, or on an empty page or a repeated cursor", async () => {
  const count = (f) => f.calls.filter((c) => c.key === "GET https://api.twitch.tv/helix/clips").length;
  let n = 0;
  const short = setupApp({ files: { [APP_FILE]: APP }, handlers: { "GET https://api.twitch.tv/helix/clips": () => { n++; return [200, { data: [clip("S" + n)], pagination: { cursor: "c" + n } }]; } } });
  const r1 = await get(short, "clips/list");
  assert.equal(count(short), 5);
  assert.equal(r1.json.clips.length, 5);
  const empty = setupApp({ files: { [APP_FILE]: APP }, handlers: { "GET https://api.twitch.tv/helix/clips": () => [200, { data: [], pagination: { cursor: "again" } }] } });
  await get(empty, "clips/list");
  assert.equal(count(empty), 1);
  const same = setupApp({ files: { [APP_FILE]: APP }, handlers: { "GET https://api.twitch.tv/helix/clips": () => [200, { data: [clip("R1")], pagination: { cursor: "stuck" } }] } });
  const r3 = await get(same, "clips/list");
  assert.equal(count(same), 2);
  assert.deepEqual(r3.json.clips.map((c) => c.id), ["R1"], "the same clip twice plays once");
});

test("allow-list clips are fetched by ID; only-allow skips the channel", async () => {
  const f = setupApp({ files: { [APP_FILE]: APP }, settings: { clips: { onlyAllow: true, allow: ["OldGem-1", "OldGem-2"], minViews: 1000 } }, chatChannel: "" });
  const r = await get(f, "clips/list");
  assert.deepEqual(r.json.clips.map((c) => c.id), ["OldGem-1", "OldGem-2"]);
  const byId = f.calls.find((c) => c.key === "GET https://api.twitch.tv/helix/clips");
  assert.deepEqual(byId.url.searchParams.getAll("id"), ["OldGem-1", "OldGem-2"]);
  assert.ok(!f.calls.some((c) => c.key === "GET https://api.twitch.tv/helix/users"));
});

test("a settings change gets a fresh list; saving works from the page's shape", async () => {
  const f = setupApp({ files: { [APP_FILE]: APP } });
  assert.equal((await get(f, "clips/list")).json.clips.length, 300);
  const r = await f.feature.routes["POST clips/settings"]({ body: { channel: "", minViews: "100", days: "0", block: ["https://clips.twitch.tv/Clip150", "https://example.com/clip/Clip151"].join("\n"), allow: [], showTitle: false, onlyAllow: false } });
  assert.equal(r.json.ok, true);
  assert.deepEqual(r.json.bad, { block: 1, allow: 0 });
  assert.deepEqual(f.getSaved().clips.block, ["Clip150"]);
  assert.equal(f.getSaved().clips.days, 0);
  const list = await get(f, "clips/list");
  assert.equal(list.json.clips.length, 199, "Clip100..Clip299, minus the blocked one");
  assert.ok(!list.json.clips.some((c) => c.id === "Clip150"));
  assert.equal(list.json.showTitle, false);
  const q = f.calls.findLast((c) => c.key === "GET https://api.twitch.tv/helix/clips").url.searchParams;
  assert.equal(q.get("started_at"), null, "0 days = all time");
});

test("public clip list: generic errors, details only on the dashboard", async () => {
  const none = setupApp();
  const r1 = await get(none, "clips/list");
  assert.equal(r1.status, 503);
  assert.deepEqual(r1.json, { error: "No clips right now.", clips: [] });
  const f = setupApp({ files: { [APP_FILE]: APP }, handlers: { "GET https://api.twitch.tv/helix/clips": () => [500, { message: "Internal Server Error" }] } });
  const r2 = await get(f, "clips/list");
  assert.equal(r2.status, 503);
  assert.equal(r2.json.error, "No clips right now.");
  assert.match(f.feature.state().clips.error, /Twitch refused the clip list \(500/);
  const check = await f.feature.routes["GET clips/check"]({});
  assert.equal(check.status, 502);
});

test("a Twitch hiccup keeps the last good list playing", async () => {
  let fail = false;
  const g = setupApp({
    files: { [APP_FILE]: APP },
    handlers: { "GET https://api.twitch.tv/helix/clips": () => (fail ? [503, { message: "busy" }] : [200, { data: [clip("Keep1"), clip("Keep2")], pagination: {} }]) },
  });
  assert.equal((await get(g, "clips/list")).json.clips.length, 2);
  fail = true;
  g.clock.advance(CLIPS_CACHE_MS);
  const r = await get(g, "clips/list");
  assert.deepEqual(r.json.clips.map((c) => c.id), ["Keep1", "Keep2"]);
  assert.match(g.feature.state().clips.error, /busy/);
});

test("an app token Twitch stopped accepting is replaced once", async () => {
  let seen = 0;
  const f = setupApp({
    files: { [APP_FILE]: APP },
    handlers: {
      "GET https://api.twitch.tv/helix/users": ({ headers }) => (headers.Authorization === "Bearer apptok1" ? [401, { message: "Invalid OAuth token" }] : [200, { data: [{ id: "1234", login: "cade" }] }]),
      "GET https://api.twitch.tv/helix/clips": () => { seen++; return [200, { data: [clip("A1")], pagination: {} }]; },
    },
  });
  const r = await get(f, "clips/list");
  assert.deepEqual(r.json.clips.map((c) => c.id), ["A1"]);
  assert.equal(f.calls.filter((c) => c.key === "POST https://id.twitch.tv/oauth2/token").length, 2);
  assert.equal(seen, 1);
});

test("the public clip list and page are rate limited per address", async () => {
  const f = setupApp({ files: { [APP_FILE]: APP } });
  for (let i = 0; i < 30; i++) await get(f, "clips/list", "", "5.5.5.5");
  assert.equal((await get(f, "clips/list", "", "5.5.5.5")).status, 429);
  assert.notEqual((await get(f, "clips/list", "", "6.6.6.6")).status, 429);
  for (let i = 0; i < 30; i++) await get(f, "clips", "", "7.7.7.7");
  assert.equal((await get(f, "clips", "", "7.7.7.7")).status, 429);
});

test("the clips page: strict CSP, video from https only, no frames", async () => {
  const f = setupApp({ files: { [APP_FILE]: APP } });
  const r = await get(f, "clips");
  const csp = r.headers["Content-Security-Policy"];
  const nonce = csp.match(/script-src 'nonce-([^']+)'/)[1];
  assert.match(csp, /default-src 'none'/);
  assert.match(csp, /media-src https: 'self'/);
  assert.doesNotMatch(csp, /frame-src/);
  assert.match(csp, /connect-src 'self'/);
  assert.equal(csp, clipsCsp(nonce));
  assert.ok(r.body.includes(`<script nonce="${nonce}">`));
  assert.ok(r.body.includes(`<style nonce="${nonce}">`));
  assert.ok(!/ style="/.test(r.body), "no inline style attributes");
  assert.match(r.body, /"parents":\["arcadesandwich\.com"\]/);
  assert.match(r.body, /"list":"\/api\/stream\/pub\/twitchapp\/clips\/list"/);
  noSecrets(r.body, "clips page");
});

// Runs the player page's script with a pretend browser
async function runPlayer(clips, { showTitle = true, hostname = "arcadesandwich.com", localStorage } = {}) {
  const html = clipsPageHtml({ nonce: "n", parents: ["arcadesandwich.com"], listPath: "/api/stream/pub/twitchapp/clips/list" });
  const script = html.match(/<script nonce="n">([\s\S]*?)<\/script>/)[1];
  const frames = [];
  const timers = [];
  const fetched = [];
  const box = { textContent: "", hidden: true, append(x) { this.textContent += typeof x === "string" ? x : " " + x.textContent; } };
  const document = {
    getElementById: (id) => (id === "t" ? box : null),
    createElement: (tag) => {
      const e = { tag, attrs: {}, listeners: {}, textContent: "", removed: false, setAttribute(k, v) { this.attrs[k] = v; }, addEventListener(k, fn) { this.listeners[k] = fn; }, remove() { this.removed = true; } };
      if (tag === "video") { e.play = () => Promise.resolve(); e.pause = () => {}; frames.push(e); }
      return e;
    },
    body: { append() {} },
  };
  const sandbox = {
    document,
    location: { hostname },
    fetch: async (u) => { fetched.push(u); return { ok: true, json: async () => ({ clips, showTitle }) }; },
    setTimeout: (fn, ms) => { const t = { fn, ms, cleared: false }; timers.push(t); return t; },
    clearTimeout: (t) => { if (t) t.cleared = true; },
    setInterval: () => 0,
  };
  if (localStorage) sandbox.localStorage = localStorage;
  vm.runInNewContext(script, sandbox);
  for (let i = 0; i < 5; i++) await new Promise((r) => setImmediate(r));
  return { frames, timers, box, fetched };
}

test("the player plays each clip's video file with sound, and the next when it ends", async () => {
  const clips = [{ id: "A1", title: "First", duration: 20, views: 5, creator: "fan" }, { id: "B2", title: "Second", duration: 12.5, views: 9, creator: "" }];
  const p = await runPlayer(clips);
  assert.deepEqual(p.fetched, ["/api/stream/pub/twitchapp/clips/list"]);
  assert.equal(p.frames.length, 1);
  const f1 = p.frames[0];
  assert.match(f1.attrs.src, /^\/api\/stream\/pub\/twitchapp\/clips\/video\?id=(A1|B2)$/);
  assert.equal(f1.attrs.autoplay, "");
  assert.equal(f1.muted, false, "with sound");
  const c1 = clips.find((c) => f1.attrs.src.endsWith("id=" + c.id));
  assert.equal(p.box.hidden, false);
  assert.ok(p.box.textContent.startsWith(c1.title));
  f1.listeners.ended();
  const gap = p.timers.filter((t) => !t.cleared).at(-1);
  assert.equal(gap.ms, 1000);
  await gap.fn();
  assert.equal(p.frames.length, 2);
  assert.equal(f1.removed, true);
  assert.ok(!p.frames[1].attrs.src.endsWith("id=" + c1.id), "the other clip plays next");
  p.frames[1].listeners.error(); // a clip that can't play: skipped after 2 s
  assert.equal(p.timers.filter((t) => !t.cleared).at(-1).ms, 2000);
});

test("the player hides the title when asked", async () => {
  const p = await runPlayer([{ id: "A1", title: "First", duration: 5 }], { showTitle: false, hostname: "localhost" });
  assert.equal(p.box.hidden, true);
});

test("videoUrlFrom picks the best quality, signs it, and only trusts Twitch's hosts", () => {
  const ans = (url) => ({ data: { clip: { playbackAccessToken: { signature: "S", value: "V" }, videoQualities: [{ quality: "360", sourceURL: url.replace("Q", "360") }, { quality: "720", sourceURL: url.replace("Q", "720") }] } } });
  assert.match(videoUrlFrom(ans("https://d1ndex63qxojbr.cloudfront.net/x/Q/index.mp4")), /\/720\/index\.mp4\?sig=S&token=V$/);
  assert.equal(videoUrlFrom(ans("https://evil.example/x/Q/index.mp4")), null);
  assert.equal(videoUrlFrom(ans("http://clips.twitch.tv/Q.mp4")), null);
  assert.equal(videoUrlFrom({ data: { clip: null } }), null);
});

test("with no clips, the player stays empty and asks again in a minute", async () => {
  const p = await runPlayer([]);
  assert.equal(p.frames.length, 0);
  assert.equal(p.timers.at(-1).ms, 60000);
});

test("the page is told when the bot was connected (no secrets), so it can see a new connection", async () => {
  const f = await connected();
  const st = f.feature.state();
  assert.equal(st.bot.connectedAt, T0);
  noSecrets(JSON.stringify(st), "state");
  const old = setupApp({ files: { [APP_FILE]: APP, [OAUTH_FILE]: oauthFile() } }); // a login saved without the time
  assert.equal(old.feature.state().bot.connectedAt, null);
});

// ---------- the page part, with a pretend browser ----------
class FakeEl {
  constructor(tag) {
    this.tagName = tag.toUpperCase();
    this.attrs = {};
    this.children = [];
    this.listeners = {};
    this.className = "";
    this._text = "";
    this.value = "";
    this.disabled = false;
    const self = this;
    this.classList = {
      _set: () => new Set(self.className.split(/\s+/).filter(Boolean)),
      add(...cs) { const s = this._set(); for (const c of cs) s.add(c); self.className = [...s].join(" "); },
      remove(c) { const s = this._set(); s.delete(c); self.className = [...s].join(" "); },
      contains(c) { return this._set().has(c); },
      toggle(c, on) { if (on === undefined) on = !this.contains(c); if (on) this.add(c); else this.remove(c); return on; },
    };
  }
  setAttribute(k, v) { this.attrs[k] = String(v); if (k === "disabled") this.disabled = true; if (k === "id") this.id = String(v); }
  append(...c) { for (const x of c) { if (x instanceof FakeEl) x.parent = this; this.children.push(x); } }
  addEventListener(t, fn) { (this.listeners[t] ||= []).push(fn); }
  async fire(t, ev = {}) { for (const fn of this.listeners[t] || []) await fn({ preventDefault() {}, target: this, ...ev }); }
  click() { return this.fire("click"); }
  set textContent(v) { this._text = String(v); this.children = []; }
  get textContent() { return this._text + this.children.map((c) => (typeof c === "string" ? c : c.textContent)).join(""); }
  // like a real input: whatever is assigned comes back as a string
  get value() { return this._value ?? ""; }
  set value(v) { this._value = String(v ?? ""); }
  all() { return [this, ...this.children.flatMap((c) => (c instanceof FakeEl ? c.all() : []))]; }
  visible() { return !this.classList.contains("hidden") && (!this.parent || this.parent.visible()); }
}

// With `server` ({ s } from setupApp), IRLS.api reaches the real feature's routes the way server.mjs does (runFeatureRoute).
function loadTwitchPage({ server = null } = {}) {
  const code = fs.readFileSync(new URL("../public/features/twitchapp.js", import.meta.url), "utf8");
  const root = new FakeEl("div");
  const calls = [];
  const toasts = [];
  const hooks = [];
  let netDown = false;
  let answer = () => ({ ok: true });
  if (server) {
    const desc = { name: "twitchapp", routes: server.s.feature.routes, publicRoutes: {}, state: server.s.feature.state };
    answer = async (p, opts = {}) => {
      if (netDown) throw new Error("Can't reach the dashboard.");
      const m = p.match(/^x\/(.+)$/);
      const hit = m && findRoute([desc], "private", opts.body !== undefined ? "POST" : "GET", m[1]);
      if (!hit) throw new Error("not found");
      let r;
      try { r = (await hit.handler({ url: new URL("http://x/api/stream/" + p), body: opts.body ?? null, rest: hit.rest })) || {}; }
      catch (err) { r = { status: 502, json: { error: err.message } }; }
      const status = r.status || 200;
      const json = r.json !== undefined ? r.json : { ok: true };
      if (status >= 400) throw new Error((json && json.error) || "Error " + status);
      return JSON.parse(JSON.stringify(json));
    };
  }
  let popup = null; // what window.open gives back (null: the phone blocked the new tab)
  let t = T0;
  const RealDate = Date;
  class FakeDate extends RealDate {
    constructor(...a) { if (a.length) super(...a); else super(t); }
    static now() { return t; }
  }
  const el = (tag, props = {}, ...children) => {
    const e = new FakeEl(tag);
    for (const [k, v] of Object.entries(props || {})) {
      if (k === "class") e.className = v;
      else if (k === "text") e.textContent = v;
      else if (v === true) e.setAttribute(k, "");
      else if (v !== false && v != null) e.setAttribute(k, v);
    }
    for (const c of children.flat()) if (c != null) e.append(c instanceof FakeEl ? c : String(c));
    return e;
  };
  const IRLS = {
    el,
    card: ({ id, title }) => { root.id = id; root.title = title; return root; },
    css: () => {},
    onRender: (fn) => hooks.push(fn),
    api: async (p, opts) => { calls.push({ p, opts }); return answer(p, opts); },
    toast: (m) => toasts.push(m),
    linkButton: (text, href) => { const a = el("a", { class: "button", text }); a.href = href; return a; },
    copyRow: (label, value) => el("div", { class: "copyrow", text: label + " " + value }),
  };
  const window = { open: () => popup };
  // The page's timers (the 4 s disarm) run on the test's clock
  const timers = [];
  let timerId = 0;
  const setTimeoutF = (fn, ms) => { const id = ++timerId; timers.push({ id, at: t + (ms || 0), fn }); return id; };
  const clearTimeoutF = (id) => { const i = timers.findIndex((x) => x.id === id); if (i >= 0) timers.splice(i, 1); };
  vm.runInNewContext(code, { IRLS, window, document: { activeElement: null }, Date: FakeDate, console, setTimeout: setTimeoutF, clearTimeout: clearTimeoutF });
  const all = () => root.all();
  const stateNow = () => {
    let st;
    try { st = server.s.feature.state(); } catch (err) { st = { error: err.message }; }
    return { now: t, features: { twitchapp: st } };
  };
  return {
    root, calls, toasts,
    render: (s = stateNow()) => { hooks.forEach((fn) => fn({ ...s, now: t })); return s; },
    advance: async (ms) => {
      const end = t + ms;
      for (;;) {
        const due = timers.filter((x) => x.at <= end).sort((a, b) => a.at - b.at)[0];
        if (!due) break;
        t = due.at; timers.splice(timers.indexOf(due), 1); await due.fn();
      }
      t = end;
    },
    setAnswer: (fn) => { answer = fn; },
    setNetDown: (v) => { netDown = v; },
    buttons: () => all().filter((e) => e.tagName === "BUTTON"),
    inputs: () => all().filter((e) => ["INPUT", "TEXTAREA"].includes(e.tagName)),
    byId: (id) => all().find((e) => e.id === id),
    setPopup: (w) => { popup = w; },
    button: (re) => all().find((e) => e.tagName === "BUTTON" && re.test(e.textContent)),
    openLink: () => all().find((e) => e.tagName === "A" && e.textContent === "Open Twitch to approve"),
    hint: () => all().find((e) => e.tagName === "P" && /^Approve on Twitch/.test(e._text)) || null,
  };
}
const AUTH_URL = "https://id.twitch.tv/oauth2/authorize?client_id=x&state=onetime";
const botOn = (o = {}) => ({ connected: true, login: "cadebot", connectedAt: T0 - 3600 * 1000, expiresAt: T0 + 3 * 3600 * 1000, expired: false, needsReconnect: false, error: null, fileNote: null, canReply: true, chatOn: true, ...o });
const pageView = (bot) => ({ features: { twitchapp: { redirectUrl: REDIRECT, playerUrl: BASE + "/api/stream/pub/twitchapp/clips", app: { saved: true, clientId: CLIENT, checked: { ok: true } }, bot, clips: { settings: DEFAULT_CLIPS, channel: "cade", defaultChannel: "cade", count: null } } } });

test("page: \"Connect again\" keeps the fallback link and hint while the owner is still approving", async () => {
  const p = loadTwitchPage();
  p.render(pageView(botOn()));
  const btn = p.button(/^Connect again$/);
  assert.ok(btn, "a connected bot shows Connect again");
  p.setAnswer((path) => (path === "x/twitchapp/connect" ? { url: AUTH_URL } : { ok: true }));
  await btn.click(); // the phone blocked the new tab: the link is the way to Twitch
  assert.equal(p.calls.at(-1).p, "x/twitchapp/connect");
  const link = p.openLink();
  assert.equal(link.classList.contains("hidden"), false);
  assert.equal(link.href, AUTH_URL);
  const hint = p.hint();
  assert.ok(hint, "the hint says what to do");
  for (const ms of [1000, 60 * 1000, 4 * 60 * 1000, 4 * 60 * 1000]) { // the updates go on while still approving
    p.advance(ms);
    p.render(pageView(botOn()));
    assert.equal(link.classList.contains("hidden"), false, "the link stays while waiting");
    assert.match(hint.textContent, /^Approve on Twitch/, "the hint stays while waiting");
  }
  p.render(pageView(botOn({ connectedAt: T0 + 9 * 60 * 1000 }))); // the new connection went through
  assert.equal(link.classList.contains("hidden"), true);
  assert.equal(hint.textContent, "");
});

test("page: the Connect link and hint go away after 10 minutes without a connection", async () => {
  const p = loadTwitchPage();
  p.render(pageView(botOn()));
  p.setAnswer(() => ({ url: AUTH_URL }));
  await p.button(/^Connect again$/).click();
  const link = p.openLink();
  const hint = p.hint();
  p.advance(10 * 60 * 1000 - 1000);
  p.render(pageView(botOn()));
  assert.equal(link.classList.contains("hidden"), false);
  p.advance(1000);
  p.render(pageView(botOn()));
  assert.equal(link.classList.contains("hidden"), true, "the link ran out");
  assert.equal(hint.textContent, "");
});

test("page: a first connection with the new tab open; a failed Connect shows the reason", async () => {
  const p = loadTwitchPage();
  const notConnected = { connected: false, error: null, chatOn: true };
  p.render(pageView(notConnected));
  const tab = { closed: false, opener: {}, location: { href: "" } };
  p.setPopup(tab);
  p.setAnswer(() => ({ url: AUTH_URL }));
  await p.button(/^Connect bot account$/).click();
  assert.equal(tab.location.href, AUTH_URL, "the new tab goes to Twitch");
  assert.equal(tab.opener, null);
  assert.equal(p.openLink().classList.contains("hidden"), true, "no fallback link needed");
  const hint = p.hint();
  p.advance(60 * 1000);
  p.render(pageView(notConnected));
  assert.match(hint.textContent, /^Approve on Twitch/);
  p.render(pageView(botOn({ connectedAt: T0 + 60 * 1000 })));
  assert.equal(hint.textContent, "", "connected: the hint is gone");

  p.setPopup(null);
  p.setAnswer(() => { throw new Error("Save the Twitch app's client ID and secret first."); });
  await p.button(/^Connect again$/).click();
  assert.match(p.toasts.at(-1), /Save the Twitch app/);
  assert.equal(p.openLink().classList.contains("hidden"), true);
});

test("stop() leaves no timers behind, the 5-minute check included", async () => {
  const f = await connected();
  const ticks = f.timers.pendingIntervals();
  assert.equal(ticks.length, 1, "one safety check runs while the feature is on");
  assert.equal(ticks[0].ms, TICK_MS);
  assert.equal(TICK_MS, 5 * 60 * 1000);
  assert.ok(f.timers.pending().length > 0, "the renewal timer is planned");
  f.feature.stop();
  assert.equal(f.timers.pending().length, 0);
  assert.equal(f.timers.pendingIntervals().length, 0, "the 5-minute check was cleared");
  assert.equal(ticks[0].cleared, true);
  // even if a last tick still fires, it does nothing once stopped
  f.clock.advance(14400 * 1000);
  const before = f.calls.length;
  ticks[0].fn();
  await new Promise((r) => setImmediate(r));
  assert.equal(f.calls.length, before);
});

test("featured only asks Twitch for featured clips (off by default); the corner shows views", async () => {
  assert.match(clipsQuery({ broadcasterId: "1", days: 0, featured: true }), /is_featured=true/);
  assert.doesNotMatch(clipsQuery({ broadcasterId: "1", days: 0 }), /is_featured/);
  assert.equal(cleanClipSettings({}).settings.featuredOnly, false);
  assert.equal(cleanClipSettings({ featuredOnly: false }).settings.featuredOnly, false);
  const p = await runPlayer([{ id: "A1", title: "First", duration: 5, views: 12345, creator: "fan", date: "2025-03-12" }]);
  assert.match(p.box.textContent, /Clipped by fan 12\.3K views · 12 Mar 2025/); // two lines: who, then views · date
});

test("auto clips (made by the channel itself) are skipped unless featured or allowed", () => {
  const base = { broadcaster_id: "B", view_count: 5, created_at: "2026-10-01T00:00:00Z", duration: 10, title: "t" };
  const raw = [
    { ...base, id: "viewer1", creator_id: "V" },
    { ...base, id: "auto1", creator_id: "B" },
    { ...base, id: "autoFeat", creator_id: "B", is_featured: true },
    { ...base, id: "autoAllowed", creator_id: "B" },
  ];
  const s = { ...cleanClipSettings({}).settings, days: 0, allow: ["autoAllowed"] };
  assert.deepEqual(filterClips(raw, s).map((c) => c.id), ["viewer1", "autoFeat", "autoAllowed"]);
  assert.equal(filterClips(raw, { ...s, skipAuto: false }).length, 4);
});

test("the player never repeats a clip from the last 50 played (remembered across refreshes)", async () => {
  const clips = Array.from({ length: 60 }, (_, i) => ({ id: "C" + i, title: "t", duration: 5 }));
  const store = {};
  const ls = { getItem: (k) => store[k] ?? null, setItem: (k, v) => { store[k] = v; } };
  const played = [];
  for (let refresh = 0; refresh < 3; refresh++) {
    const p = await runPlayer(clips, { localStorage: ls });
    for (let i = 0; i < 20; i++) {
      p.frames.at(-1).listeners.ended();
      await p.timers.filter((t) => !t.cleared).at(-1).fn();
    }
    played.push(...p.frames.map((f) => f.attrs.src.split("id=")[1])); // every clip that started, the last one too
  }
  for (let i = 0; i < played.length; i++) {
    const window = played.slice(Math.max(0, i - 49), i);
    assert.ok(!window.includes(played[i]), `clip ${played[i]} came back within 50 (at ${i})`);
  }
});

// ================= the page wired to the real server part =================
function prng(seed) {
  let a = seed >>> 0;
  const next = () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  return { next, int: (n) => Math.floor(next() * n), pick: (arr) => arr[Math.floor(next() * arr.length)], chance: (p) => next() < p };
}
const pageSecrets = (p) => SECRETS.filter((s) => p.root.textContent.includes(s) || p.inputs().some((i) => i.value.includes(s) && i.id !== "taSecret"));

test("page + server: saving the app (blank, wrong, right), Connect once on a double tap, clip settings, Check clips and Remove app", async () => {
  const s = setupApp();
  const p = loadTwitchPage({ server: { s } });
  p.render();
  const connect = p.button(/^Connect bot account$/);
  assert.equal(connect.disabled, true, "no app yet: Connect is locked");
  assert.match(p.root.textContent, /Not saved yet\. Make the app/);
  // Blank boxes: the server's words, nothing saved
  await p.button(/^Save app$/).click();
  assert.match(p.root.textContent, /The client ID looks wrong/);
  assert.equal(s.store.has(APP_FILE), false);
  // A wrong secret: Twitch says no
  p.byId("taClientId").value = CLIENT;
  p.byId("taSecret").value = "wrongsecretwrongsecretwrongsecret";
  await p.button(/^Save app$/).click();
  assert.match(p.root.textContent, /Twitch didn't accept this client ID and secret/);
  assert.equal(s.store.has(APP_FILE), false);
  // The right one: saved and checked; the secret box is wiped
  p.byId("taSecret").value = SECRET;
  await p.button(/^Save app$/).click();
  assert.match(p.root.textContent, /Saved\. Twitch accepted it\./);
  assert.equal(p.byId("taSecret").value, "");
  assert.deepEqual(pageSecrets(p), [], "the secret never shows");
  p.render();
  assert.equal(connect.disabled, false);
  assert.match(p.root.textContent, new RegExp(`Saved \\(client ID ${CLIENT}\\)`));
  // Connect: a double tap opens one tab and asks the server once
  const tab = { closed: false, opener: {}, location: { href: "" } };
  p.setPopup(tab);
  const before = p.calls.length;
  await Promise.all([connect.click(), connect.click()]);
  assert.equal(p.calls.slice(before).filter((c) => c.p === "x/twitchapp/connect").length, 1);
  assert.match(tab.location.href, /^https:\/\/id\.twitch\.tv\/oauth2\/authorize\?/);
  assert.equal(connect.disabled, false, "unlocked again (the app is saved)");
  // Clip settings: a pasted link becomes an ID; nonsense is counted
  p.byId("taChannel").value = "https://www.twitch.tv/Cade/clips";
  p.byId("taMinViews").value = "25";
  p.byId("taBlock").value = "https://clips.twitch.tv/AbcDef-123\n<nonsense>";
  await p.byId("taBlock").fire("input");
  assert.match(p.root.textContent, /Not saved yet/);
  await p.button(/^Save clip settings$/).click();
  assert.match(p.root.textContent, /Saved\. 1 line didn't look like a clip link or ID and was left out/);
  assert.equal(s.getSaved().clips.channel, "cade");
  assert.equal(s.getSaved().clips.minViews, 25);
  assert.deepEqual(s.getSaved().clips.block, ["AbcDef-123"]);
  // Check clips asks Twitch and says how many
  await p.button(/^Check clips$/).click();
  assert.match(p.root.textContent, /\d+ clips ready to play/);
  // Remove app takes two taps
  p.render();
  const rm = p.button(/^Remove app$/);
  await rm.click();
  assert.equal(rm.textContent, "Tap again to remove the app");
  await rm.click();
  assert.equal(s.store.has(APP_FILE), true, "a double tap did nothing");
  await p.advance(650);
  await rm.click();
  assert.equal(s.store.has(APP_FILE), false);
  assert.match(p.toasts.at(-1), /Twitch app removed/);
  p.render();
  assert.equal(connect.disabled, true);
  s.feature.stop();
});

test("page + server: a connected bot shows its login; Disconnect takes two taps; Try renewing shows only when it's needed", async () => {
  const s = setupApp({ files: { [APP_FILE]: APP, [OAUTH_FILE]: oauthFile({ expiresAt: T0 + 5 * 60 * 1000 }) } });
  const p = loadTwitchPage({ server: { s } });
  p.render();
  assert.match(p.root.textContent, /Connected as cadebot/);
  assert.equal(p.button(/^Try renewing now$/).visible(), false, "renewing is the server's job while the login is fine");
  const dis = p.button(/^Disconnect$/);
  assert.ok(dis.visible());
  await dis.click();
  assert.equal(dis.textContent, "Tap again to disconnect");
  await p.advance(650);
  await dis.click();
  assert.match(p.toasts.at(-1), /Bot account disconnected/);
  assert.equal(s.store.has(OAUTH_FILE), false);
  p.render();
  assert.match(p.root.textContent, /Not connected\. Chat commands still work/);
  assert.equal(dis.visible(), false);
  s.feature.stop();
});

test("page: a server part that only reports an error never throws, and odd answers are said plainly", async () => {
  const p = loadTwitchPage();
  assert.doesNotThrow(() => p.render({ features: { twitchapp: { error: "boom" } } }));
  assert.match(p.root.textContent, /This card had a problem on the server: boom/);
  assert.doesNotThrow(() => p.render({ features: {} }));
  assert.doesNotThrow(() => p.render({ features: { twitchapp: {} } }));
  // A clip-settings answer without the "bad" counts (an older server) still says Saved
  p.render(pageView({ connected: false, error: null, chatOn: true }));
  p.setAnswer(() => ({ ok: true }));
  await p.button(/^Save clip settings$/).click();
  assert.match(p.root.textContent, /Saved\. The player picks it up within 10 minutes/);
  // Connect with an answer that isn't Twitch's address: no tab is sent anywhere
  const tab = { closed: false, opener: {}, location: { href: "" } };
  p.setPopup(tab);
  p.setAnswer(() => ({ url: "javascript:alert(1)" }));
  await p.button(/^Connect bot account$/).click();
  assert.equal(tab.location.href, "");
  assert.match(p.toasts.at(-1), /didn't send Twitch's address/);
});

test("page fuzz: 300 random taps, edits, updates and faults never throw, leak nodes or secrets, or leave the card out of step", async () => {
  for (const seed of [61, 62, 63]) {
    const rnd = prng(seed);
    const s = setupApp({ files: rnd.chance(0.5) ? { [APP_FILE]: APP } : {} });
    const p = loadTwitchPage({ server: { s } });
    const unhandled = [];
    const onUnhandled = (e) => unhandled.push(e);
    process.on("unhandledRejection", onUnhandled);
    p.render();
    const base = p.root.all().length;
    const inflight = new Set();
    const texts = ["", "cade", CLIENT, "https://clips.twitch.tv/AbcDef-123", "x y", "12", "-3", "a".repeat(300), "https://www.twitch.tv/Cade/clips"];
    try {
      for (let i = 0; i < 300; i++) {
        const what = rnd.int(10);
        if (what < 5) {
          const list = p.buttons().filter((b) => b.visible() && !b.disabled);
          if (list.length) { const pr = rnd.pick(list).click(); inflight.add(pr); pr.finally(() => inflight.delete(pr)); if (rnd.chance(0.7)) await pr; }
        } else if (what < 7) {
          const list = p.inputs().filter((e) => e.visible());
          if (list.length) {
            const e = rnd.pick(list);
            if (e.attrs.type === "checkbox") { e.checked = !e.checked; await e.fire("change"); }
            else { e.value = e.id === "taSecret" ? rnd.pick([SECRET, "short", ""]) : rnd.pick(texts); await e.fire("input"); }
          }
        } else if (what < 9) {
          const r = rnd.int(5);
          if (r === 0) p.setNetDown(rnd.chance(0.3));
          if (r === 1) p.setPopup(rnd.chance(0.5) ? null : { closed: false, opener: {}, location: { href: "" } });
          if (r === 2) { s.clock.advance(rnd.pick([1000, 60000, 31 * 60 * 1000])); await p.advance(rnd.pick([100, 650, 4100])); }
          if (r === 3) s.chat.state.canReply = !s.chat.state.canReply;
          if (r === 4) { // Twitch itself sends the owner back (a good or a bad code)
            const st = s.feature.internals.states.create(s.clock.now());
            await s.feature.publicRoutes["GET callback"]({ url: new URL(`${REDIRECT}?code=${rnd.chance(0.6) ? "goodcode" : "badcode"}&state=${st}`), req: req() });
          }
          p.render();
        } else {
          await new Promise((r) => setImmediate(r));
          p.render();
        }
        assert.ok(p.root.all().length < base + 60, `node count grew to ${p.root.all().length} at step ${i} (seed ${seed})`);
        assert.deepEqual(pageSecrets(p), [], `no secret on the page (seed ${seed}, step ${i})`);
      }
      p.setNetDown(false);
      await Promise.allSettled([...inflight]);
      await p.advance(4100);
      const st = p.render().features.twitchapp;
      const connect = p.button(/^Connect bot account$|^Connect again$/);
      assert.equal(connect.disabled, !st.app.saved, `Connect follows whether an app is saved (seed ${seed})`);
      assert.equal(p.button(/^Remove app$/).visible(), st.app.saved, `Remove app shows only with a saved app (seed ${seed})`);
      assert.equal(p.button(/^Disconnect$/).visible(), Boolean(st.bot.connected), `Disconnect shows only when connected (seed ${seed})`);
      for (const b of p.buttons()) assert.ok(!b.classList.contains("armed"), `nothing stays armed (seed ${seed})`);
      assert.deepEqual(unhandled, [], `no unhandled rejection (seed ${seed})`);
      noSecrets(JSON.stringify(st), "state");
      noSecrets(s.logs.join("\n"), "log");
    } finally {
      process.off("unhandledRejection", onUnhandled);
      s.feature.stop();
    }
  }
});

test("server: two app saves at once, alternating clip saves, two disconnects and two renewals leave one consistent result", async () => {
  const s = setupApp({ files: { [APP_FILE]: APP, [OAUTH_FILE]: oauthFile({ expiresAt: T0 + 5 * 60 * 1000 }) } });
  const r = s.feature.routes;
  const a = await Promise.all([r["POST app"]({ body: { clientId: CLIENT, clientSecret: SECRET } }), r["POST app"]({ body: { clientId: CLIENT, clientSecret: "" } })]);
  assert.ok(a.every((x) => x.json.ok));
  assert.equal(JSON.parse(s.store.get(APP_FILE)).clientSecret, SECRET, "an empty secret box kept the saved one");
  const c = await Promise.all([
    r["POST clips/settings"]({ body: { channel: "cade", minViews: 5 } }),
    r["POST clips/settings"]({ body: { block: ["A1"] } }),
    r["POST clips/settings"]({ body: { minViews: 9 } }),
    r["POST clips/settings"]({ body: { allow: ["B2"], onlyAllow: true } }),
  ]);
  assert.ok(c.every((x) => x.json.ok));
  const cs = s.getSaved().clips;
  assert.equal(cs.channel, "cade"); assert.equal(cs.minViews, 9); assert.deepEqual(cs.block, ["A1"]); assert.deepEqual(cs.allow, ["B2"]); assert.equal(cs.onlyAllow, true);
  const rn = await Promise.all([r["POST refresh"]({}), r["POST refresh"]({})]);
  assert.ok(rn.every((x) => x.json.ok));
  assert.equal(s.calls.filter((x) => x.body.get("grant_type") === "refresh_token").length, 1, "one renewal, shared");
  const d = await Promise.all([r["POST disconnect"]({}), r["POST disconnect"]({})]);
  assert.ok(d.every((x) => x.json.ok));
  assert.equal(s.store.has(OAUTH_FILE), false);
  assert.equal(s.calls.filter((x) => x.key.endsWith("/revoke")).length, 1, "logged out once");
  assert.equal(s.feature.state().bot.connected, false);
  s.feature.stop();
});
