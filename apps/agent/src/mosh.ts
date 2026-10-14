import { execFileSync, spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { herdrBin } from "./herdr.ts";

/**
 * How long a mosh-server survives without hearing from its phone (app killed, phone off). While
 * it lives, its pane keeps the phone's size on the desktop; herdr keeps the real state, so
 * reattaching is cheap.
 */
export const MOSH_IDLE_TIMEOUT_SEC = 20;

export interface MoshServer {
  pid: number;
  port: number;
  key: string;
}

/**
 * Starts `mosh-server` running `herdr terminal attach <terminalId> --takeover`, bound to `bindIp`
 * (the Tailscale address the phone reached us on). mosh-server daemonizes, so the pid is read
 * from its "detached, pid = N" line rather than taken from the spawned process.
 */
export function startMosh(opts: { bindIp: string; session: string; terminalId: string; lang?: string }): Promise<MoshServer> {
  const lang = opts.lang ?? process.env.LANG ?? "C.UTF-8";
  const env: NodeJS.ProcessEnv = { ...process.env, LANG: lang, MOSH_SERVER_NETWORK_TMOUT: String(MOSH_IDLE_TIMEOUT_SEC) };
  if (opts.session !== "default") env.HERDR_SESSION = opts.session;
  else delete env.HERDR_SESSION;
  const args = ["new", "-i", opts.bindIp, "-c", "256", "-l", `LANG=${lang}`, "--", herdrBin(), "terminal", "attach", opts.terminalId, "--takeover"];

  return new Promise((resolve, reject) => {
    const proc = spawn("mosh-server", args, { env, stdio: ["ignore", "pipe", "pipe"] });
    let out = "";
    let port = 0;
    let key = "";
    let pid = 0;
    const timer = setTimeout(() => fail(new Error(`mosh-server didn't start: ${out.trim().slice(0, 300)}`)), 10_000);
    const settle = () => {
      if (port && key && pid) {
        clearTimeout(timer);
        resolve({ pid, port, key });
      }
    };
    const fail = (e: Error) => {
      clearTimeout(timer);
      reject(e);
    };
    const onData = (b: Buffer) => {
      out += b.toString();
      const c = /MOSH CONNECT (\d+) (\S+)/.exec(out);
      if (c) {
        port = Number(c[1]);
        key = c[2];
      }
      const d = /detached, pid = (\d+)/.exec(out);
      if (d) pid = Number(d[1]);
      settle();
    };
    proc.stdout.on("data", onData);
    proc.stderr.on("data", onData);
    proc.on("error", (e) => fail(new Error(`couldn't run mosh-server: ${e.message}`)));
    proc.on("exit", () => setTimeout(() => (port && key && pid ? settle() : fail(new Error(`mosh-server exited: ${out.trim().slice(0, 300)}`))), 50));
  });
}

/**
 * Ends a mosh-server; herdr then gives its pane back its desktop size. With a phone connected,
 * mosh-server treats the first signal as "shut down politely" and waits for the phone to
 * acknowledge; a second signal makes it quit at once, and SIGKILL is the last resort.
 */
export function stopMosh(pid: number): void {
  const signal = (sig: NodeJS.Signals) => {
    try {
      process.kill(pid, sig);
    } catch {
      // already gone
    }
  };
  signal("SIGTERM");
  // Re-check it's still our mosh-server before each follow-up, so a reused pid is never hit.
  setTimeout(() => isMoshServer(pid) && signal("SIGTERM"), 300).unref();
  setTimeout(() => isMoshServer(pid) && signal("SIGKILL"), 2000).unref();
}

function isMoshServer(pid: number): boolean {
  if (!isAlive(pid)) return false;
  try {
    return readFileSync(`/proc/${pid}/cmdline`, "utf8").split("\0")[0].endsWith("mosh-server");
  } catch {
    try {
      return execFileSync("ps", ["-p", String(pid), "-o", "comm="]).toString().trim().endsWith("mosh-server");
    } catch {
      return false;
    }
  }
}

export function isAlive(pid: number): boolean {
  if (pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}
