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
  - **Agent chat.** A chat screen for a coding agent, beside its terminal. The agent keeps running
    as its own interactive program in a herdr pane or tmux window, and the phone shows it as a
    conversation: replies, thinking, tool calls with their output, diffs and to-do lists.
    - The phone follows the agent's own session file over SSH (Claude Code's
      `~/.claude*/projects/<folder>/<session>.jsonl`, Codex's `~/.codex/sessions/`) and catches up
      from where it stopped after a reconnect. Nothing extra is installed on the computer.
    - Messages are typed into the agent's terminal (herdr's `agent.prompt`, or a tmux paste).
      Approvals work as they do now. Anything the chat can't show (menus, pickers) is one tap away
      in the terminal view of the same session.
    - An agent started from the phone opens in a new pane or tmux window; Claude Code gets a known
      session id (`claude --session-id`). For an agent started on the computer, the session file
      is the newest one for its folder.
    - Past sessions are listed from the same files and resumed in a new pane (`claude --resume`).
    - Each agent's session file is undocumented and changes between versions, so each needs its
      own reader and tests. Claude Code and Codex first.
    - The agent is the ordinary interactive program, so a Claude subscription is used just as it
      is in a terminal. Moshlet never reads an agent's saved login or calls a model provider.
    - Let the user pick the Claude config folder (`CLAUDE_CONFIG_DIR`), because commands over SSH
      may not load the shell profile.
- **Merge phase 2 into `main`.** Phase 2 passes a fresh clone, the tests and use on a phone.
- **Polish**
  - Check the sidebar scrolls in landscape on a phone (not reproducible on the emulator).
  - **Copy from terminal**: select and copy text from the terminal screen and scrollback to the clipboard (e.g. via long-press or a selection mode).
- **More kinds of approval.** The approval sheet knows numbered choices ("1. Yes / 2. No"): a tap
  types the digit and closes the sheet. Still to come:
  - **Claude Code's question forms** (several questions, or tick-boxes): tabs to move between the
    questions, ticking that keeps the sheet open and shows the boxes ticked, Next and Submit
    buttons, and "Type something" filled from the reply box.
  - **Choices picked with arrows** instead of digits, like omp's approvals and questions (↑/↓,
    Enter to pick, Esc to deny, typing denies and steers). The sheet finds no numbers there and
    offers only Approve (Enter) and Reject (Esc), so "Always allow" and the like need the terminal.
    Read where the cursor is and move it, reading the screen again before each step.
  - Every step is still sent only while the dialog reads as it did when shown.
- **iOS and iPad**
  - An iOS native module for SSH and the device key (for example swift-nio-ssh or Citadel, with the
    key in the Keychain or Secure Enclave), plus UDP for mosh.
  - iPad layout (sidebar always shown on wide screens) and hardware keyboard shortcuts.
  - Builds through EAS: needs an Expo account, and an Apple Developer account to install on devices.

## Ideas

- **Agent chat over ACP.** Talk to agents with the Agent Client Protocol instead of their
  terminal: approvals as the agent's own choices, and modes and models as buttons. It would need a
  helper on the computer to keep agents running between connections, and Claude Code only through
  `@agentclientprotocol/claude-agent-acp` signed in with `claude /login`. Anthropic may bill that
  use separately from a subscription's normal limits.

- **Smoother live scrolling.** Live panes scroll in whole steps once the computer's frame arrives.
  Two ways to make that smoother without blank rows, if it is ever wanted:
  - follow the finger only as far as rows the phone has already received, then wait;
  - fetch the pane's history ahead of time, so a drag scrolls real rows locally and herdr catches up.
