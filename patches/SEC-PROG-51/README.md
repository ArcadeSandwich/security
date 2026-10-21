# SEC-PROG-51: LISTEN-12, the tower sending pieces to the main PC's speech server

Status: draft (waiting for Security's review)
Owner: the Transcript Tool (listen\whisper.js).
Made against: C:\server\ai-workspace\app at 89fbf47 (includes LISTEN-12, 019fd91). Paths in fix.diff are from the app's root.

## Review, item by item (code reading plus stand-in tests; nothing sent to mika-pc or the live 7425)
1. **speechRemote: PASS.** It's "" in listen/settings.json and read only from there (server.js passes SETTINGS.speechRemote to createWhisper); no route or page sets it. REMOTE_OK accepts only `http://100.(64-127).x.y:<port>`, which is Tailscale's 100.64.0.0/10. Anything else is ignored and logged ("speechRemote ignored"). Note: the last two parts allow up to 999, which is harmless (such an address can't connect).
2. **Probe and timeouts: PASS.** The probe is GET / with a 1.5 s timeout, the answer cached for 30 s. The inference call has a 120 s timeout. A failure mid-piece marks the main PC down for 30 s, and that piece is read on the tower. Each piece makes one remote try, so there's no retry storm.
3. **What's sent: PASS, with a note.** A FormData body: the piece's wav (as "a.wav"), response_format, language, temperature and the prompt. No file path, meeting title or key. NOTE: the prompt holds the last 200 characters of the transcript as context, so a bit of the Admin's own text goes to his own PC over Tailscale (encrypted). That's acceptable, but it isn't "only the wav".
4. **The answer as data: PARTLY.** merge.js checks segments (Array.isArray), words (strings only) and numbers (Number.isFinite). Gaps (LOW):
   - (a) r.json() has no byte cap;
   - (b) the text isn't clipped (joinSegments takes any length, and String() of a non-string);
   - (c) fetch FOLLOWS redirects, so an answer of 307 to another host would re-send the wav there.
   **Fixed here:** `redirect: "error"` on the probe and the inference call; the answer read with a 2 MB cap, then JSON.parse in a try (an object only); joinSegments takes strings only and clips at 4000 characters. Each failure throws, so the tower reads the piece. Not changed: merge.js's "parts" texts aren't clipped one by one (their joined text is), so the Transcript Tool may clip them too.
5. **Logs: PASS.** Only fixed lines (up, not answering, failed on a piece, ignored), no audio, transcript or reply text. got.ms and got.where are kept on the line.
6. **The tower's own whisper and the guards: PASS.** When the main PC answers, read(remoteUrl) never calls start()/startLocal, so the tower's whisper isn't started (tested in listen-12). The worker still calls transcribe only under speechOk() (the memory and speech guards); that's conservative while the work happens on the main PC.
7. **Addresses in committed files: PASS.** `check.js --git`: OK (420 blobs). Committed Tailscale addresses: 100.107.176.17 (the tower) and 100.94.195.32 (mika-pc), plus the range 100.64.0.0 and two test values (100.120.0.1 in test/listen.test.js, 100.64.0.1 in test/window-basics.test.js).

## Apply (Transcript Tool)
1. In C:\server\ai-workspace\app: `git apply --check <this folder>\fix.diff`, then `git apply <this folder>\fix.diff`.
2. `node --test test\sec-prog-51.test.js test\listen-12.test.js`: expect 6 pass (the new test uses stand-in servers on 127.0.0.1 and this PC's ffmpeg).
3. Restart the Listen service through its task (Server).

## Undo
`git apply -R fix.diff`.

## Tested
On a scratch copy: the 3 new checks pass with the patch and fail without it (0 of 3), and listen-12's 3 checks still pass (6 of 6 together).
