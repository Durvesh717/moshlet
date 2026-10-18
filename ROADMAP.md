# Roadmap

## Done

1. **Core**: mosh protocol, terminal emulator and herdr API types, tested against a real
   mosh-server, sshd and herdr from Node.
2. **Android app**: SSH sign-in with a key kept on the device (guided setup, nothing installed on
   the computer), panes over mosh, sidebar of agents (each with its maker's mark), workspaces, tabs
   and panes, approvals, History, dictation. UI built from React Native Reusables (shadcn) on
   Uniwind. Settings: seven themes (Moshlet Cobalt, the default, Moshlet Glacier, Moshlet Daylight,
   Catppuccin, Gruvbox, Kanagawa and Black & White), seven terminal fonts and the text size (also
   set by pinching), kept between launches.
3. **Approval alerts (Android)**: a Settings switch. While a computer is open, a foreground service
   keeps the connection open and Moshlet notifies when an agent needs approval (with the question
   read off its screen), even with the phone locked; tapping the notification opens that pane.

## Next (not yet scheduled)

- **The Moshlet logo.** The app, launcher icon and splash screen show a stand-in prompt mark
  until the logo is ready.
- **Beyond herdr**
  - **tmux sessions and plain terminals**, over the same SSH and mosh.
  - **Agent chat.** A chat screen for a coding agent instead of its terminal, talking to the agent
    over SSH with the Agent Client Protocol (ACP). Lists the agent's sessions on the computer and
    opens them with their history; streams replies, thinking, tool calls, diffs and plans; shows
    approvals as the agent's own choices (allow once, always, reject); offers each agent's modes,
    models and slash commands.
    - Agents: Gemini, OpenCode and Copilot have ACP built in. Claude Code goes through
      `@agentclientprotocol/claude-agent-acp`, which runs the official Claude Code through
      Anthropic's Agent SDK and signs in only with `claude /login`. Codex goes through `codex-acp`.
    - Moshlet never reads an agent's saved login or calls a model provider itself, and never uses
      Claude through OpenCode. Anthropic allows a subscription in Claude Code and the Agent SDK,
      not in other apps that use its login.
    - A small helper on the computer keeps agents running while the phone is away and lets the
      app catch up when it reconnects. Without it, chat works only while the app is open.
    - Let the user pick the Claude config folder (`CLAUDE_CONFIG_DIR`), because commands over SSH
      may not load the shell profile.
    - A session open in a terminal and in chat at the same time splits in two, so chat is for
      sessions started from the phone or not running anywhere else.
- **Merge phase 2 into `main`.** Phase 2 passes a fresh clone, the tests and use on a phone.
- **Polish**
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
