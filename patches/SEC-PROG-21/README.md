# SEC-PROG-21: the IRL dashboard believes the visitor's address and "https" only from trusted places (low)

Status: draft (waiting for Security's review)
Owner: IRLToolkit (offline). Apply when it returns.
Made against: C:\irl-stream\dashboard as of 2026-10-20 (server.mjs dated 2026-10-19; features\obsremote.mjs and features\twitchapp.mjs dated 2026-10-18). C:\irl-stream is not a git repository, so the diff paths start at `dashboard/` (apply from C:\irl-stream).

## The problem
- `server.mjs` `clientIp`, `features/obsremote.mjs` `clientIp` and `features/twitchapp.mjs` `clientKey` took `cf-connecting-ip` from ANY connection. The login limit (wrong passwords per address), the OBS-remote limit and the Twitch callback limit count per address. So a program on this PC that talks to 127.0.0.1:3002 or 3003 directly could send a new made-up address each try and never be limited. Through Cloudflare nobody can fake it, because Cloudflare sets the header itself.
- `server.mjs` `isHttps` and `obsremote.mjs` `isSecure` believed `x-forwarded-proto: https`. That decides the cookie's Secure flag, the "only over https" refusal and wss-only for the OBS key. Cloudflare's own `cf-visitor` header is what should count.
This is the same pattern as the game's W-11, which was fixed in the game on 2026-10-20.

## What the patch changes
- The address comes from `cf-connecting-ip` only when the connection itself comes from this PC (127.x or ::1: cloudflared, or the game's pass-through). Otherwise it is the connection's own address.
- https and wss count only from `cf-visitor` (`{"scheme":"https"}`); x-forwarded-proto is never read.
- Tests: obsremote.test.mjs (a header from another connection is ignored; x-forwarded-proto alone is not secure; the request helper now sends CF-Visitor as Cloudflare does), twitchapp.test.mjs (a header from another connection is ignored), and stress.test.mjs (its fake Cloudflare request sends cf-visitor).

## Apply
1. From C:\irl-stream: `git apply --check --directory=. <this folder>\fix.diff` (or `patch -p1 < fix.diff`), then apply it.
2. `node --test dashboard/test/obsremote.test.mjs dashboard/test/twitchapp.test.mjs dashboard/test/auth.test.mjs dashboard/test/stress.test.mjs`. Expect 148 pass and 0 fail.
3. Restart both dashboards (3002 and 3003) the way IRLToolkit normally does.

## Check it worked
On the live site, signing in still works and the cookie still has Secure (browser devtools, the irls cookie). The OBS remote still connects from Moblin over wss.

## Undo
Apply the diff in reverse (`git apply -R` or `patch -R -p1`).

## Logins and permissions
None needed.

## Tested
On a scratch copy: 148 of 148 tests pass with the patch (obsremote, twitchapp, auth, stress). The unpatched copy passes its own obsremote tests (40 of 40).
