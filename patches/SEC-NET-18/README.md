# SEC-NET-18: the OBS remote access key sits in the web address (IRL dashboard)

Status: blocked (not built as asked; options for Security and the Admin below)
Owner: IRLToolkit (offline).

## The finding
The OBS remote address is `wss://arcadesandwich.com/api/stream/ws/obsremote/<key>`. A key in a URL can end up in logs: Cloudflare's request logs and the browser or app history. Anyone who sees the key can open a pipe to OBS on the main PC. OBS's own WebSocket password still applies on top.

## Why "move the key to the first WebSocket message" does not work here
The feature is a byte-for-byte pass-through: the dashboard checks the key in the address, then connects the app straight to OBS on the main PC (port 4455). The apps that use it (Moblin's OBS remote control, Streamer.bot, Stream Deck plugins) speak only OBS's own protocol. They let you type an address and OBS's password, and they cannot send an extra first message with our key. So a key in the first message would break every app, and the dashboard would have to understand OBS's protocol to find it.

## Options (a decision for Security and the Admin)
1. **Keep the key in the address and lower the risk (recommended, can be a patch):** turn off logging of the path for this address where we control it (the dashboard already logs no key); make "New address" easy (it already exists) and rotate the key every month; keep OBS's password strong. OBS's password is checked by challenge and response, so it never travels over the wire. That makes the OBS password the real lock, and the address key a first gate against scanners.
2. **Cloudflare Access service token in front of this path:** the app would then have to send two headers. Moblin and Streamer.bot can't do that either, so this works only for tools that can set headers. It also needs the Cloudflare account, which only the Admin changes.
3. **Read OBS's first messages:** the dashboard waits for OBS's own login message and checks a second, dashboard-side password hidden inside it. That's a big change to a pass-through, and OBS's password already does this job.

## What was not changed
Nothing. No diff is included.
