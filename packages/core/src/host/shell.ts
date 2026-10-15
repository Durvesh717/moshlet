/**
 * Running commands on the computer, over SSH: the phone's native SSH client implements this, and
 * tests use the `ssh` command. Commands are POSIX sh scripts built with `posix()`.
 */
export interface ExecResult {
  /** Exit status, or null when the command was killed or didn't report one. */
  status: number | null;
  stdout: string;
  stderr: string;
}

export interface Shell {
  /** Runs a command to completion. `stdin` is written, then closed. */
  exec(command: string, opts?: { stdin?: string; timeoutMs?: number }): Promise<ExecResult>;
  /**
   * Starts a long-running command: writes `stdin` (left open), then hands every line of its
   * output to `onLine` until it ends or is closed.
   */
  stream(command: string, stdin: string, onLine: (line: string) => void, onEnd: (reason: string) => void): Promise<{ close(): void }>;
}

export class ShellError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.code = code;
  }
}

/** Quotes a string for POSIX sh (and fish), without backslashes. */
export const quote = (s: string): string => "'" + s.replace(/'/g, `'"'"'`) + "'";

/**
 * Where herdr and mosh-server usually live, beyond the short PATH an SSH command gets
 * (Homebrew, ~/.local/bin, Nix, cargo).
 */
const PATH_EXTRA = [
  "$HOME/.local/bin",
  "$HOME/bin",
  "/opt/homebrew/bin",
  "/usr/local/bin",
  "/home/linuxbrew/.linuxbrew/bin",
  "$HOME/.nix-profile/bin",
  "/nix/var/nix/profiles/default/bin",
  "$HOME/.cargo/bin",
];

/**
 * Wraps a POSIX sh script into one command line that runs the same whatever the login shell is
 * (bash, zsh, fish...). Scripts have no backslashes: fish reads them inside single quotes.
 */
export function posix(script: string): string {
  if (script.includes("\\")) throw new Error("posix scripts can't contain backslashes");
  return `sh -c ${quote(`PATH="$PATH:${PATH_EXTRA.join(":")}"; export PATH; ${script}`)}`;
}
