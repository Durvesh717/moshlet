# Moshlet

A phone and tablet client for your coding agents: watch and steer them from Android today, and
iPhone and iPad next. It signs in over SSH and streams panes from `mosh-server`, so they survive
bad networks and sleep. Today it works with herdr; tmux sessions, plain terminals and single
agents come next.

## Layout

```
packages/core   TypeScript core: mosh protocol, terminal emulator, herdr API types, and the
                commands the app runs over SSH (runs in Node and React Native)
apps/mobile     the Expo app (Android, iOS, iPadOS)
```

## How it connects

Nothing is installed on the computer beyond what herdr already needs. The app signs in over
SSH with its own key, which lives on the device and is unlocked with fingerprint or PIN.
Setting up a computer in the app walks through it once:

1. Tailscale on both devices, SSH sign-in turned on, mosh installed, herdr running
2. The computer's Tailscale name and your username
3. Compare the computer's host key fingerprint with the one the app shows
4. Sign in once with your password so the app can add its key (or add the key line yourself)
5. The app checks for mosh and herdr, then you pick a herdr session

After that, herdr's API runs through `herdr remote-api-bridge` over SSH, and each pane opens
in a `mosh-server` running `herdr terminal attach --takeover`. The terminal itself flows over
mosh's protocol (UDP 60000-61000 on the Tailscale address), end to end between the app's own
mosh-compatible client and the server. To remove a device, delete its line from
`~/.ssh/authorized_keys` on the computer.

## Plan

Done: the core and the Android app. What comes next, and ideas, are in [ROADMAP.md](ROADMAP.md).

## Development

Needs Node 24 (`mise install` picks it up from `mise.toml`), plus herdr, mosh-server and
`/usr/bin/sshd` on the computer.

```sh
npm install
npm test            # core, incl. a real mosh-server and herdr over a throwaway sshd on loopback
npm run typecheck
```

TypeScript runs directly on Node's type stripping: no build step, erasable syntax only
(no enums, no parameter properties), imports with `.ts` extensions.

The tests use an isolated herdr session so they never touch your own: start one with
`herdr --session scratch server &` (or set `MOSHLET_TEST_SESSION`). The test sshd only
listens on loopback, trusts one generated key, and never reads or writes `~/.ssh`.

## License

MIT, see [LICENSE](LICENSE). The bundled fonts keep their own licenses, in
`apps/mobile/assets/fonts/licenses/`.
