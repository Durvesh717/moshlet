import { execFileSync, spawn, type ChildProcess } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { connect, createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ExecResult, Shell } from "../../src/host/shell.ts";

/** Runs a command line the way sshd would, through `sh -c`, with extra environment (e.g. a scratch HOME). */
export function localShell(env: Record<string, string> = {}): Shell {
  return processShell((command) => spawn("/bin/sh", ["-c", command], { env: { ...process.env, ...env } }));
}

/** Runs commands over SSH with the `ssh` command, so they go through the account's real login shell. */
export function sshShell(port: number, key: string): Shell {
  const args = ["-p", String(port), "-i", key, "-o", "BatchMode=yes", "-o", "StrictHostKeyChecking=no", "-o", "UserKnownHostsFile=/dev/null", "-o", "LogLevel=ERROR", "127.0.0.1"];
  return processShell((command) => spawn("ssh", [...args, "--", command]));
}

/**
 * A command can exit before reading all its input (a fast `sh` like dash does), which breaks the pipe:
 * how it went is in its exit, so that's not an error of its own.
 */
function ignoreBrokenPipe(proc: ChildProcess, fail: (e: Error) => void): void {
  proc.stdin!.on("error", (e: NodeJS.ErrnoException) => {
    if (e.code !== "EPIPE") fail(e);
  });
}

function processShell(start: (command: string) => ChildProcess): Shell {
  return {
    exec(command, opts = {}) {
      return new Promise<ExecResult>((resolve, reject) => {
        const proc = start(command);
        let stdout = "";
        let stderr = "";
        const timer = setTimeout(() => proc.kill("SIGKILL"), opts.timeoutMs ?? 15_000);
        proc.stdout!.on("data", (b: Buffer) => (stdout += b.toString()));
        proc.stderr!.on("data", (b: Buffer) => (stderr += b.toString()));
        proc.on("error", reject);
        ignoreBrokenPipe(proc, reject);
        proc.on("close", (status) => {
          clearTimeout(timer);
          resolve({ status, stdout, stderr });
        });
        proc.stdin!.end(opts.stdin ?? "");
      });
    },
    async stream(command, stdin, onLine, onEnd) {
      const proc = start(command);
      let buf = "";
      proc.stdout!.on("data", (b: Buffer) => {
        buf += b.toString();
        let nl: number;
        while ((nl = buf.indexOf("\n")) >= 0) {
          const line = buf.slice(0, nl);
          buf = buf.slice(nl + 1);
          onLine(line);
        }
      });
      proc.on("close", () => onEnd("ended"));
      ignoreBrokenPipe(proc, (e) => onEnd(e.message));
      proc.stdin!.write(stdin);
      return { close: () => proc.kill() };
    },
  };
}

/**
 * A throwaway, unprivileged sshd on loopback that only trusts one generated key, so tests never
 * touch ~/.ssh. Null when this machine has no sshd.
 */
export async function startTestSshd(): Promise<{ port: number; key: string; stop(): void } | null> {
  if (!existsSync("/usr/bin/sshd")) return null;
  const dir = mkdtempSync(join(tmpdir(), "moshlet-sshd-"));
  execFileSync("ssh-keygen", ["-q", "-t", "ed25519", "-N", "", "-f", join(dir, "host_ed25519")]);
  execFileSync("ssh-keygen", ["-q", "-t", "ed25519", "-N", "", "-C", "moshlet-test", "-f", join(dir, "client")]);
  // Restricted the way the app installs its key, so everything here runs as it would for the phone.
  writeFileSync(join(dir, "authorized_keys"), `restrict ${readFileSync(join(dir, "client.pub"), "utf8")}`);
  const port = await freePort();
  writeFileSync(
    join(dir, "sshd_config"),
    [
      `Port ${port}`,
      "ListenAddress 127.0.0.1",
      `HostKey ${join(dir, "host_ed25519")}`,
      `AuthorizedKeysFile ${join(dir, "authorized_keys")}`,
      `PidFile ${join(dir, "sshd.pid")}`,
      "UsePAM no",
      "StrictModes no",
      "PasswordAuthentication no",
      "KbdInteractiveAuthentication no",
      "PubkeyAuthentication yes",
      // The test's mosh-servers outlive their SSH sessions, as on a real computer.
      "MaxSessions 20",
    ].join("\n") + "\n",
  );
  const proc = spawn("/usr/bin/sshd", ["-D", "-e", "-f", join(dir, "sshd_config")], { stdio: "ignore" });
  for (let i = 0; i < 50; i++) {
    if (await canConnect(port)) return { port, key: join(dir, "client"), stop: () => proc.kill() };
    await new Promise((r) => setTimeout(r, 100));
  }
  proc.kill();
  throw new Error("test sshd didn't start");
}

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = createServer();
    srv.listen(0, "127.0.0.1", () => {
      const port = (srv.address() as { port: number }).port;
      srv.close(() => resolve(port));
    });
    srv.on("error", reject);
  });
}

function canConnect(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const c = connect(port, "127.0.0.1");
    c.on("connect", () => {
      c.destroy();
      resolve(true);
    });
    c.on("error", () => resolve(false));
  });
}
