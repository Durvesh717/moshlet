import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { createConnection } from "node:net";
import { homedir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

const run = promisify(execFile);

/** The herdr binary: $HERDR_BIN, else PATH, else the usual install spots (a systemd unit's PATH is short). */
export function herdrBin(): string {
  if (process.env.HERDR_BIN) return process.env.HERDR_BIN;
  for (const dir of (process.env.PATH ?? "").split(":")) {
    if (dir && existsSync(join(dir, "herdr"))) return join(dir, "herdr");
  }
  for (const p of [join(homedir(), ".local/bin/herdr"), "/usr/local/bin/herdr", "/usr/bin/herdr"]) if (existsSync(p)) return p;
  return "herdr";
}

export interface HerdrSession {
  name: string;
  running: boolean;
  default: boolean;
  socket_path: string;
}

export class HerdrUnavailable extends Error {}

export class HerdrApiError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.code = code;
  }
}

export async function listSessions(): Promise<HerdrSession[]> {
  try {
    const { stdout } = await run(herdrBin(), ["session", "list", "--json"], { timeout: 5000 });
    return (JSON.parse(stdout) as { sessions: HerdrSession[] }).sessions;
  } catch (e) {
    throw new HerdrUnavailable(`couldn't list herdr sessions: ${(e as Error).message}`);
  }
}

/**
 * One request to a herdr session socket. herdr answers exactly one request per connection,
 * so each call is its own (local, ~1 ms) connection.
 */
export function herdrRequest(socketPath: string, method: string, params: Record<string, unknown> = {}, timeoutMs = 10_000): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const sock = createConnection(socketPath);
    let buf = "";
    let done = false;
    const finish = (fn: () => void) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      sock.destroy();
      fn();
    };
    const timer = setTimeout(() => finish(() => reject(new HerdrUnavailable(`herdr didn't answer ${method}`))), timeoutMs);
    sock.setEncoding("utf8");
    sock.on("connect", () => sock.write(JSON.stringify({ id: "1", method, params }) + "\n"));
    sock.on("data", (chunk: string) => {
      buf += chunk;
      const nl = buf.indexOf("\n");
      if (nl < 0) return;
      finish(() => {
        try {
          const msg = JSON.parse(buf.slice(0, nl)) as { result?: Record<string, unknown>; error?: { code?: string; message?: string } };
          if (msg.error) reject(new HerdrApiError(msg.error.code ?? "error", msg.error.message ?? "herdr error"));
          else resolve(msg.result ?? {});
        } catch (e) {
          reject(new HerdrUnavailable(`bad reply from herdr: ${(e as Error).message}`));
        }
      });
    });
    sock.on("error", (e) => finish(() => reject(new HerdrUnavailable(`can't reach herdr: ${e.message}`))));
    sock.on("close", () => finish(() => reject(new HerdrUnavailable("herdr closed the connection"))));
  });
}

/**
 * Keeps one socket open with an events.subscribe request and hands every event to onEvent.
 * Resolves once herdr confirms the subscription, so nothing that happens afterwards is missed.
 */
export function herdrWatch(
  socketPath: string,
  subscriptions: Record<string, string>[],
  onEvent: (event: Record<string, unknown>) => void,
  onEnd: (reason: string) => void,
): Promise<{ close(): void }> {
  const sock = createConnection(socketPath);
  let buf = "";
  let ended = false;
  let started: ((w: { close(): void }) => void) | null = null;
  let failed: ((e: Error) => void) | null = null;
  const handle = { close: () => end("closed") };
  const end = (reason: string) => {
    if (ended) return;
    ended = true;
    sock.destroy();
    if (failed) failed(new HerdrUnavailable(reason));
    else onEnd(reason);
  };
  sock.setEncoding("utf8");
  sock.on("connect", () => sock.write(JSON.stringify({ id: "sub", method: "events.subscribe", params: { subscriptions } }) + "\n"));
  sock.on("data", (chunk: string) => {
    buf += chunk;
    let nl: number;
    while ((nl = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, nl);
      buf = buf.slice(nl + 1);
      let msg: Record<string, unknown>;
      try {
        msg = JSON.parse(line);
      } catch {
        continue;
      }
      const err = msg.error as { message?: string } | undefined;
      if (err) return end(`subscribe failed: ${err.message ?? "error"}`);
      if ((msg.result as { type?: string } | undefined)?.type === "subscription_started" && started) {
        const ok = started;
        started = null;
        failed = null;
        ok(handle);
      } else if ("event" in msg) onEvent(msg);
    }
  });
  sock.on("error", (e) => end(e.message));
  sock.on("close", () => end("herdr closed the event stream"));
  return new Promise((resolve, reject) => {
    started = resolve;
    failed = reject;
  });
}
