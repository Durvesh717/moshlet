import { HerdrError, subscriptions, type HerdrCall } from "../herdr/api.ts";
import { posix, quote, ShellError, type Shell } from "./shell.ts";

/**
 * Everything Moshlet does on the computer, as shell commands over SSH: herdr's API through
 * `herdr remote-api-bridge` (herdr's own stdio bridge), and mosh-server for terminals. Nothing
 * of Moshlet's is installed there.
 */

export interface SessionInfo {
  name: string;
  running: boolean;
  default: boolean;
}

export interface MoshEndpoint {
  port: number;
  /** mosh's base64 session key. */
  key: string;
  /** mosh-server's pid on the computer, to end it later. */
  pid: number;
}

/** What the computer has, for setup: each missing piece comes with a way to fix it. */
export interface HostCheck {
  hostname: string;
  user: string;
  /** Path of herdr, or null when it isn't installed (or not on PATH). */
  herdr: string | null;
  herdrVersion: string | null;
  /** herdr has the stdio bridge Moshlet uses (herdr 0.9 and later). */
  bridge: boolean;
  /** Path of mosh-server, or null. */
  mosh: string | null;
  sessions: SessionInfo[];
}

/**
 * How long a mosh-server survives without hearing from its phone (app killed, phone off). While
 * it lives, its pane keeps the phone's size on the desktop; herdr keeps the real state, so
 * reattaching is cheap.
 */
export const MOSH_IDLE_TIMEOUT_SEC = 20;

/** The one environment variable that picks a herdr session; "default" means none. */
const sessionEnv = (session: string): string =>
  session === "default" ? "unset HERDR_SESSION; " : `HERDR_SESSION=${quote(session)}; export HERDR_SESSION; `;

const NO_HERDR = "MOSHLET-NO-HERDR";
const NO_MOSH = "MOSHLET-NO-MOSH";
const findHerdr = `h=$(command -v herdr) || { echo ${NO_HERDR} >&2; exit 127; }; `;

/** Tags this device's mosh-servers on the computer, so leftovers from a killed app can be found. */
export const safeTag = (tag: string): string => tag.replace(/[^A-Za-z0-9]/g, "").slice(0, 24);

/** An OpenSSH public key line we're willing to put in authorized_keys. */
const KEY_LINE = /^ssh-ed25519 [A-Za-z0-9+/]+={0,2}( [A-Za-z0-9._@+-]+)?$/;

export class HostLink {
  private readonly shell: Shell;

  constructor(shell: Shell) {
    this.shell = shell;
  }

  /** herdr's sessions on the computer. */
  async sessions(): Promise<SessionInfo[]> {
    const r = await this.shell.exec(posix(`${findHerdr}exec "$h" session list --json`));
    if (r.stderr.includes(NO_HERDR)) throw new ShellError("no_herdr", "herdr isn't installed on the computer (or isn't on PATH).");
    if (r.status !== 0) throw new ShellError("herdr_failed", `couldn't list herdr sessions: ${firstLine(r.stderr) || `exit ${r.status}`}`);
    return parseSessions(r.stdout);
  }

  /** A HerdrCall bound to one session: each request is one short-lived bridge process. */
  herdr(session: string): HerdrCall {
    const command = posix(`${sessionEnv(session)}${findHerdr}exec "$h" remote-api-bridge`);
    return async (method, params) => {
      const r = await this.shell.exec(command, { stdin: JSON.stringify({ id: "1", method, params: params ?? {} }) + "\n" });
      const line = r.stdout.split("\n").find((l) => l.trim() !== "");
      if (!line) {
        if (r.stderr.includes(NO_HERDR)) throw new ShellError("no_herdr", "herdr isn't installed on the computer (or isn't on PATH).");
        if (/remote Herdr API socket/.test(r.stderr)) throw new ShellError("herdr_unavailable", `herdr session ${session} isn't running.`);
        throw new ShellError("herdr_unavailable", `herdr didn't answer: ${firstLine(r.stderr) || `exit ${r.status}`}`);
      }
      let msg: { result?: Record<string, unknown>; error?: { code?: string; message?: string } };
      try {
        msg = JSON.parse(line);
      } catch {
        throw new HerdrError("bad_reply", `herdr's reply wasn't readable: ${line.slice(0, 80)}`);
      }
      if (msg.error) throw new HerdrError(msg.error.code ?? "error", msg.error.message ?? "herdr error");
      return msg.result ?? {};
    };
  }

  /**
   * Streams a session's events (herdr allows agent-status subscriptions one pane each, so callers
   * pass the panes they care about). Resolves once herdr confirms, so nothing after it is missed.
   */
  watch(session: string, statusPanes: readonly string[], onEvent: (event: Record<string, unknown>) => void, onEnd: (reason: string) => void): Promise<{ close(): void }> {
    const command = posix(`${sessionEnv(session)}${findHerdr}exec "$h" remote-api-bridge`);
    const request = JSON.stringify({ id: "sub", method: "events.subscribe", params: { subscriptions: subscriptions(statusPanes) } }) + "\n";
    return new Promise((resolve, reject) => {
      let started = false;
      let ended = false;
      let handle: { close(): void } | null = null;
      const end = (reason: string, byUs = false) => {
        if (ended) return;
        ended = true;
        handle?.close();
        if (!started) reject(new ShellError("herdr_unavailable", reason));
        else if (!byUs) onEnd(reason);
      };
      const onLine = (line: string) => {
        let msg: Record<string, unknown>;
        try {
          msg = JSON.parse(line);
        } catch {
          return;
        }
        const err = msg.error as { message?: string } | undefined;
        if (err) return end(`subscribe failed: ${err.message ?? "error"}`);
        if ((msg.result as { type?: string } | undefined)?.type === "subscription_started") {
          if (started) return;
          started = true;
          resolve({ close: () => end("closed", true) });
        } else if ("event" in msg && started) onEvent(msg);
      };
      this.shell.stream(command, request, onLine, (reason) => end(reason || "herdr closed the event stream")).then(
        (h) => {
          handle = h;
          if (ended) h.close();
        },
        (e: Error) => end(e.message),
      );
    });
  }

  /**
   * Starts mosh-server running `herdr terminal attach <terminalId> --takeover` (herdr allows one
   * viewer per terminal; the newest wins, which also clears out viewers a killed app left). `-s`
   * binds it to the address this SSH connection arrived on: the Tailscale address.
   */
  async startMosh(session: string, terminalId: string, tag: string): Promise<MoshEndpoint> {
    const script =
      `LANG="\${LANG:-C.UTF-8}"; export LANG MOSH_SERVER_NETWORK_TMOUT=${MOSH_IDLE_TIMEOUT_SEC}; ${sessionEnv(session)}` +
      `command -v mosh-server >/dev/null || { echo ${NO_MOSH} >&2; exit 127; }; ${findHerdr}` +
      `exec mosh-server new -s -c 256 -l LANG="$LANG" -l MOSHLET_CLIENT=${safeTag(tag)} -- "$h" terminal attach ${quote(terminalId)} --takeover`;
    const r = await this.shell.exec(posix(script), { timeoutMs: 20_000 });
    const connect = /MOSH CONNECT (\d+) (\S+)/.exec(r.stdout);
    if (!connect) {
      if (r.stderr.includes(NO_MOSH)) throw new ShellError("no_mosh", "mosh-server isn't installed on the computer.");
      if (r.stderr.includes(NO_HERDR)) throw new ShellError("no_herdr", "herdr isn't installed on the computer (or isn't on PATH).");
      throw new ShellError("mosh_failed", `mosh-server didn't start: ${r.stderr.trim().slice(0, 300) || `exit ${r.status}`}`);
    }
    const pid = Number(/detached, pid = (\d+)/.exec(r.stderr)?.[1] ?? 0);
    return { port: Number(connect[1]), key: connect[2], pid };
  }

  /**
   * Ends one of this device's mosh-servers; herdr then gives its pane back its desktop size. With
   * a phone connected, mosh-server takes the first signal as "shut down politely" and waits for an
   * acknowledgement; a second makes it quit, and SIGKILL is the last resort. Runs in the
   * background on the computer, and only ever signals a process that is still that mosh-server.
   */
  async stopMosh(pid: number, tag: string): Promise<void> {
    if (!(pid > 0)) return;
    const script =
      `p=${pid}; alive() { ps -p $p -o args= 2>/dev/null | grep -q "mosh-server.*MOSHLET_CLIENT=${safeTag(tag)} "; }; ` +
      `alive || exit 0; ( kill $p; sleep 0.3; alive && kill $p; sleep 1.7; alive && kill -9 $p ) </dev/null >/dev/null 2>&1 &`;
    await this.shell.exec(posix(script));
  }

  /** Ends every mosh-server this device left behind (app killed, phone gone). Returns how many processes it signalled. */
  async endMoshSessions(tag: string): Promise<number> {
    // "[m]osh" keeps the pattern from matching this command's own shell.
    const pattern = quote(`[m]osh-server new .*MOSHLET_CLIENT=${safeTag(tag)} `);
    const r = await this.shell.exec(posix(`n=$(pgrep -f ${pattern} | wc -l); pkill -f ${pattern}; echo $n`));
    return Number(r.stdout.trim()) || 0;
  }

  /** What's installed and running, for setup. */
  async check(): Promise<HostCheck> {
    const script =
      `echo "host=$(uname -n)"; echo "user=$(id -un)"; ` +
      `m=$(command -v mosh-server) && echo "mosh=$m"; ` +
      `if h=$(command -v herdr); then echo "herdr=$h"; echo "herdrVersion=$("$h" --version 2>/dev/null)"; ` +
      `b=$("$h" remote-api-bridge --check 2>/dev/null) && echo "bridge=$b"; printf "sessions="; "$h" session list --json 2>/dev/null; fi; true`;
    const r = await this.shell.exec(posix(script));
    const lines = r.stdout.split("\n");
    const value = (k: string): string | null => {
      const l = lines.find((x) => x.startsWith(`${k}=`));
      return l === undefined ? null : l.slice(k.length + 1).trim();
    };
    const sessionsAt = r.stdout.indexOf("sessions=");
    let sessions: SessionInfo[] = [];
    if (sessionsAt >= 0) {
      try {
        sessions = parseSessions(r.stdout.slice(sessionsAt + "sessions=".length));
      } catch {
        // herdr is there but couldn't list sessions; shown as "no sessions".
      }
    }
    return {
      hostname: value("host") ?? "",
      user: value("user") ?? "",
      herdr: value("herdr"),
      herdrVersion: value("herdrVersion")?.replace(/^herdr\s+/, "") || null,
      bridge: !!value("bridge"),
      mosh: value("mosh"),
      sessions,
    };
  }

  /** Adds this phone's public key to ~/.ssh/authorized_keys, once (as ssh-copy-id would), restricted (see authorizedKeyLine). */
  async installKey(publicKeyLine: string): Promise<void> {
    const k = quote(authorizedKeyLine(publicKeyLine));
    const f = `"$HOME/.ssh/authorized_keys"`;
    const script =
      `umask 077; mkdir -p "$HOME/.ssh" && touch ${f} && { grep -qxF ${k} ${f} || { ` +
      // Don't glue the key onto a last line that has no newline.
      `if [ -s ${f} ] && [ -n "$(tail -c 1 ${f})" ]; then echo >> ${f}; fi; echo ${k} >> ${f}; }; }`;
    const r = await this.shell.exec(posix(script));
    if (r.status !== 0) throw new ShellError("install_failed", `Couldn't add the key: ${firstLine(r.stderr) || `exit ${r.status}`}`);
  }
}

/**
 * The authorized_keys line for this phone's public key. `restrict` turns off port, agent and X11
 * forwarding and terminal (pty) allocation, none of which Moshlet uses (it runs commands, and
 * mosh-server makes its own terminal), so a stolen key couldn't reach the computer's network.
 */
export function authorizedKeyLine(publicKeyLine: string): string {
  const line = publicKeyLine.trim();
  if (!KEY_LINE.test(line)) throw new Error("that doesn't look like this app's public key");
  return `restrict ${line}`;
}

function parseSessions(json: string): SessionInfo[] {
  let parsed: { sessions?: unknown };
  try {
    parsed = JSON.parse(json);
  } catch {
    throw new ShellError("herdr_failed", "herdr's session list wasn't readable");
  }
  const list = Array.isArray(parsed?.sessions) ? (parsed.sessions as { name?: unknown; running?: unknown; default?: unknown }[]) : [];
  return list.filter((s) => typeof s?.name === "string").map((s) => ({ name: s.name as string, running: !!s.running, default: !!s.default }));
}

const firstLine = (s: string): string => s.trim().split("\n")[0] ?? "";
