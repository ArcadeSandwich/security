# SEC-PROG-39: musta.no's order store, before the Cloudflare Access login comes off

Status: reviewed-security (Security, 2026-10-21; the admin limit counts wrong passwords only)
Tracker: SEC-PROG-41 (admin tries), 42 (order limit), 43 (the five lows), 44 (root wrangler.toml), 45 (preview open).
Owner: the MustaHub chats (Store for worker/, the Builder for the site workers). The security team changes nothing in MustaHub.
Made against: github.com/ArcadeSandwich/MustaHub, branch store/legal, head ba2257b (2026-10-21), the order store to be deployed with the shop off. Paths in fix.diff are from the repository root.

## Findings, ranked
1. **Medium to high once the login is off: no limit on admin password tries.** worker/src/index.js:444-447 (admin()): every /api/admin/* request compares X-Admin-Password, with no count of wrong tries. Once Cloudflare Access no longer covers musta.no/api, anyone can guess the password as fast as they like, and the admin routes give every buyer's name, address, email and phone, plus delete and export. **Fixed here:** at most 10 WRONG admin passwords per visitor in 15 minutes. The count is checked before the compare (429 when over), a wrong password is recorded and answered 401, and a right password is never counted. admin.html makes one call per click and doesn't poll (site/js/admin.js, site/js/store.js), so normal work never reaches a limit. A burst of wrong tries sent at the same moment can slip a few past it, which is harmless with a long random password. Also make ADMIN_PASSWORD long and random (a Worker secret, the Admin's job).
2. **Medium: the order limit can be stepped around.** index.js:176-182 and 337-343: (a) the count is read, and the visitor's row is written only after a successful order, so many orders at the same moment all pass the check; (b) an IPv6 visitor gets a new count for every address in their /64 (one home network has billions); (c) X-Forwarded-For is a fallback, and anyone can type it. With checkout on, someone could hold all the copies in unpaid 30-minute checkouts. **Fixed here:** overLimit() writes the try first, then counts; IPv6 counts by /64; only CF-Connecting-IP. (Turnstile on the checkout form would be a second lock; that's the Builder's and the Admin's choice.)
3. **Low: no size limit on bodies.** index.js:143, 307, 459, 475, 481 use request.json() on any size (the platform's own limit is very large). **Fixed here:** readJson() refuses over 16 KB with 413.
4. **Low: a signed Vipps notice can be replayed.** worker/src/vipps.js:88-106 checks the HMAC and body hash, but not the age of x-ms-date. **Fixed here:** refused when more than 5 minutes off.
5. **Low: production CORS allows http://localhost:8321.** worker/wrangler.toml:33. **Fixed here:** removed; a local test adds it in .dev.vars.
6. **Low: the RATE_SALT fallback is "bok".** index.js:177 and 338: without the RATE_SALT secret, the hashed addresses can be reversed (IPv4 is a small space). The patch drops the fixed fallback; set RATE_SALT as a Worker secret (random, the Admin's job).
7. **Low: JSON answers have no nosniff.** **Fixed here** (JSON_HEADERS).

## What holds (no change needed)
- Every D1 query uses bound parameters (?, ?1 and so on). The only text built into SQL comes from constants in the file (DERIVED_STATUS, NOT_COUNTED, the STEPS column names), never from a request.
- Errors: the catch at index.js:86-92 answers `{ error: 'server error' }` and logs only the error's name. No stack trace or request data leaves.
- Order input: strings trimmed and clipped (name 120, email 200, phone 40, address 200, postcode 12, city 80, message 1000, dedication 200); a simple email pattern; copies an integer from 1 to MAX_COPIES; product only 'book'; price and postage from the product file, never the page; terms must be true at checkout.
- The order status lookup needs the 32-hex checkout key (constant-time compare) and answers only paid, waiting or not_paid.
- The admin password compare is constant time (both sides hashed); checkout_key is removed from the admin list; CSV cells that look like formulas get a leading apostrophe.
- **ORDERS_OPEN on store/legal works:** POST /api/orders answers 503 store_closed before reading anything unless ORDERS_OPEN is "yes"; /api/checkout answers 503 payment_off until Vipps is set up.
- Secrets: `check.js --git` on main and on store/legal found no secret in any file or commit (636 blobs). wrangler.toml lists ADMIN_PASSWORD and RESEND_API_KEY as secrets only by name. The D1 database_id is an id, not a secret.

## The public and preview sites
- **wrangler.public.toml (dist/public) is right:** scripts/build-public.js writes `_headers` from security-headers.json (HSTS, nosniff, X-Frame-Options DENY, Referrer-Policy, Permissions-Policy, COOP, and a CSP with script-src 'self' plus Cloudflare Insights, frame-ancestors 'none' and object-src 'none'), and leaves admin.html out of the public build.
- **Watch: wrangler.toml with site-worker.js serves the whole ./site folder, admin.html included, with NO security headers** (site-worker.js only redirects the root). If anyone deploys with `wrangler deploy` instead of the public config, that is what musta.no gets. Remove or rename wrangler.toml at the root, or point it at dist/public too.
- **(8) Does preview-worker serve only behind Access? NOT as the code says.** preview-worker.js lines 2-3 say "The preview is open without login since 2026-10-20". It serves the whole ./site folder (admin.html too) with noindex and the security headers. Chief's message says the preview stays behind Access. Only the Cloudflare dashboard can tell which is true, and that's the Admin's to check. The admin page itself needs the password for any data, so the risk is the unfinished pages, not the orders.

## Apply (Store)
1. In MustaHub on store/legal: `git apply --check <this folder>\fix.diff`, then `git apply <this folder>\fix.diff`.
2. `node --test worker/test/sec-prog-39.test.mjs`: expect 8 pass. Without the patch, 6 fail (the store-closed check and the 20-right-passwords check already pass on the branch).
3. Set the Worker secrets RATE_SALT (random) and, if it isn't long already, a new random ADMIN_PASSWORD (the Admin, in Cloudflare).
4. Deploy as planned (wrangler deploy in worker/). The submissions table is reused, so no migration is needed.

## Check it worked
- On the deployed store, ten wrong admin passwords from one address, then any try, give 429; a normal admin.html session (many calls with the right password) is never limited.
- An order body over 16 KB gives 413.
- With the shop off, POST /api/orders gives 503 store_closed.

## Undo
`git apply -R fix.diff`.

## Tested
On a scratch clone of store/legal: the new test passes 8 of 8 with the patch and 2 of 8 without it. The test runs the Worker's own fetch in Node 24 with a small stand-in for D1 (only the submissions table); nothing reaches Cloudflare, Vipps or Resend. No wrangler build was run here.
