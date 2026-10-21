# SEC-PROG-47: LISTEN-11, listening back to, downloading and deleting a meeting's recording

Status: reviewed-security (Security, 2026-10-21: the recording build waits for the memory guard on the route too; one build per meeting)
Owner: the Transcript Tool (listen\). main.js's part is already committed (7961e8d) and needs no change.
Made against: C:\server\ai-workspace\app at 7961e8d plus the Transcript Tool's UNCOMMITTED LISTEN-11 work as it was on 2026-10-21 (listen\server.js, the new listen\recording.js, listen\public\app.js and the new test\listen-11.test.js). The diff's base is those working files, so apply it after the Transcript Tool commits LISTEN-11, or re-check if they've changed.

## Review, item by item (code reading plus tests on a scratch copy)
1. **GET /listen/api/meetings/<id>/recording: PASS.** It's under /listen/api/, so both locks (the Tailscale login, then X-Listen-Key) run first. The id must match the route pattern and then store.ID (`^\d{8}-\d{6}-[a-f0-9]{6}$`), and the file is always `<data>\<id>\audio\recording.m4a`, so no path tricks.
2. **Download headers: PASS.** downloadName keeps only letters, digits, space, `_` and `-` (at most 80) and adds `.m4a`; filename= also turns non-ASCII into `_`, and filename*= is percent-encoded. No quote, CR, LF or slash can reach the header. Also sent: `Cache-Control: no-store`, audio/mp4, and the SAFE headers (nosniff, DENY, no-referrer, CSP).
3. **delete-audio: PASS.** It needs both locks, a JSON body of at most 1 KB with `confirm` equal to the id, is refused (409) while the meeting is recording or has queued pieces, deletes only `<digits>.audio` pieces and recording(.part).m4a in the audio folder, and logs only the id and bytes.
   - About "the existing CSRF checks": the Listen service has NO Sec-Fetch-Site or Origin check. It doesn't need one: every /listen/api route needs the X-Listen-Key header, which a form or a cross-site page can't send (a custom header forces a CORS preflight, and the service answers none). That header is the CSRF defense.
4. **main.js will-download in "listen": PASS** (7961e8d). lib/listen-panel.js downloadOk: mime exactly audio/mp4; a blob: is allowed only when the origin after "blob:" is the listen origin; otherwise new URL() with the exact origin, the path matching `^/listen/api/meetings/<strict id>/recording$`, and no query. Everything else is cancelled. The save dialog offers .m4a only, and the default name is cleaned.
5. **ffmpeg join: PARTLY.** The arguments are an array (no shell). The concat list holds only file names read from the audio folder that match `^\d+\.audio$` (quotes escaped), never anything from a request. BelowNormal. After Stop, the worker builds only when guard.ok().
   - **Gap (MEDIUM):** the GET /recording route calls buildRecording itself when the file isn't ready, WITHOUT the memory guard. Pressing play or download while the tower is low on memory starts ffmpeg anyway.
   - **Gap (LOW):** two builds of one meeting at the same moment (the worker after Stop plus the player, or play plus download) both run ffmpeg into the same recording.part.m4a, and one can rename a half-written file.
   - **Fixed here:** the route answers 503 ("the tower is low on memory; try again later") when the file must be made and worker.roomForRecording() (the worker's own guard.ok()) says no; a ready file is still sent. buildRecording keeps one build per meeting: a second call waits for the first.
6. **The player: PASS.** It fetches /listen/api/meetings/<id>/recording with the X-Listen-Key header into a blob; the key is never in a URL. Inside the AI Workspace, main.js adds the key itself (SEC-PROG-35).

## Apply (Transcript Tool)
1. After LISTEN-11 is committed: `git apply --check <this folder>\fix.diff`, then `git apply <this folder>\fix.diff` in C:\server\ai-workspace\app. If the check fails, the two changes are small: see fix.diff (listen\server.js: roomForRecording and the 503; listen\recording.js: the `building` map).
2. `node --test test\sec-prog-47.test.js test\listen-11.test.js`: expect 5 pass. (The new test uses this PC's ffmpeg on tiny generated pieces, like listen-11.test.js.)
3. Restart the Listen service through its task (Server).

## Check it worked
With the tower under 1.0 GB free, playing a meeting whose recording isn't made yet shows "the tower is low on memory; try again later"; a meeting whose recording is ready still plays.

## Undo
`git apply -R fix.diff`.

## Tested
On a scratch copy: the 2 new checks pass with the patch and fail without it (0 of 2), and the 3 listen-11 checks still pass (5 of 5 together).
