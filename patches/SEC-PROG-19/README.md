# SEC-PROG-19: the MustaHub bot's dashboard functions check the login (high)

Status: draft (waiting for Security's review)
Owner: the MustaHub chats (offline); the Admin hands this folder over.
Made against: arcade-server commit f0bb65b (2025-06-07), from the Desktop\arcade-server copy. If the files have changed since, re-check before applying.

## The problem
The dashboard's server functions are TanStack Start `createServerFn` calls. Each one is a public web address, and none of them checked who was calling: only the dashboard *page* sent visitors to the login page. Anyone who could reach the site could therefore:
- make themselves an admin (`addAdmin`), or remove admins;
- create, change or delete overlays (`createOverlay`, `updateOverlay`, `deleteOverlay`). An overlay's HTML is shown on stream, so a stranger could put their own content on stream;
- read the admin list and the excluded creators, and search Twitch users with the bot's own credentials.

## What the patch changes
- New `frontend/app/lib/admin-check.ts`: a single admin rule. The user must have a Twitch account that is either the main admin (`TWITCH_ADMIN_USER`) or listed in the `admins` table.
- `frontend/app/lib/auth-server.ts`: the existing `isUserAdmin` now uses that rule (same behaviour). A new `adminMiddleware` answers **401** with no session and **403** for a signed-in non-admin, before the function runs.
- `services/twitch-users.ts`: all 7 functions run behind `adminMiddleware`.
- `services/clips.ts`: `getOverlays`, `createOverlay`, `updateOverlay` and `deleteOverlay` run behind it. **`getOverlayById` stays public on purpose**: the OBS overlay page (`/overlay/clips/<id>`) loads it without a login. It only reads, and an overlay id is 7 random hex characters.
- New test `frontend/app/lib/admin-check.test.ts`, also copied in `test\`.

## Apply
1. In the arcade-server folder: `git apply --check <this folder>\fix.diff`, then `git apply <this folder>\fix.diff`.
2. Run `bun test frontend/app/lib/admin-check.test.ts`. Expect 19 pass and 0 fail. Without the patch, the 11 checks on the functions fail.
3. Build and run as usual (`bun run build`). Then, signed out, open the dashboard and check that the settings page and the clip overlays no longer load data. Signed in as the admin, everything should work as before.

## Check it worked (on the deployed site, by the owner)
- Signed out, a direct call to a server function (for example adding an admin from the browser's developer tools) is refused with 401.
- Signed in with a Twitch account that is not an admin, it is refused with 403.
- The OBS overlay page still shows.

## Undo
`git apply -R <this folder>\fix.diff`, or revert the commit that applied it.

## Left for the Admin (logins and permissions)
- If the bot has ever been online, look at the `admins` table for Twitch ids you don't know and remove them. Look at the overlays for content you didn't write.
- Where the bot is deployed, if anywhere, is the Admin's answer (desk question SEC-PROG-13-H1).

## Tested
On a scratch clone, with no .env and no database: 19 pass and 0 fail after the patch (8 pass and 11 fail before). Not tested: a full build and a type check, because node_modules aren't in the scratch copy. The owner's build does that.
