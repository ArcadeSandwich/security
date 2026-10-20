# SEC-NET-13: the SRT management page only inside the stream VM

Status: draft (Security reviews, then ready-for-owner)
Owner: IRLToolkit (offline). Applies to: the Multipass VM "stream", file `/opt/srtla-receiver/docker-compose.yml`. The VM is not a git repository, so the diff is against the file itself: dated 2026-10-07 03:40, 1030 bytes, sha256 starting `efa2527d9fb0bffa`.

## The finding
- The VM has its own address on the home network (10.0.0.31) and no firewall (ufw inactive, iptables INPUT ACCEPT).
- Port 8123 serves the "SRT Live Server Management" page (sls-management-ui), and every device on the home network can open it.
- **Rank, corrected after a recheck on 2026-10-20:**
  - The page is only a front end. Everything it does goes through the receiver's API on 8080, and that API refuses requests without its API key (`GET /api/stream-ids` gives 401).
  - So the lock is the API key, and the open page is one lock, not none. Suggested rank: **medium** (one lock on the home network), down from high.
  - The patch adds the second lock: the page is no longer reachable from outside the VM at all.

## What the patch changes
One line: the page's published port becomes `127.0.0.1:${SLS_MGNT_PORT}:3000`, so Docker publishes it only on the VM's own loopback.

Not changed, because the dashboard on the PC needs them:
- 8080 (the receiver's stats and API: dashboard `ingest.mjs`, `slsPort = 8080`);
- 8888 (HLS live preview);
- 9997 (mediamtx API, which has its own login);
- the UDP inputs 4000, 4001 and 5000.

The patch also doesn't touch mediamtx's compose file.

Side effect: to open the management page after the patch, use a tunnel from the PC, for example `ssh -L 8123:127.0.0.1:8123 ubuntu@10.0.0.31` with the VM's SSH key (password login is off), then open http://127.0.0.1:8123 on the PC. The stream itself is not affected.

## Steps (IRLToolkit or the Admin; never during a stream)
1. Open a terminal on the PC and run `multipass shell stream`.
2. Check that the file is unchanged: `sha256sum /opt/srtla-receiver/docker-compose.yml`. It must start with `efa2527d9fb0bffa`. If it doesn't, read the file and apply the same one-line change by hand.
3. Back it up: `sudo cp /opt/srtla-receiver/docker-compose.yml /opt/srtla-receiver/docker-compose.yml.bak-sec-net-13`
4. Apply the change. Either copy `fix.diff` into the VM (`multipass transfer fix.diff stream:/tmp/fix.diff`) and run `cd /opt/srtla-receiver && sudo patch -p1 < /tmp/fix.diff`, or edit the `ports:` line under `sls-management-ui` with `sudo nano docker-compose.yml`.
5. Recreate only that container: `cd /opt/srtla-receiver && sudo docker compose up -d sls-management-ui`
6. Leave the VM with `exit`.

## Check
- From the PC (home network side): `curl -s -o /dev/null -m 5 -w "%{http_code}" http://10.0.0.31:8123/` must fail to connect (code 000).
- Inside the VM: `curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:8123/` gives 200.
- The dashboard still shows the SRT stats (8080 unchanged).
- The commands are listed in `test\check.txt`.

## Undo
`multipass shell stream`, then `sudo cp /opt/srtla-receiver/docker-compose.yml.bak-sec-net-13 /opt/srtla-receiver/docker-compose.yml && cd /opt/srtla-receiver && sudo docker compose up -d sls-management-ui`.

## Waiting for the Admin
Nothing: no login or permission change. The ufw firewall in the VM (option B in docs/SECURITY-NETWORK-LOG.md) would cover 8080, 8888 and 9997 too, but Docker's published ports bypass ufw unless DOCKER-USER rules are added. That is a bigger change, for IRLToolkit to decide.
