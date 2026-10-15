# Corral

A phone and tablet client for herdr over mosh: watch and steer your
coding agents from Android, iPhone and iPad.

## Layout

```
packages/core   TypeScript core shared by app and agent: mosh protocol, terminal
                emulator, herdr API types (runs in Node and React Native)
apps/agent      corral-agent: small service on the computer running herdr. Listens on
                Tailscale only, pairs devices, proxies herdr's API, starts mosh sessions
apps/mobile     the Expo app (Android, iOS, iPadOS)
```

## Plan

1. Core + agent, tested against a real mosh-server and herdr from Node
2. Expo app on Android
3. iOS and iPad (EAS builds), iPad layout and hardware keyboards
4. Polish, then push notifications from the agent

## Development

Needs Node 24 (`mise install` picks it up from `mise.toml`), plus herdr, mosh-server and
Tailscale on the computer.

```sh
npm install
npm test            # core (incl. a real mosh-server over loopback) + agent (against herdr)
npm run typecheck
```

TypeScript runs directly on Node's type stripping: no build step, erasable syntax only
(no enums, no parameter properties), imports with `.ts` extensions.

The agent tests use an isolated herdr session so they never touch your own: start one with
`HERDR_SESSION=scratch herdr server &` (or set `CORRAL_TEST_SESSION`).

## corral-agent

```sh
npm run agent -- serve          # foreground; listens on this machine's Tailscale IPs, port 7337
npm run agent -- install        # or run it as a systemd user service
npm run agent -- pair           # one-time code for the app
npm run agent -- devices        # paired devices; `revoke <id>` to unpair one
```

A device can connect only if it is signed in to the same Tailscale account as this computer
(`tailscale whois`), and then only with the token it got when pairing. The agent proxies herdr's
API and starts `mosh-server` sessions for `herdr terminal attach --takeover`; the terminal itself
flows over mosh (UDP 60000-61000 on the Tailscale address), end to end between app and server.
The app talks to the agent over plain `ws://`: the agent only listens on the Tailscale address,
where WireGuard already encrypts the traffic, so the Android app allows cleartext connections.
