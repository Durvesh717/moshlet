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
