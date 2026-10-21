# SEC-NET-36: an email-code login (Cloudflare Access) in front of live.arcadesandwich.com

Status: reviewed-security
For: Q-LIVE-LOCK (the Admin's choice). The IRL dashboard (IRLToolkit's, `C:\irl-stream\dashboard`, 127.0.0.1:3002) keeps its own password. Access adds a second lock in front of it. Owner of the steps: the Admin, in the Cloudflare dashboard (Zero Trust). Outside check: Security · Network (SEC-NET-37). Recheck of the steps: Security · Resilience (SEC-NET-38). Never touches play.arcadesandwich.com.

## What must stay reachable without the email login (IRLToolkit's list, checked in the code)
| Path | What it is | What it returns (code read 2026-10-21) |
|---|---|---|
| `/api/stream/pub/twitchapp/clips` | the OBS "CLIP SHOWCASE" browser source page | an HTML page with a nonce CSP. No data in it: it fetches the list below. Rate-limited. |
| `/api/stream/pub/twitchapp/clips/list` | the clip list for that page | public Twitch clip info only (ids, titles, as Twitch shows them) and showTitle. On error it says only "No clips right now". Rate-limited. |
| `/api/stream/pub/twitchapp/clips/video?id=` | one clip's video | a 302 to Twitch's own signed video link (twitch, twitchcdn, jtvnw or cloudfront hosts only), and only for ids in the current list. The `token` in that link is Twitch's public playback token, not ours. Rate-limited. |
| `/api/stream/pub/twitchapp/callback` | the Twitch login return (the Admin's browser) | It checks a **one-time state**: made by the logged-in owner, stored as a hash, compared in constant time, valid for 10 minutes and used once. Then it checks the code's format, exchanges the code, and answers with a small page that escapes all its text and holds no secret. 10 tries per minute. |
| `/api/stream/ws/obsremote/<key>` | OBS remote apps (WebSocket) | It refuses plain ws:// (and flags the key as leaked), refuses when the feature is off, and **refuses a wrong key with a per-address try limit**. It also needs OBS's own WebSocket password (it refuses when OBS has none), and caps the number of connections. |
| `/api/stream/overlay` | the OBS overlay page | It is GET only, holds no data, and is served with its own CSP: read-only. |
| `/api/stream/musta/ws/obsremote/<key>` | Musta's OBS remote apps (WebSocket; the Admin's yes, 2026-10-21) | The tower hands only this one WebSocket path on to Musta's dashboard, matched by an anchored pattern (`^/api/stream/<channel>/ws/obsremote/`), for known channels only. At most **8 hand-offs** are open at once (STREAM_HANDOFF_MAX), because they are made before the key check. Musta's dashboard then checks a **32-byte random key**, allows **10 wrong tries per CF-Connecting-IP**, refuses ws://, and needs **OBS's own WebSocket password** as lock 2. |

The code has no other public route. `/api/stream/pub/*` is served only from the features' "public" tables, and today only twitchapp has any. Everything else needs the dashboard login (401 otherwise).

**Musta's channel:** the dashboard passes `/stream?c=musta` and `/api/stream/musta/...` to Musta's own dashboard. Those stay behind the email login (people use them). **Checked for browser sources: none needed** (IRLToolkit, 2026-10-21). **Musta's OBS remote got its own bypass app** on the Admin's yes (the fourth one, in the table above).
- Musta's OBS loads nothing through the dashboard: it has no browser sources, its media sources read SRT straight from the stream VM, and its remote control is 127.0.0.1:4455.
- **IRLToolkit tells Security before any overlay or clips source is added for Musta.** That source would use `/api/stream/musta/pub/...` or `/api/stream/musta/overlay`, and would then need its own bypass app.

## Why separate Bypass apps, not Bypass policies
An Access policy applies to its whole app; it can't be limited to a path. So each public path gets **its own small Access application with one Bypass policy**. Access uses the most specific matching app for a request: `live.arcadesandwich.com/api/stream/pub/*` wins over the main `live.arcadesandwich.com` app for those paths only. That is the robust way: a bypass can never widen beyond its own path.

## Can the bypass paths be stepped around?
- **Case** (`/API/stream/pub/...`, `/api/stream/PUB/...`): the dashboard's routes are lower-case and case-sensitive. A case trick either misses the bypass app, so the login is asked, or misses the route, so 404. Nothing private opens either way.
- **Dot segments** (`/api/stream/pub/../x/...`):
  - Cloudflare's URL normalization (Rules, Settings, "Normalize incoming URLs", on by default) resolves them before Access sees the path. **Check that it is on.**
  - Even if it weren't, the dashboard resolves `..` the same way and lands on a private route, which needs the dashboard login (401). The second lock holds.
- **`%2F` and `//`:**
  - The dashboard reads the path undecoded, so `pub%2F..%2Fx` doesn't start with `pub/` and falls to the login check (401).
  - `//` is not collapsed; `/api/stream//pub/...` misses `pub/`, so 401 or 404.
- **What else falls under a bypass:** only paths below those three prefixes.
  - An Access path also covers what lies under it. Cloudflare's application paths doc says a path with no rule of its own "will inherit any rules set for" its parent path. So the overlay bypass also covers `/api/stream/overlay/...`.
  - That is safe: the dashboard serves `overlay` only as an exact route (server.mjs: `route === "overlay"`), and there is nothing below it. A request to `/api/stream/overlay/<anything>` falls to the dashboard's login check and gets 401.

## The OBS remote key in the wss URL
- The key is part of the path. Cloudflare can show request paths in its analytics and security events, and in logs if Logpush is ever set up (not on today's plan), so the key could be seen by anyone with access to the Cloudflare account.
- That is the Admin and nobody else, so it matters little. Still:
  - keep the OBS remote feature **off when not in use** (it refuses everything while off);
  - **tap "New address"** (a new key) whenever the address has been pasted anywhere, shared, or seen in a screenshot;
  - OBS's own WebSocket password stays the second lock.

## The run order (Server's OR345)
1. **The Admin:** One-time PIN, the main Access app, the four bypass apps and the URL normalization check (steps 1 to 4 below).
2. **The Admin:** the live.* hostname on the tunnel (step 5 below).
3. **IRLToolkit:** moves the OBS "CLIP SHOWCASE" source to live.*, and checks that it loads. It is a bypassed path, so it works under Access.
4. **The Admin:** adds `https://live.arcadesandwich.com/api/stream/pub/twitchapp/callback` as an OAuth Redirect URL in the Twitch developer console (dev.twitch.tv, the app). Keep the old one until the switch is done, then remove it.
5. **Server:** GO for OR345 (a) and (a2) together, plus OR346 (the game's IRL button), then the deploy:
   - the game stops passing `/api/stream/*` and the WebSocket to 3002;
   - `arcadesandwich.com/stream` stays only as a 308 forward to live.* (no backend) for the Admin's 30 days.
6. **Security · Network, SEC-NET-37 from outside, on both hosts:**
   - live.*: Access on everything except the four bypasses;
   - `arcadesandwich.com/api/stream/*` and the ws path: 404, or no longer reaching 3002;
   - `arcadesandwich.com/stream`: a 308 to live.* only.

## Steps for the Admin (Cloudflare dashboard, then Zero Trust)
**Order: create all five Access apps (the main app and four bypass apps) first, then put the hostname on the tunnel, so live.* is never open with only the dashboard password.** If live.* already answers, do the Access apps now. Until they exist, live.* has the same exposure as arcadesandwich.com/stream today (see "The side door" below).

1. **Login method:** Zero Trust, Settings, Authentication, Login methods. Check that **One-time PIN** is there (add it if not). No other method is needed.
2. **The main app:** Access, Applications, Add an application, Self-hosted.
   - Name: `live.arcadesandwich.com`. Domain: `live.arcadesandwich.com`, path empty.
   - Session duration: **24 hours**. Phones of moderators are the weak point, so a day is a fair balance; the Admin can choose up to 1 week.
   - Identity providers: One-time PIN only, with "Instant auth" on (skips the method picker).
   - Policy: Name `allowed people`, Action **Allow**, Include, Emails: `<the Admin's email>`, `<Musta's email>`, `<each moderator's email>`. Only these; no "Everyone", no email domain.
   - Settings, Cookies: **leave the eager redirect cookie setting off** (MustaHub's login loop came from it). Leave "HTTP Only" on and "Binding Cookie" off (it breaks WebSockets).
3. **Four bypass apps.** Each one: Add an application, Self-hosted, a session duration of no matter, and one policy with Action **Bypass**, Include **Everyone**:
   - Name `live pub (clips, Twitch callback)`, domain `live.arcadesandwich.com`, path `api/stream/pub/*`.
   - Name `live OBS remote`, domain `live.arcadesandwich.com`, path `api/stream/ws/obsremote/*`.
   - Name `live overlay`, domain `live.arcadesandwich.com`, path `api/stream/overlay` (Access also covers what lies under it; the dashboard has nothing there, so those requests get its 401).
   - Name `live Musta OBS remote`, domain `live.arcadesandwich.com`, path `api/stream/musta/ws/obsremote/*`, policy "live public bypass". Its locks are the key and OBS's password, as in the table.
4. **URL normalization:** in the arcadesandwich.com zone, Rules, Settings, URL normalization: check that "Normalize incoming URLs" is on, type Cloudflare.
5. **Then the hostname:** add `live.arcadesandwich.com -> http://localhost:3002` to the existing tunnel (Networks, Tunnels, the tunnel, Public hostnames). **Never touch play.arcadesandwich.com.**
6. **Tell Security:** SEC-NET-37 checks from outside:
   - `/stream` asks for the email login;
   - the three public paths open without it;
   - other paths give the login or 404;
   - the side door below is closed.

## The side door: arcadesandwich.com/stream and /api/stream/*
The game passes `/stream` and `/api/stream/*` to the same dashboard **before its own access door** (server.js, isStream). So once live.* has Access, arcadesandwich.com/stream would still reach the dashboard with only its password. Close it in the same change:
**Decided: Option A** (Server's OR345, the run order above). Option B is kept only as the fallback.
- **Option A: remove `/stream` and `/api/stream/*` from arcadesandwich.com once live.* works.** Before that:
  - The Admin sets up Access and the live.* hostname first (run order 1 and 2).
  - Then IRLToolkit moves the OBS "CLIP SHOWCASE" source to live.* and checks that it loads. The dashboard's public base is already `https://live.arcadesandwich.com` (STREAM_PUBLIC_BASE default), so the addresses it shows are already right; OBS's source just needs the new address.
  - The Admin adds the live.* callback URL in the Twitch developer console (dev.twitch.tv, the app, OAuth Redirect URLs): `https://live.arcadesandwich.com/api/stream/pub/twitchapp/callback`. Keep the old one until the switch is done, then remove it.
  - Server's GO for OR345 (a) and (a2) together, plus OR346 (the game's IRL button), then the deploy: the game stops passing /api/stream/* and the WebSocket to 3002, and /stream becomes a 308 forward to live.* for 30 days.
  - Then nothing on arcadesandwich.com reaches the dashboard any more.
- **Option B:** add `arcadesandwich.com/stream*` and `arcadesandwich.com/api/stream/*` to the same Access app as extra domains, with the same three bypass apps for `arcadesandwich.com/api/stream/pub/*`, `.../api/stream/ws/obsremote/*` and `.../api/stream/overlay`. It works without touching the game, but it means two sets of apps to keep in step, and the game's door still runs after Access for those paths.

## Testing
To let someone new test, **add their email to the main app's Allow policy**, and remove it afterwards. Never switch a policy to Bypass Everyone, not even for a quick test: that leaves live.* open behind only the dashboard password.

## Undo
**Undoing the Access login (always in this order):**
1. **First** remove the `live.arcadesandwich.com` public hostname from the tunnel (Networks, Tunnels, the tunnel, Public hostnames). This isn't optional: it must go whenever the apps go.
2. **Then** delete the five Access apps (the main app and the four bypass apps) (Zero Trust, Access, Applications).

Never the other way round: with the apps gone and the hostname still on the tunnel, live.* is open to the internet behind only the dashboard password.

**Undoing Server's step (a2, the game's pass-through restored):**
- This **returns arcadesandwich.com/stream and /api/stream/* to today's state: the dashboard behind only its own password, with no Access**, on the old address.
- While the pass-through is back, live.* keeps its Access apps, or loses its hostname (step 1 above). It never keeps the hostname without the apps.
- The Twitch Redirect URL and the OBS "CLIP SHOWCASE" source go back to arcadesandwich.com only if live.* is removed.

**Option B (only if it was used instead):** delete the extra arcadesandwich.com domains from the main app and the three arcadesandwich.com bypass apps, after the pass-through is closed or with the old address's protection decided by Server.

Sources:
- Cloudflare Zero Trust docs: Self-hosted applications, Application paths (the most specific path wins), Bypass policies, One-time PIN, Session duration, Cookie settings, URL normalization.
- The code in `C:\irl-stream\dashboard`: server.mjs (handle, the public and private route split), features/twitchapp.mjs (the public routes, StateStore, rate limits), features/obsremote.mjs (decideAccess).
