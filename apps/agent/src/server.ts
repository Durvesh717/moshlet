import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import {
  AGENT_PROTOCOL,
  subscriptions,
  type AttachParams,
  type AttachResult,
  type HelloParams,
  type HerdrCallParams,
  type HostInfo,
  type PairParams,
  type ReleaseParams,
  type Request,
  type SessionInfo,
  type WatchParams,
} from "@corral/core";
import { WebSocketServer, type WebSocket } from "ws";
import type { Device, DeviceStore } from "./devices.ts";
import { HerdrApiError, herdrRequest, herdrWatch, listSessions, type HerdrSession } from "./herdr.ts";
import { startMosh, stopMosh, type MoshServer } from "./mosh.ts";
import type { Peer } from "./tailscale.ts";

export interface AgentOptions {
  /** Addresses to listen on: this machine's Tailscale IPs (or loopback in tests). */
  listen: string[];
  port: number;
  store: DeviceStore;
  host: HostInfo;
  /** Who may even open a connection: the owner's Tailscale devices. Returns the peer, or null to refuse. */
  identify: (remoteIp: string) => Promise<Peer | null>;
  /** Only these herdr sessions are visible to devices (all when unset). */
  sessions?: string[];
  /** Grace before a vanished device's terminals are ended (it may just be reconnecting). */
  releaseGraceMs?: number;
  log?: (msg: string) => void;
}

export interface RunningAgent {
  ports: number[];
  close(): Promise<void>;
}

interface Terminal extends MoshServer {
  terminalId: string;
  session: string;
}

class RequestError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.code = code;
  }
}

export async function startAgent(opts: AgentOptions): Promise<RunningAgent> {
  const log = opts.log ?? (() => {});
  const graceMs = opts.releaseGraceMs ?? 15_000;
  /** Terminals per device: at most one at a time, by design. */
  const terminals = new Map<string, Terminal[]>();
  const releaseTimers = new Map<string, ReturnType<typeof setTimeout>>();
  const online = new Map<string, number>(); // device id -> open connections

  const releaseDevice = (deviceId: string, port?: number) => {
    const list = terminals.get(deviceId) ?? [];
    const keep: Terminal[] = [];
    for (const t of list) {
      if (port === undefined || t.port === port) {
        stopMosh(t.pid);
        log(`released ${t.terminalId} (${t.session}) for ${deviceId}`);
      } else keep.push(t);
    }
    if (keep.length) terminals.set(deviceId, keep);
    else terminals.delete(deviceId);
  };

  let sessionCache: { at: number; list: HerdrSession[] } | null = null;
  const sessions = async (fresh = false): Promise<HerdrSession[]> => {
    if (!fresh && sessionCache && Date.now() - sessionCache.at < 5000) return sessionCache.list;
    const all = await listSessions();
    sessionCache = { at: Date.now(), list: opts.sessions ? all.filter((s) => opts.sessions!.includes(s.name)) : all };
    return sessionCache.list;
  };
  const socketOf = async (name: string): Promise<string> => {
    let s = (await sessions()).find((x) => x.name === name);
    if (!s) s = (await sessions(true)).find((x) => x.name === name);
    if (!s) throw new RequestError("bad_request", `no herdr session named ${name}`);
    if (!s.running) throw new RequestError("herdr_unavailable", `herdr session ${name} isn't running`);
    return s.socket_path;
  };
  const sessionInfos = async (): Promise<SessionInfo[]> =>
    (await sessions(true)).map((s) => ({ name: s.name, running: s.running, default: s.default }));

  const onConnection = async (ws: WebSocket, remoteIp: string, localIp: string) => {
    // Hold messages that arrive while the identity check is running.
    const early: unknown[] = [];
    let onMessage: ((raw: unknown) => void) | null = null;
    ws.on("message", (raw) => (onMessage ? onMessage(raw) : early.push(raw)));
    const peer = await opts.identify(remoteIp);
    if (!peer) {
      log(`refused ${remoteIp}: not one of this machine owner's Tailscale devices`);
      ws.close(4003, "not allowed");
      return;
    }
    let device: Device | null = null;
    let watch: { close(): void } | null = null;
    const push = (event: string, data: unknown) => {
      if (ws.readyState === ws.OPEN) ws.send(JSON.stringify({ event, data }));
    };

    const authed = (d: Device) => {
      device = d;
      online.set(d.id, (online.get(d.id) ?? 0) + 1);
      const t = releaseTimers.get(d.id);
      if (t) clearTimeout(t);
      releaseTimers.delete(d.id);
      opts.store.touch(d.id);
    };

    const handle = async (req: Request): Promise<unknown> => {
      const p = (req.params ?? {}) as Record<string, unknown>;
      if (req.method === "pair") {
        const { code, deviceName } = p as unknown as PairParams;
        if (typeof code !== "string" || typeof deviceName !== "string") throw new RequestError("bad_request", "pair needs code and deviceName");
        const paired = opts.store.pair(code, deviceName, peer.node);
        if (!paired) throw new RequestError("pairing_failed", "That pairing code is wrong or expired. Run `corral-agent pair` again.");
        authed(paired.device);
        log(`paired ${paired.device.name} (${paired.device.id}) from ${peer.node}`);
        return { deviceId: paired.device.id, token: paired.token, host: opts.host };
      }
      if (req.method === "hello") {
        const { deviceId, token } = p as unknown as HelloParams;
        const d = typeof deviceId === "string" && typeof token === "string" ? opts.store.verify(deviceId, token) : null;
        if (!d) throw new RequestError("unauthenticated", "This device isn't paired with this computer (or was revoked).");
        authed(d);
        return { host: opts.host, sessions: await sessionInfos() };
      }
      if (!device) throw new RequestError("unauthenticated", "say hello first");
      const dev: Device = device;

      switch (req.method) {
        case "sessions":
          return await sessionInfos();

        case "herdr.call": {
          const { session, method, params } = p as unknown as HerdrCallParams;
          if (typeof session !== "string" || typeof method !== "string") throw new RequestError("bad_request", "herdr.call needs session and method");
          return await herdrRequest(await socketOf(session), method, params ?? {});
        }

        case "herdr.watch": {
          const { session, statusPanes } = p as unknown as WatchParams;
          if (typeof session !== "string") throw new RequestError("bad_request", "herdr.watch needs session");
          watch?.close();
          const socket = await socketOf(session);
          const current: { close(): void } = await herdrWatch(
            socket,
            subscriptions(Array.isArray(statusPanes) ? statusPanes.filter((x) => typeof x === "string") : []),
            (event) => push("herdr", { session, event }),
            (reason) => {
              if (watch === current) {
                watch = null;
                push("herdr.watchEnded", { session, reason });
              }
            },
          );
          watch = current;
          return {};
        }

        case "herdr.unwatch":
          watch?.close();
          watch = null;
          return {};

        case "terminal.attach": {
          const { session, terminalId, cols, rows } = p as unknown as AttachParams;
          if (typeof session !== "string" || typeof terminalId !== "string") throw new RequestError("bad_request", "terminal.attach needs session and terminalId");
          await socketOf(session);
          // One attached pane per device: an attached pane keeps the phone's size on the desktop.
          releaseDevice(dev.id);
          let server: MoshServer;
          try {
            server = await startMosh({ bindIp: localIp, session, terminalId });
          } catch (e) {
            throw new RequestError("mosh_failed", (e as Error).message);
          }
          terminals.set(dev.id, [{ ...server, terminalId, session }]);
          log(`attached ${terminalId} (${session}) for ${dev.name}, ${cols}x${rows}, udp ${localIp}:${server.port}`);
          return { host: localIp, port: server.port, key: server.key } satisfies AttachResult;
        }

        case "terminal.release": {
          const { port } = p as unknown as ReleaseParams;
          releaseDevice(dev.id, typeof port === "number" ? port : undefined);
          return {};
        }

        default:
          throw new RequestError("unknown_method", `unknown method ${req.method}`);
      }
    };

    onMessage = async (raw: unknown) => {
      let req: Request;
      try {
        req = JSON.parse(String(raw));
        if (typeof req.id !== "number" || typeof req.method !== "string") throw new Error("not a request");
      } catch {
        ws.close(4000, "bad request");
        return;
      }
      try {
        const result = await handle(req);
        if (ws.readyState === ws.OPEN) ws.send(JSON.stringify({ id: req.id, result }));
      } catch (e) {
        const code = e instanceof RequestError ? e.code : e instanceof HerdrApiError ? "herdr_error" : "internal";
        const message = e instanceof HerdrApiError ? `${e.code}: ${e.message}` : (e as Error).message;
        if (code === "internal" || code === "herdr_unavailable") log(`${req.method} failed: ${message}`);
        if (ws.readyState === ws.OPEN) ws.send(JSON.stringify({ id: req.id, error: { code, message } }));
      }
    };
    for (const raw of early.splice(0)) onMessage(raw);

    ws.on("close", () => {
      watch?.close();
      watch = null;
      const d = device as Device | null;
      if (!d) return;
      const left = (online.get(d.id) ?? 1) - 1;
      if (left > 0) {
        online.set(d.id, left);
        return;
      }
      online.delete(d.id);
      // The app may be reconnecting after a network change; give it a moment before ending its terminals.
      if (terminals.has(d.id)) {
        releaseTimers.set(d.id, setTimeout(() => {
          releaseTimers.delete(d.id);
          releaseDevice(d.id);
        }, graceMs));
      }
    });
  };

  const servers: Server[] = [];
  const socketServers: WebSocketServer[] = [];
  const ports: number[] = [];
  for (const addr of opts.listen) {
    const http = createServer((_, res) => {
      res.writeHead(426, { "content-type": "text/plain" });
      res.end("corral-agent speaks WebSocket\n");
    });
    const wss = new WebSocketServer({ server: http, maxPayload: 1 << 20 });
    socketServers.push(wss);
    wss.on("connection", (ws, req) => {
      const remote = req.socket.remoteAddress ?? "";
      const local = (req.socket.localAddress ?? addr).replace(/^::ffff:/, "");
      void onConnection(ws, remote, local);
    });
    await new Promise<void>((resolve, reject) => {
      http.once("error", reject);
      http.listen(opts.port, addr, () => resolve());
    });
    servers.push(http);
    ports.push((http.address() as AddressInfo).port);
    log(`listening on ${addr.includes(":") ? `[${addr}]` : addr}:${(http.address() as AddressInfo).port}`);
  }

  return {
    ports,
    async close() {
      for (const t of releaseTimers.values()) clearTimeout(t);
      for (const id of [...terminals.keys()]) releaseDevice(id);
      for (const wss of socketServers) for (const c of wss.clients) c.terminate();
      await Promise.all(servers.map((s) => new Promise<void>((r) => s.close(() => r()))));
    },
  };
}

export const agentHost = (name: string, agentVersion: string): HostInfo => ({ name, agentVersion, protocol: AGENT_PROTOCOL });
