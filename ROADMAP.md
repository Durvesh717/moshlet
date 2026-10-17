# Roadmap

## Done

1. **Core**: mosh protocol, terminal emulator and herdr API types, tested against a real
   mosh-server, sshd and herdr from Node.
2. **Android app**: SSH sign-in with a key kept on the device (guided setup, nothing installed on
   the computer), panes over mosh, sidebar of agents (each with its maker's mark), workspaces, tabs
   and panes, approvals, History, dictation. UI built from React Native Reusables (shadcn) on
   Uniwind, with seven themes in Settings: Moshlet Cobalt (the default), Moshlet Glacier, Moshlet
   Daylight, Catppuccin, Gruvbox, Kanagawa and Black & White.

## Next (not yet scheduled)

- **The Moshlet logo.** The app, launcher icon and splash screen show a stand-in prompt mark
  until the logo is ready.
- **Beyond herdr.** tmux sessions, plain terminals, and single coding agents (Claude Code, Codex
  and others) started straight from a shell, over the same SSH and mosh.
- **Merge phase 2 into `main`.** Phase 2 passes a fresh clone, the tests and use on a phone.
- **Approval notifications (Android).** A foreground service keeps the SSH connection open, watches
  herdr's events and notifies when an agent needs approval, even with the app in the background.
  Tapping the notification opens that pane.
- **Polish**
  - Remember the font size set by pinching (it resets on every launch).
  - Check the sidebar scrolls in landscape on a phone (not reproducible on the emulator).
- **iOS and iPad**
  - An iOS native module for SSH and the device key (for example swift-nio-ssh or Citadel, with the
    key in the Keychain or Secure Enclave), plus UDP for mosh.
  - iPad layout (sidebar always shown on wide screens) and hardware keyboard shortcuts.
  - Builds through EAS: needs an Expo account, and an Apple Developer account to install on devices.

## Ideas

- **Smoother live scrolling.** Live panes scroll in whole steps once the computer's frame arrives.
  Two ways to make that smoother without blank rows, if it is ever wanted:
  - follow the finger only as far as rows the phone has already received, then wait;
  - fetch the pane's history ahead of time, so a drag scrolls real rows locally and herdr catches up.
