# SEC-PROG-25 (MustaHub part): the Twitch login's return address follows the site (low)

Status: ready-for-owner (reviewed by Security, 2026-10-20)
Owner: the MustaHub chats (offline); the Admin hands this folder over.
Made against: arcade-server f0bb65b with SEC-PROG-19 applied first. The diff touches only `frontend/app/lib/auth.ts`, so it also applies on its own.

## The problem
`frontend/app/lib/auth.ts` sends Twitch logins back to a fixed `http://localhost:8080/api/auth/callback/twitch`. On a deployed site, either the login breaks, or someone works around it by registering an http (unencrypted) localhost address with Twitch.

## What the patch changes
The return address is built from `VITE_DEPLOY_URL` (already required by env.ts): `<VITE_DEPLOY_URL>/api/auth/callback/twitch`.

## Apply
1. `git apply --check fix.diff`, then `git apply fix.diff`.
2. Make sure `VITE_DEPLOY_URL` in the bot's own .env is the site's https address (for local use, `http://localhost:8080`).

## Left for the Admin (logins and permissions)
In the Twitch developer console, the app's OAuth Redirect URLs must include `<VITE_DEPLOY_URL>/api/auth/callback/twitch`. Remove the old `http://localhost:8080/...` entry if the bot only runs deployed.

## Check it worked
Signing in with Twitch on the deployed site returns to the site and shows the dashboard.

## Undo
`git apply -R fix.diff`.

## Tested
Read only: a one-line change; no build here (no node_modules in the scratch copy).
