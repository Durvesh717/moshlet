import { chmodSync, mkdirSync, rmSync } from "node:fs";
import { createConnection, createServer, type Server } from "node:net";
import { dirname, join } from "node:path";
import { STATE_DIR, type DeviceStore } from "./devices.ts";

/**
 * A unix socket (mode 600) for local admin: the `corral-agent pair`, `devices` and `revoke`
 * commands talk to the running service through it. Only this user can reach it, so nothing here
 * needs further authentication. It lives in $XDG_RUNTIME_DIR (short paths; socket paths max out
 * at 108 bytes), else in the state dir.
 */
export const CONTROL_SOCKET =
  process.env.CORRAL_AGENT_CONTROL ??
  (process.env.XDG_RUNTIME_DIR ? join(process.env.XDG_RUNTIME_DIR, "corral-agent.sock") : join(STATE_DIR, "control.sock"));

export type ControlRequest = { cmd: "pair" } | { cmd: "devices" } | { cmd: "revoke"; id: string };

export interface ControlInfo {
  addresses: string[];
  port: number;
  hostName: string;
}

export function startControl(store: DeviceStore, info: ControlInfo, path = CONTROL_SOCKET): Promise<Server> {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  rmSync(path, { force: true });
  const server = createServer((sock) => {
    let buf = "";
    sock.setEncoding("utf8");
    sock.on("data", (chunk: string) => {
      buf += chunk;
      const nl = buf.indexOf("\n");
      if (nl < 0) return;
      let reply: unknown;
      try {
        const req = JSON.parse(buf.slice(0, nl)) as ControlRequest;
        if (req.cmd === "pair") reply = { ...store.createPairingCode(), ...info };
        else if (req.cmd === "devices") reply = { devices: store.list().map(({ tokenSha256: _, ...d }) => d) };
        else if (req.cmd === "revoke") reply = { revoked: store.revoke(req.id) };
        else reply = { error: "unknown command" };
      } catch (e) {
        reply = { error: (e as Error).message };
      }
      sock.end(JSON.stringify(reply) + "\n");
    });
    sock.on("error", () => {});
  });
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(path, () => {
      chmodSync(path, 0o600);
      resolve(server);
    });
  });
}

export function control<T>(req: ControlRequest, path = CONTROL_SOCKET): Promise<T> {
  return new Promise((resolve, reject) => {
    const sock = createConnection(path);
    let buf = "";
    sock.setEncoding("utf8");
    sock.on("connect", () => sock.write(JSON.stringify(req) + "\n"));
    sock.on("data", (c: string) => (buf += c));
    sock.on("end", () => {
      try {
        resolve(JSON.parse(buf) as T);
      } catch (e) {
        reject(e);
      }
    });
    sock.on("error", (e) => reject(new Error(`corral-agent isn't running (${e.message}). Start it with \`corral-agent serve\`.`)));
  });
}
