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
4. **Copy from the terminal**: a long press selects the word under the finger (a whole path or
   URL); dragging on, or dragging either handle, moves the ends. Copy, Select all and Cancel cover
   the key bar while text is selected. In History mode the selection runs through the scrollback
   and scrolls on at the top or bottom edge. The pane map moved off the long press; its pill in the
   top bar opens it.
5. **More kinds of approval.** The approval sheet reads four kinds of dialog off the screen:
   - **Numbered choices** ("1. Yes / 2. No"), with choices that wrap over several lines shown
     whole: a tap types the digit.
   - **Choices picked with arrows** (Claude Code's folder trust, omp's questions): a tap moves the
     cursor there a row at a time, then presses Enter; Cancel sends Esc.
   - **omp's ask** with one or more questions in a box: radios picked with Enter, tick-boxes
     ticked with Space, and Submit. The sheet stays open, showing what's picked, until Submit.
   - **Claude Code's question forms**: a tab per question, options with their descriptions,
     tick-boxes that stay open and show what's ticked, an answer of one's own typed in the reply
     box, Back, Next, and the review with Submit answers and Cancel. The sheet stays open from
     one question to the next. herdr doesn't always report a form as needing approval, so the
     sheet also opens when the screen shows one.
   Each key is sent only while the dialog reads as it did when shown, and after every arrow the
   screen is read again to check the cursor moved one row and nothing else changed.

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
  - Copied lines that herdr wrapped come out as separate lines: both the live screen and herdr's
    `recent` read arrive already wrapped at the pane's width.
  - herdr shows Claude Code's several-question forms as idle when the phone's pane is narrow, so
    the approval sheet doesn't open by itself: the footer "Enter to select · Tab/Arrow keys to
    navigate · Esc to cancel" wraps, and herdr's `live_blocked_form` rule looks for "esc to
    cancel" on one line. Fix upstream in herdr's Claude manifest (match across the wrap), or let
    the sheet open from the top bar whenever the screen reads as a dialog.
- **More kinds of approval, still to come**
  - An answer of one's own for omp's questions ("Other (type your own)") from the reply box, as
    for Claude Code's forms.
  - Approval alerts for question forms that herdr reports as idle: the alerts follow herdr's
    status, so with the phone locked they only fire for forms herdr marks as blocked.
- **Plans, Markdown and reviewing changes**
  - **A Markdown viewer:** open a Markdown file from the computer over SSH (a path typed or picked
    from a list) and read it rendered on the phone: headings, lists, tables, code blocks.
  - **Plans:** the plans an agent writes (Claude Code's plan mode, a `PLAN.md` in the project)
    listed per project and opened in the viewer, refreshed when the file changes.
  - **Review changes:** the diff of a project's uncommitted work (`git diff` over SSH), file by
    file, to read what an agent changed before approving or committing.
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

- **Smoother live scrolling.** Live panes scroll in whole steps: a drag sends wheel notches, and the
  content moves only when the computer's next frame arrives, a round trip later. Ways to smooth it,
  cheapest first:
  - **Follow the finger within a step:** draw the current frame offset by the drag not yet sent as
    a notch (under one notch: 1 row in Claude Code, 3 in herdr), and snap when the frame lands.
    The strip uncovered is at most a notch tall, filled from rows already received or left blank.
    No new requests; works for every pane.
  - **Scroll herdr's own history locally:** where herdr owns the scrollback (shells, not Claude Code
    or omp, which scroll themselves), read `recent` when a drag starts, as History does, scroll
    those rows on the phone at finger speed, and send the notches behind it so herdr catches up.
    Real rows, no blanks; one read per drag, and the wheel position is reconciled on release.
  - **Predict the next frame:** for herdr-owned scrollback a notch shifts the screen by three rows,
    so the phone can draw the shifted screen at once from the rows it holds and replace it when
    the frame arrives, the way mosh predicts typing. Builds on the previous idea.
