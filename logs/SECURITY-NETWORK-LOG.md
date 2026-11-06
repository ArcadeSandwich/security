# Security · Network log

Notes of the Security · Network chat (network and access on cadeyserver). Handbook: Playbook HB-security-network. Reports to Security.

## 2026-10-20 SEC-NET-1 (first round, pair A with Secrets)
- Free memory 2754 of 16338 MB before the checks (INS-005); all checks read-only.
- NET-P1: all-card TCP 135, 445, 2179 (vmms), 3389, 4455 (OBS), 5040, 5357, 7680, 11434 (Ollama), 25565, RPC 49664-49697. Localhost: 3000-3003, 8517, 20241, 50051, 61443. Tailscale address: 7420, 139. 7421 not listening. Home network (StreamNet 10.0.0.6) Public, Tailscale Private.
- NET-P2: 195 enabled inbound allow rules, 167 remote Any. W-1 unchanged: 3389 TCP/UDP, every profile, Any; Remote Desktop on, NLA on.
  - New high: Hyper-V "REMOTE_DESKTOP_TCP_IN" TCP 2179, every profile, remote Any; vmms listens on all cards, so the home network reaches it. PLAN to Server.
  - New medium: "Tailscale-In" (2 rules) allows every protocol and port, remote Any, to the Tailscale addresses (Domain, Private). Every tailnet peer reaches every port; only the Tailscale ACL limits shared people.
  - Medium: program rules with remote Any: Node.js (Public), Java (Private+Public), OpenJDK and obs-browser-page (Public), ollama, OBS, bun, bunx (Private). Safe today only because of narrow binds or the Public home profile.
- NET-P3 (from 127.0.0.1, no forwarding headers, two wrong codes): no cookie gives 401 on /, /api/state, /api/access/codes; wrong codes gave 401, no Set-Cookie; log counted "1 of 5", "2 of 5" for 127.0.0.1. Code: timingSafeEqual, random 32-byte tokens stored as sha256, HttpOnly, SameSite=Lax, Secure behind https, 5 tries per 10 minutes. Low: x-forwarded-for trusted when cf-connecting-ip is missing (only local programs could use it).
- INS-001 on 11434 and 7420: partly (step 3 needs admin rights, used netsh instead; step 4 needs a second device; misses Tailscale-In). Report filed in the inbox.
- Single-lock services: Ollama 11434, OBS 4455 (W-2), Remote Desktop 3389 (W-1), Hyper-V 2179, file sharing 445 and RPC 135 over the tailnet.
- Inbox: HB-security-network, NET-P1, NET-P2, NET-P3, report on INS-001. intake --dry accepted all; check.js OK.
- Lead ACK: findings filed as W-8 (high, Hyper-V 2179), W-9 (Tailscale-In allow-all), W-10 (wide program rules), W-11 (x-forwarded-for, to Programs). Turn over until round 2.
- INS-018 second run: node --test dm/test/access-door.test.js (c20b2d6b): 5 pass, 0 fail, 1 todo (W-11); own random port, nothing sent to :3000. live and work lib/access.js both at 0b921375. Ran outside my turn (Agents and Resilience held both slots); next time I ask the lead first.

## 2026-10-20 SEC-NET-4 network inventory (round 2, turn shared with Programs)
- Free memory 1804 MB (small read-only commands only).
- Game: 3000 (node server.js) on 127.0.0.1; through the Cloudflare tunnel (metrics 127.0.0.1:20241).
- Work: 3001 (work-server.mjs) on 127.0.0.1.
- IRL stream: 3002 and 3003 (two dashboard\server.mjs processes) on 127.0.0.1. OBS 4455 on `::` (W-2). The Multipass VM "stream" (Ubuntu 24.04, running) has 172.18.228.252 and **10.0.0.31 on the home network**, plus Docker bridges, so it sits beside the PC on the home network; the Windows firewall does not protect it. Its ports are for SEC-NET-8.
- AI Workspace: Prompt generator 7420 (pg-service.js) on the Tailscale address. Ollama 11434 on `::`, app 61443 on 127.0.0.1.
- Minecraft: java 25565 TCP on `::` (public on purpose), 8517 on 127.0.0.1, UDP 24454 on `::` (probably voice chat; SEC-NET-9).
- Windows: TCP 135, 445, 2179 (Hyper-V), 3389, 5040, 5357, 7680, RPC 49664-49697 on every card; 139 on the three card addresses. UDP 53 (HNS DNS), 123, 500/4500, 1900 (SSDP), 3389, 3702, 5050, 5353, 5355 on every card or card addresses; 137/138 NetBIOS on the card addresses.
- Other: OneDrive 42050 on ::1, opencode 49374 and multipassd 50051 on localhost, tailscaled 41641 UDP.
- Hyper-V: Get-VM and Get-VMSwitch need admin rights; not read.
- Tailscale: 2 peers, 0 online, 0 shared in, 0 other users, no exit node, no serve or funnel config.

## 2026-10-20 SEC-INFRA-2/3, SEC-FIX-1/2 (C:\server\security)
- 90d7166 probe (normal and deep) and FIX-1/FIX-2 packs; 45c4a76 lead's review: Get-PackStateDir (C:\ProgramData\SecurityConsole\state\<pack folder>, Administrators and SYSTEM only), Undo validates, numeric profile; f5e129a both packs reviewed-security. The elevated path is untested.

## 2026-10-20 SEC-NET-6 to 9, SEC-NET-5 (free memory 1.5 GB; read-only)
- NET-6 Windows: 139 and 445 have no allow rule (home network blocked; tailnet open via Tailscale-In W-9); only the admin shares C$, D$, ADMIN$, IPC$; SMB1 off; SMB signing not required (low). 135: two Hyper-V WMI DCOM rules allow Any on every profile (medium, same family as W-8). 7680 Delivery Optimization allows Any on every profile (low). 5040 has no rule (blocked). UDP 53: three HNS container DNS rules allow Any on every profile (medium: a DNS service the home network can query). 5357 and 1900/3702/5355 are LocalSubnet on Private only (blocked today).
- NET-7 Tailscale: no advertised routes, no exit node, no serve or funnel, Shields Up off, RunSSH off. Nothing new beyond W-9 and W-7.
- NET-8 stream: 3002 /api/stream/status gives 401 without the code; 3003 / gives 404 (localhost only). OBS websocket: enabled, port 4455, auth on, password set (length only) (W-2 keeps the bind problem only). The stream VM (10.0.0.31 on the home network, ufw inactive, iptables INPUT ACCEPT) listens on TCP 22 (sshd, password login off), 1935 (RTMP, port-forwarded on the router by design), 8080, 8123, 8888 (HLS), 9997 (mediamtx API: 401 without auth, good), and UDP 4000, 4001, 5000, 8890. **High: 8123 is the SRT Live Server Management UI (srtla-receiver), 200 with no login from the home network.** Images on :latest (low). RTMP publish auth not visible (mediamtx config is in the container; IRLToolkit to confirm).
- NET-9 Minecraft (local files): online-mode on, white-list and enforce-whitelist on, RCON off, query off, management server off, TCPShield only-allow-proxy-connections on. Voice chat UDP 24454 on all cards (bind_address empty), needed by players; it reveals the home address unless proxied (low). 8517 is ImageFrame's web server on localhost.
- NET-5 musta.no: Cloudflare DNS and proxy (172.67.181.150), whole site behind a Cloudflare Access login (302 to cloudflareaccess.com), certificate Google Trust Services WE1 until 2027-01-16 for musta.no and *.preview.musta.no; http redirects to https. Mail via Cloudflare Email Routing, SPF ~all. **Medium: no DMARC record** (anyone can send mail as @musta.no that some receivers accept). Not served through this PC's tunnel (the tunnel has only arcadesandwich.com).

## 2026-10-20 packs 94b5644 (C:\server\security)
- Engine lib\firewall-pack.ps1 now takes targets (port, name prefix, program, new block rules). FIX-1 and FIX-2 are back to draft for re-review.
- FIX-2: 2179 off, plus every allow rule on 135 limited to Tailscale (SEC-NET-16).
- FIX-3: block rules on the Tailscale local addresses for 139, 137/138, 445, 2179, 4455, 5040, 5357 and 7680, because tailscaled recreates Tailscale-In.
- FIX-4: program rules (ollama, obs64, obs-browser-page, node, bun, bunx) limited to Tailscale; HNS DNS rules limited to 172.16.0.0/12 (SEC-NET-15); Java left out for voice chat.
- FIX-7: paste-ready ACL text, autogroup:shared to cadeyserver:7420 only, with tests.

## SEC-NET-13 stream VM: exact steps (for Server and IRLToolkit; no pack yet)
Not during a stream. In a Windows terminal: `multipass shell stream`, then:
- Option A, bind the UIs to the VM itself:
  1. `sudo cp /opt/srtla-receiver/docker-compose.yml /opt/srtla-receiver/docker-compose.yml.bak`
  2. In /opt/srtla-receiver/docker-compose.yml, under sls-management-ui ports, change `- "8123:..."` to `- "127.0.0.1:8123:..."` (keep the right-hand side as it is), and the same for 8080 if the dashboard does not need it.
  3. `cd /opt/srtla-receiver && sudo docker compose up -d`
  4. Check: from the PC, `curl -s -o /dev/null -w '%{http_code}' http://10.0.0.31:8123/` must fail to connect. Undo: copy the .bak back and run step 3.
- Option B, a firewall in the VM (also covers 8080, 8888 and 9997):
  1. `sudo ufw default deny incoming` and `sudo ufw default allow outgoing`
  2. `sudo ufw allow 22/tcp` and `sudo ufw allow 1935/tcp` (RTMP from the router)
  3. The SRT and SRTLA inputs the router forwards: `sudo ufw allow 4000/udp`, `sudo ufw allow 4001/udp` and `sudo ufw allow 5000/udp` (IRLToolkit to confirm which of these are forwarded)
  4. From the PC only: `sudo ufw allow from 10.0.0.6 to any port 8888,9997 proto tcp` and `sudo ufw allow from 10.0.0.6 to any port 8890 proto udp`
  5. `sudo ufw enable`, then `sudo ufw status numbered`
  6. Check: the stream works end to end; from another home device, 8123 must time out. Undo: `sudo ufw disable`.
  Note: Docker publishes ports through its own iptables chain, which can bypass ufw. Option B needs `DOCKER-USER` rules or the ufw-docker method too, so Option A is the reliable one for 8123.

## SEC-NET-10 defense in depth (every exposed service in every project)
| Service | Reach today | Lock 1 | Lock 2 | Count |
|---|---|---|---|---|
| Game 3000 | internet via tunnel | binds 127.0.0.1, one tunnel route | access codes, wrong-try limit | 2 |
| Work 3001 | through the game | 127.0.0.1 | Lab-code check | 2 |
| Stream dashboard 3002/3003 | localhost | 127.0.0.1 | 401 without code (3002) | 2 |
| Prompt generator 7420 | tailnet | Tailscale address bind + membership | its keys; ACL after FIX-7 | 2 |
| Ollama 11434 | home (blocked by firewall), tailnet | firewall from home | none on tailnet (no auth) | 1 (FIX-4 keeps the firewall; OLLAMA_HOST=127.0.0.1 if the tailnet does not need it) |
| OBS 4455 | binds every card | websocket password | firewall (Private only; FIX-3 blocks on Tailscale) | 2 after FIX-3 |
| Remote Desktop 3389 | home, tailnet | Windows password + NLA | none (FIX-1 adds Tailscale-only) | 1, 2 after FIX-1 |
| Hyper-V 2179 / 135 | home, tailnet | Windows sign-in | none (FIX-2) | 1, 2 after FIX-2 |
| SMB 445/139 | tailnet | Windows sign-in, admin shares only | none (FIX-3 blocks on Tailscale) | 1, 2 after FIX-3 |
| Container DNS 53 | home | none | none (FIX-4) | 0, 1 after FIX-4 |
| Stream VM 8123 (SRT UI) | home network | **none** | **none** | **0** (SEC-NET-13) |
| Stream VM 8080/8888 | home network | none known | none | 0 to 1 |
| Stream VM 9997 API | home network | mediamtx auth (401) | none (no firewall in the VM) | 1 |
| Stream VM 1935 RTMP | internet (router forward) | publish auth not confirmed | none | 0 to 1 (IRLToolkit to confirm) |
| Stream VM 22 SSH | home network | keys only (password off) | none | 1 |
| Minecraft 25565 | internet via TCPShield | TCPShield proxy-only | online-mode + enforced whitelist | 2+ |
| Minecraft voice 24454 UDP | internet (forward) | Java program rule | voice chat's own player check | 1 to 2 |
| musta.no | internet | Cloudflare Access login | Cloudflare proxy, hidden origin | 2 |

## SEC-NET-11 fix plans (ranked)
1. HIGH SEC-NET-13 (8123 open): steps above, Option A first. Owner IRLToolkit, decided by Server.
2. HIGH W-1 (RDP) and W-8 (2179): FIX-1, FIX-2 through the console, on the Admin's go.
3. MEDIUM W-9 (Tailscale-In): FIX-3 plus FIX-7 (two locks for shared people).
4. MEDIUM W-10, W-2, SEC-NET-15: FIX-4; recheck after every restart.
5. MEDIUM SEC-NET-14 (no DMARC): the Admin, Cloudflare dashboard, DNS for musta.no, Add record: TXT, name `_dmarc`, content `v=DMARC1; p=none; rua=mailto:<an address the Admin reads>`. After two weeks of clean reports, change it to `p=quarantine`.
6. MEDIUM Ollama on `::`: OLLAMA_HOST=127.0.0.1 if nothing on the tailnet uses Ollama (the Admin, user environment, then restart the Ollama task); otherwise leave it, and FIX-4 keeps the firewall as its lock. Not a Tailscale-only bind: that would cut the game and the local tools off from 127.0.0.1:11434 (corrected on the lead's review).
7. LOW SEC-NET-17: SMB signing (`Set-SmbServerConfiguration -RequireSecuritySignature $true`, elevated); Delivery Optimization (Settings, Windows Update, Delivery Optimization: off, or "PCs on my local network" off); pin the VM's images to versions; voice chat stays as it is.

## 2026-10-20 SEC-PROG-7: INS-012 route map, second chat (game at be1e2d95; free memory 1.6 GB)
- Order in server.js: (1) `/stream`, `/api/stream/*` to 3002 BEFORE the door; (2) WebSocket upgrades (`.on("upgrade")`) skip the request handler, so they skip the door too: only `/api/stream/ws/*`, to 3002, else destroyed; (3) access.gate; (4) Work and Workplace pass-through; (5) photos, DM, voice, audio, saves, Lab, tracker, version, static files.
- P-H table:
| Route | Check 1 | Check 2 | Gap |
|---|---|---|---|
| /api/stream/* | (no door) dashboard login, 401 | dashboard per-feature checks | none |
| WS /api/stream/ws/obsremote/<key> | (no door) feature on/off + 24-byte random key, timing-safe, https only | OBS's own websocket password, rate limit, max connections | low: the key sits in the URL path, so it can appear in proxy or Cloudflare logs |
| /api/queue/*, /workplace | door | requireLabCode / timing-safe Lab check | none |
| POST /api/phone/upload (new, OR335) | door | saves.mayWrite owner check, upload switch (social.photo.upload.on), adminOnly option, png/jpeg/webp by bytes, 1.5 MB, 2048 px, 10 per hour | none |
| GET /api/photo/own/<slot>/<id> (new) | door | owner (mayWrite), GET only, id pattern, nosniff | none |
| GET /api/photo/k/<key> | door | HMAC key (sha256, timing-safe) | none |
| GET /api/photo/<token> | door | one-time token, expiry, owner match | none |
| /api/lab*, /api/tracker*, /api/access/* admin, POST /api/audio-* | door | requireLabCode | low L2 (requireLabCode not timing-safe), as Programs found |
| DM routes, POST /api/voice, /api/saves | door | owner checks (saves) / none (DM, voice: guest routes by design) | low, by design |
| static files | door | normalize + inside-root check, no .php | none |
- Preview (3107, door off by design, 12 GETs, one per second): /api/lab/overview 401, /api/tracker 401 (own checks hold without the door), /api/access/codes 404, /api/photo/own/... 404, /..%2foak-config.json 403, /oak-config.json 404, /api/version 200, /api/saves 200 (door off: the preview's own empty saves), stream and Work 503 (not running for the preview). The preview server was stopped afterwards.
- Result: matches Programs' map, plus the new photo routes, which have two checks each. No new gap above low. The one low is new: the OBS remote key in the URL path.

## 2026-10-20 fixes and patches (C:\server\security)
- e72ca0a patches\SEC-NET-13 ready-for-owner (8123 to the VM's loopback). Rank corrected to medium: the receiver API on 8080 needs its key (GET /api/stream-ids gives 401), so the page has one lock.
- 779ded2 FIX-10-smb-signing (draft): server RequireSecuritySignature with record, Apply and Undo; Delivery Optimization as the Admin's Settings step. The client side and BACKUP-1 (this PC to mika-pc) are not affected.

## 2026-10-20 SEC-NET-R3 (round 3; free memory 1.4 GB; read-only)
- R3-1 Ollama: GET /api/version and /api/tags on 100.107.176.17:11434 gave 200 with no auth (version 0.40.6, 5 models). OLLAMA_HOST is set to 0.0.0.0:11434 in the user environment. Any tailnet device can run, pull or delete models (the API has no login). Today the tailnet is only the Admin's 2 devices; once anyone is shared in, only FIX-7 (the ACL) stands between them and 11434. **Medium.** Fix: FIX-7 first; and OLLAMA_HOST=127.0.0.1 if nothing on the tailnet uses Ollama, otherwise add 11434 to FIX-3 for shared people only (the ACL already does that). Note: what uses Ollama over the tailnet (the AI Workspace on the main PC?) needs to be named.
- R3-2 Remote management: WinRM stopped (Manual), no 5985/5986 listener and no rule; Remote Registry disabled; RemoteAccess disabled; no SSH server; UAC on (EnableLUA 1, ConsentPromptBehaviorAdmin 5); LocalAccountTokenFilterPolicy not set (remote UAC filtering on); admin shares on by default. None.
- R3-3 IPv6: **the home network card (vEthernet StreamNet) has GLOBAL IPv6 addresses (DHCPv6 and router advertisement)**; Tailscale has its ULA; Teredo is disabled, and 6to4 and ISATAP are at their defaults. Every service listening on `::` is therefore on a public IPv6 address, and only the router's IPv6 firewall and Windows Firewall's Public profile stand in front of it. Public-profile allow rules with remote Any on `::` listeners: Remote Desktop 3389 TCP/UDP (W-1), Hyper-V 2179 (W-8), Hyper-V WMI 135 (SEC-NET-16), Delivery Optimization 7680. **High: if the router doesn't filter inbound IPv6, Remote Desktop and the Hyper-V ports are reachable from the internet.** Not testable from this PC (an outside test is needed). FIX-1 and FIX-2 close them on the PC side.

## 2026-10-20 NET-10 and NET-11 update: IPv6 (SEC-NET-19) and Ollama (SEC-NET-20)
NET-10 rows added (the home network card has global IPv6, so "home" below also means "the internet over IPv6 unless the router filters"):
| Service | Reach today | Lock 1 | Lock 2 | Count |
|---|---|---|---|---|
| Remote Desktop 3389 over IPv6 | internet if the router lets IPv6 in | Windows password + NLA | router IPv6 firewall (unknown) | 1 to 2; FIX-1 adds the PC-side lock |
| Hyper-V 2179 / 135 over IPv6 | same | Windows sign-in | router (unknown) | 1 to 2; FIX-2 adds the PC-side lock |
| Delivery Optimization 7680 over IPv6 | same | none (it is a peer download service) | router (unknown) | 0 to 1; the Settings step in FIX-10 removes the listener |
| Ollama 11434 over IPv6 | blocked (rules are Private or 100.64.0.0/10 only) | firewall | router | 2 |
| Ollama 11434 on the tailnet | the Admin's devices; shared people later | Tailscale membership | none today; FIX-7 ACL | 1, 2 after FIX-7 |
| Minecraft 25565 over IPv6 | internet | TCPShield only-allow-proxy (direct IPv6 joins refused) | online-mode + enforced whitelist | 2 |
NET-11 changes:
- New 1 (HIGH, SEC-NET-19): run FIX-1 and FIX-2 first; then the Admin checks the router: IPv6 firewall on / "block unsolicited inbound IPv6"; optional outside test from a phone on mobile data (3389 must be closed).
- New 2 (MEDIUM, SEC-NET-20): FIX-7 before anyone is shared in; then OLLAMA_HOST=127.0.0.1 if no tailnet device uses Ollama (now 0.0.0.0:11434 in the user environment).
- 7680 over IPv6: neither FIX-3 (Tailscale addresses only) nor FIX-4 (program rules only) covers it. The FIX-10 Settings step removes the listener, and is now more than hygiene. A note for both READMEs is waiting for the lead's PLAN approval (frozen files).
- SEC-NET-20 accepted by Server for the Admin's own tailnet devices (Ollama stays on the Tailscale address on purpose); FIX-7 is the lock for shared people. 7680 IPv6 notes added to the FIX-4 and FIX-10 READMEs.

## 2026-10-20 SEC-RES-14 recheck (Workplace outage watcher, ai-workspace-app 7b4c21a; code reading only)
- Live: the Workplace on 3001 (workplace\server.js) started 06:54:40, after the commit (06:54:15, HEAD). The watcher starts only when server.js runs as the service (require.main).
- Watches, every 5 minutes:
  - the game 3000 by `GET http://127.0.0.1:3000/api/saves`, with no cookie and no code; 401 or 200 means alive. A request without a code is not a wrong try (the door counts only POST /api/access/enter), so it can't lock out 127.0.0.1;
  - by TCP connect only (800 ms timeout): Ollama 127.0.0.1:11434, the Prompt generator 100.107.176.17:7420, the old Work program 127.0.0.1:3004 and the tunnel metrics 127.0.0.1:20241.
- Hosts: only 127.0.0.1 and the Tailscale address. It starts nothing: setInterval in the same process, unref'd, with no child process and no task.
- Down after 2 failed checks in a row, back on the first good one. One line each in workplace\data\outages.jsonl (append-only), and the open outages are rebuilt from the file at start, so a restart neither repeats nor forgets a down. The desk shows open outages as a red line and the last 24 hours under the dots. It is a screen view, not a desk row or question.
- **Gap (low):** not watched: the stream dashboard 3002/3003, Minecraft 25565 (and 8517), the stream VM, and the Workplace itself (it can't watch itself). The lead's brief expected 3002, 3003 and the SMP port. Fix for Resilience/AI workspace manager: add `{ id: "stream", port: 3002 }`, `{ id: "smp", port: 25565 }` to WATCH (TCP), and maybe 3003; a watcher outside the Workplace (or the game) is needed to see the Workplace itself go down.
- outages.jsonl does not exist yet (nothing has gone down since 06:54). To check later: the first real down/back pair in that file is the live proof.

## 2026-10-21 SEC-PROG-29 recheck (CSRF fix 1b6e8316, live copy at 1b6e8316; code reading only, memory low)
- PASS.
- Order (server.js:366-369): stream pass-through, then access.gate, then access.crossSite (all routes except Work and the Workplace), then Work.
  - Work (/api/queue, /workplace) is left out, but every Work route needs the x-lab-code header (requireLabCode), which a cross-site form can't send.
- crossSite only acts on POST, PUT, PATCH and DELETE. It returns 403 when:
  - Sec-Fetch-Site is cross-site or same-site (other *.arcadesandwich.com pages too), or
  - an Origin is present and is neither https://arcadesandwich.com nor http://<this PC's 127.0.0.1/localhost host>. That includes Origin "null".
  - A missing Sec-Fetch-Site passes only when the Origin is absent or ours. Browsers send an Origin on every cross-origin POST, so old browsers are covered too.
- 415 when an /api/ request has a body (content-length > 0 or chunked) that isn't application/json, except /api/phone/upload (raw picture bytes; photos.js checks them and the owner).
- x-lab-code requests skip crossSite. A cross-site page can't send that header without a CORS preflight, and the game sends no Access-Control-Allow-* header anywhere (0 hits). The Lab routes still check it themselves (requireLabCode, timing-safe, lib/http.js:64).
- GET routes that change state: none found. The DM switch names every route "METHOD path": all writes are POST, and the GETs (game, phone, townmap, pokedex, intro, stories, skins, graveyard, ai-status, llm-mode, lab/live) read only. One note: GET /api/photo/<token> marks its one-time token used. A cross-site image tag could burn a token, but only if it knows the token, which is random and per owner, so this is no finding.
- WebSocket upgrades don't pass through crossSite. Only /api/stream/ws/* is upgraded, and it has its own key (SEC-PROG-7).
- Waiting for memory: the preview test (a cross-site POST gives 403, text/plain gives 415).

## 2026-10-21 SEC-AG-21 IPv6 recheck (Playbook 9f459df, tools/lib/util.js isPrivateIp; code reading only)
- isPrivateIp: PASS.
  - IPv6 is read as 8 words (lower-cased, zone dropped, dotted IPv4 tail read). Mapped ::ffff:0:0/96, compatible ::/96, translated ::ffff:0:0:0/96, NAT64 64:ff9b::/96 and 6to4 2002::/16 are checked as their IPv4.
  - Refused: 64:ff9b:1::/48, Teredo 2001::/32, 2001:db8::/32, 100::/64, fc00::/7 (Tailscale fd7a: included), link-local, site-local, multicast, :: and ::1. Malformed input gives null and counts as private; anything not IPv4 or IPv6 counts as private.
  - Odd IPv4 forms ("2130706433", "0177.0.0.1", "0x7f.1"): as literals, net.isIPv4 rejects them, so they count as private. Inside a URL, WHATWG turns them into 127.0.0.1 before the check, so they are refused too.
  - Uppercase hex is lower-cased. Leading zeros are limited to 4 hex digits per group; more gives null and counts as private.
  - Low: IPv4 192.88.99.0/24 (6to4 relay), 198.51.100.0/24 and 203.0.113.0/24 (documentation) are not refused. Tests to add: http://2130706433/, http://0177.0.0.1/, http://0x7f000001/, http://[::FFFF:127.0.0.1]/.
- resolvePublic checks the literal, or every DNS answer, and fetch-page.js connects only to those approved addresses (pinnedLookup) and re-checks every redirect hop: PASS. fetch-repo.js allows only https://github.com/<owner>/<repo>: PASS.
- **Gap, medium (new): fetch-video.js** calls checkPublicUrl once, then hands the URL to yt-dlp. yt-dlp resolves DNS again (no pinning) and follows redirects on its own, unchecked. A public URL that redirects to http://127.0.0.1:3000/... or http://100.107.176.17:7420/, or a DNS name that rebinds between the check and yt-dlp's fetch, makes yt-dlp request a local or tailnet service. The result goes into the Playbook's sources. Fix (Programs/Server): run yt-dlp only on an allowlist of video hosts (youtube.com, youtu.be, instagram.com, ...); or add `--proxy` through a local pinned proxy; or at least resolve after yt-dlp with `--print webpage_url` and re-check that host. Redirects can't be fully closed without the allowlist.

## 2026-10-21 second looks (code reading only): SEC-PROG-32, SEC-PROG-5 (ai-workspace-app aeb2a7b), SEC-PROG-33 (6f5e22c)
- SEC-PROG-32, the panel limit: PASS.
  - allowedUrl allows only the origin http://127.0.0.1:3001, compared exactly by new URL().origin, and only these paths: /, /queue.html, /queue.js, /workplace/<[A-Za-z0-9_./-]> with no "..", and /api/queue/(workplace|desk)(/[a-z0-9-]+)*. /queue-old* is refused.
  - WHATWG resolves ".." and %2e%2e before the check, and "%" is not in the allowed characters, so encoded slashes are refused.
  - session.webRequest.onBeforeRequest cancels everything else, and will-navigate is held to the same list.
  - The Lab code is added only on the API paths, and only when the request's frame or referrer is the Workplace origin. A request with neither gets "none:", so no code.
  - Every subframe navigation is refused (will-frame-navigate), and the CSP has frame-src 'none'.
- SEC-PROG-5, the 3001 headers: PASS.
  - nosniff on JSON, static files and forwarded answers.
  - The HTML page gets X-Frame-Options DENY and a CSP: default-src 'self'; script-src 'self' plus the sha256 of the one inline theme script (index.html line 11 is the first bare <script>, and the only other script is /queue.js); frame-src and frame-ancestors 'none'; object-src, base-uri and form-action 'none'.
  - The forwarded old page gets nosniff, DENY and frame-ancestors 'none'.
  - Low: style-src 'unsafe-inline' (CSS only). The hash is computed at request time, so a page edit changes it automatically.
- SEC-PROG-33 lows: PASS.
  - The tower's own Finn Scout list (main.js) now goes through cleanListing and drops rows without an id, the same as the HTTP route.
  - A body past MAX_BODY is answered 413 at once with Connection: close, reading is paused, and the socket is destroyed after the answer.
  - Low: there is no early check of Content-Length; the limit acts on the bytes that arrive, which is enough.

## 2026-10-21 SEC-NET-21 LISTEN-2 exposure (ai-workspace-app 0851eb1, not live; code and config reading only)
- Today: no serve config, no funnel, and nothing on 7425, 7426 or 443.
- Binds:
  - listen/server.js has HOST = "127.0.0.1" as a constant; only the port can be changed by environment (LISTEN_PORT).
  - whisper.js starts whisper-server with `--host 127.0.0.1 --port 7426`, and only while there is audio.
  - Neither can listen anywhere else: PASS.
- Funnel: the word appears only as "never use funnel" (README lines 13 and 30, server.js line 3, start-listen.bat); there is no funnel command anywhere: PASS.
- Who reaches serve: `tailscale serve --bg http://127.0.0.1:7425` publishes https on cadeyserver's tailnet name, port 443, to every tailnet device the ACL allows.
  - With today's default policy that is every tailnet device, so anyone shared in later too.
  - With FIX-7's ACL, autogroup:shared reaches only cadeyserver:7420, and autogroup:member (the Admin's own devices) reaches *:*. So LISTEN is the Admin's devices only.
  - Second lock: the service also requires Tailscale-User-Login to equal the Admin's login, plus the phone key (hashed).
- ACL change for the Admin (inside FIX-7's text): no new accept line is needed. Add 443 to the test so the policy can't be saved if a shared person could reach it:
  `{ "src": "autogroup:shared", "accept": ["cadeyserver:7420"], "deny": ["cadeyserver:443", "cadeyserver:3389", "cadeyserver:445", "cadeyserver:11434"] }`
  If the Admin wants it explicit, the narrowest accept line for LISTEN is `{ "action": "accept", "src": ["autogroup:member"], "dst": ["cadeyserver:443"] }`, already covered by member to *:*.
- FIX-3: its block rules (139, 137/138, 445, 2179, 4455, 5040, 5357, 7680 on the Tailscale addresses) don't touch 443, so serve keeps working. If FIX-3 ever adds a block list for "all except", 443 must stay open.
- **Order (important):** FIX-7 must be in place before `tailscale serve` is switched on, if anyone is shared in by then. Otherwise a shared person would reach LISTEN's page, though the login and key locks would still refuse them.
- Low: the README names the tailnet DNS name (cadeyserver.tailc872f1.ts.net). It is not a secret, since only tailnet devices can resolve and reach it, but leave it out if that repo is ever public. Low: GET /health is open (answers { ok } only).

## 2026-10-21 SEC-SECRETS-8 recheck
- PASS. C:\irl-stream\.gitignore is `private*/`. check-ignore.ps1 (read first: scratch copy in TEMP, empty stand-ins, removes only its own folder) printed check: OK: 9 files in private\ and 5 in private-musta\ ignored, and git add -A would stage none. No subfolders exist inside private*, so the test's top-level-only file list misses nothing today. No git init in C:\irl-stream.

## 2026-10-21 SEC-PROG-45 recheck (from outside, 3 plain GETs, redirects not followed)
- PASS. https://preview.musta.no/, /admin.html and https://musta.no/api/admin/orders (no password header) each answered 302 to the Cloudflare Access login (host <team>.cloudflareaccess.com). No logins, POSTs or forms.

## 2026-10-21 SEC-NET-23 (patches\SEC-NET-23, 868d5b7, draft)
- Steps for the Admin on mika-pc: OLLAMA_HOST=0.0.0.0:11434 (robust at logon; IPv4 only), NUM_PARALLEL=1, MAX_LOADED_MODELS=1; switch off every Ollama allow rule (saved to CSV for undo); one allow rule TCP 11434 from 100.107.176.17 only; a check block; undo. Tailscale: an ACL test line for shared people; a true cadeyserver-only second lock needs per-device ACL lines (the Admin's choice). Recheck: Resilience (SEC-NET-25).
- 0cbeb67: SEC-NET-23 reviewed-security (dual-stack listen is fine, full allow-rule check, normal vs elevated windows, CSV in ProgramData). FIX-7 corrected: Tailscale tests take a specific user, group, tag or host, not autogroup:shared, so the tests block was removed; add one test per shared login when someone is shared.
- df72c79: SEC-NET-23 changed on Server's review to two locks: OLLAMA_HOST=100.94.195.32:11434 (mika-pc's Tailscale address) plus the tower-only rule; Tailscale "Run unattended" removes the logon race; re-run the check after every Ollama update. 0.0.0.0 was rejected (one re-added rule would open it). My first choice of 0.0.0.0 broke our own two-locks rule.

## 2026-10-21 SEC-NET-24 LISTEN-10 review (ai-workspace-app 075514c, listen/mainpc.js; code reading only, nothing sent to mika-pc)
- Host: MAINPC_URL is fixed at http://100.94.195.32:11434. It can be overridden only by settings.mainpcUrl, which is read once at start from listen/settings.json (in git) and data/local.json (git-ignored, the Admin's). No route or page writes settings; the backend is on only when settings.corrector is "mainpc" (default "tower"): PASS.
- Fallback: /api/version health check (2 s), /api/ps check (2 s; busy if another model is loaded), then /api/chat (120 s). Any error, non-200 or timeout returns null, and the tower's text stays. One job at a time (busy flag), once per meeting after Stop, no retries: PASS.
- Logs: "corrector <meeting id>: <step> <status> <ms>" and counts only; no transcript or prompt text: PASS.
- Reply as data: content goes through JSON.parse in try/catch; cleanCorrections keeps at most 400 items, only integer n that were sent, string text within 0.5 to 1.5 times the old length plus 20, capped at 4000 characters. server.js re-checks n and type, and replaceLine keeps the line's number, language and parts: PASS.
- **Low (fix):** the reply body is read with r.json() with no size limit, so a misbehaving or compromised mika-pc could send a huge body that the tower holds in memory. Fix: read with a byte cap (for example 2 MB: read the stream, stop and return null past the cap) before parsing.
- Committed addresses (check.js --git: OK, 401 blobs; plus a grep for private and Tailscale ranges): in listen/, only 100.94.195.32 and 127.0.0.1. **Elsewhere in the repo: factory/models.json has "http://10.0.0.18:11434"**, mika-pc's home-network address, for the factory's sorter. Two problems:
  - a third address is committed;
  - once SEC-NET-23 binds mika-pc's Ollama to 100.94.195.32 only and the firewall allows only the tower, that sorter URL stops working. Its "_help" text also says "the owner's".
  Fix for the Manager: use the Tailscale address, and note that mika-pc's rule then must allow the machine the factory runs on. If the factory runs on mika-pc itself, use 127.0.0.1.
- Note: the model is qwen3:8b-q4_K_M, while SEC-NET-23 pulls qwen3:8b. Make sure the same tag is pulled, or the corrector answers "model not found" and falls back every time.

## 2026-10-21 SEC-NET-26 (patches\SEC-NET-26, de3fce2, draft)
- whisper-server on mika-pc: bind 100.94.195.32:7426 plus one rule from 100.107.176.17 (rule before the first start); prompt rules switched off; never --convert (it writes temp files), so no audio on disk; models copied from the tower and hash-checked; logon task at BelowNormal and Limited with a retry loop; check block and undo. /load cannot be switched off, so the scope and the bind are the only locks. Low: the tower's CUDA 12 zip download is not recorded in AIW-LOG.
- 439f5b3/69ebbbc: SEC-NET-23 v3 (Server's portproxy design): Ollama stays on 127.0.0.1, netsh portproxy on 100.94.195.32:11434, allow from 100.107.176.17 plus a block rule for every other sender (so Tailscale-In allow-all cannot bypass lock 2), step 0 clears an open OLLAMA_HOST, and an iphlpsvc restart task after Tailscale. SEC-NET-26: task in a normal window, plus the same block rule. Both draft for the lead.
- 2026-10-21: SEC-NET-23 step 0 on mika-pc (from the AIWM) confirmed Ollama open on the home network: OLLAMA_HOST (user) 10.0.0.18:11434, listening on 10.0.0.18 only, no port proxy, firewall not checked. High; being fixed (value cleared, Ollama restarted, steps 2 to 5 next). Sent to the lead for a SEC id.
- SEC-NET-33 (high): reachability confirmed by the lead (a GET from the tower to mika-pc's home address on 11434 gave 200). Recheck: Resilience SEC-NET-25 (step 5 output plus a GET to the home address that must fail). I read the step 0 and step 5 output when the AIWM sends it.

## 2026-10-21 SEC-NET-36 (patches\SEC-NET-36, d910918, draft)
- Access with One-time PIN for live.arcadesandwich.com (email list, 24 h, eager redirect cookie off, binding cookie off); three separate Bypass apps (pub/*, ws/obsremote/*, overlay exact); URL normalization on; run order per OR345 (side door closed by Server's step: /api/stream off the game, /stream a 308 for 30 days). Code read: every bypassed route is public data or locked (one-time OAuth state; obsremote key with a try limit plus OBS password; overlay with no data). Note: Musta's channel paths are not bypassed.
- 6d6e3d7: SEC-NET-36 reviewed-security. Access app paths cover their subpaths (Cloudflare doc: a path "will inherit any rules set for" its parent), so the overlay bypass also covers /api/stream/overlay/...; the dashboard has no route below it (401). Musta: checked, no bypass needed today.
- b859561: SEC-NET-36 undo fixed after Resilience's SEC-NET-38 fail: hostname off the tunnel first, then the apps; no Bypass Everyone test (add the tester's email instead); the a2 undo returns the old address to password-only.

## 2026-10-21 SEC-NET-37 (live.* part; from outside, 15 requests, redirects not followed, about 3 s apart)
- PASS.
- /, /stream and /api/stream/status: 302 to the Access login (the team's cloudflareaccess.com).
- /api/stream/pub/twitchapp/clips: 200 HTML. clips/list: 200 JSON with keys clips and showTitle; 276 clips, each with id, title, duration, views, creator and date (public Twitch clip info; creator is the public clipper name).
- /api/stream/overlay: 200 HTML. /api/stream/overlay/x: 401 "Log in first." (the dashboard's own login).
- Tricks:
  - /api/stream/pub/../status: 302 to Access (normalized before Access);
  - /api/stream/pub%2F..%2Fstatus: 302 to Access;
  - /API/stream/pub/twitchapp/clips: 404 from the dashboard (Access matched the bypass case-insensitively; the dashboard's routes are case-sensitive, so not found);
  - //api/stream/pub/twitchapp/clips: 404 from the dashboard.
  - None reached a private route.
- /api/stream/ws/obsremote/x, a plain GET with no upgrade: 401 "Log in first." No leak.
- TLS: Google Trust Services WE1 until 2027-01-04, SAN arcadesandwich.com and *.arcadesandwich.com, so it covers live.*.
- Headers:
  - overlay: CSP default-src 'none' with nonces, frame-ancestors 'none', XFO DENY, nosniff, no-referrer, no-store;
  - Access page: HSTS max-age 31536000 with includeSubDomains, XFO DENY, nosniff, CSP frame-ancestors 'none', and a CF_Session cookie that is Secure and HttpOnly.
- Low: the dashboard's own answers on live.* carry no Strict-Transport-Security. The Access page's HSTS includes subdomains, so a browser that has seen it is covered. For the rest: HSTS on in Cloudflare (SSL/TLS, Edge Certificates) for the zone, the Admin's step.
- Correction to my SEC-NET-37 low: the Access page's HSTS is sent from the team's cloudflareaccess.com host, so it does NOT cover live.arcadesandwich.com. And zone-wide HSTS would reach play.arcadesandwich.com, so it must not be used. The fix is the lead's SEC-NET-39: the dashboard sends HSTS itself, without includeSubDomains (IRLToolkit).

## 2026-10-21 SEC-NET-37 musta addition (8 requests, redirects not followed)
- PASS. /api/stream/musta/ws/obsremote/x (plain GET, no upgrade): 401 "Log in first.", nothing leaked. /api/stream/musta/status and /stream?c=musta: 302 to Access. Tricks: obsremote/../status and obsremote%2F..%2Fstatus gave 302 to Access; /API/... and //api/... gave 404 from the dashboard. No private route was reached. HSTS is now on the dashboard's own answers (401 and 404), so SEC-NET-39 looks done. README for the fourth bypass app: b7e0dbe (security repo).

## 2026-11-06 SEC-NET-33 recheck (2 GETs from the tower)
- FAIL: 10.0.0.18:11434/api/version answered 200 (version 0.40.14), so Ollama is still open on mika-pc's home address; 100.94.195.32:11434 did not answer (no portproxy yet). SEC-NET-23 v3 is not in effect. Ollama has updated (0.40.6 to 0.40.14). Asked for v3 step 0 output via the lead.
