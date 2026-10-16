import type { Screen } from "../term/screen.ts";
import { MoshError, MoshProtocol } from "./protocol.ts";

/** A UDP socket aimed at one server address. Implemented with node:dgram in Node and a native module on phones. */
export interface UdpSocket {
  send(data: Uint8Array): void;
  close(): void;
}

export interface UdpTransport {
  /** Opens a fresh socket (and so a fresh NAT mapping) to host:port; replies from it arrive in onMessage. */
  open(host: string, port: number, onMessage: (data: Uint8Array) => void): UdpSocket;
}

export type CloseReason = "session-ended" | "closed-by-us" | "error";

export interface Link {
  rttMs: number | null;
  heardAgoMs: number | null;
  closed: CloseReason | null;
  ageMs: number;
}

export const STALE_AFTER_MS = 6000;
export const NO_REPLY_HINT_MS = 6000;
const HOP_AFTER_MS = 10_000;
const RETIRE_AFTER_MS = 60_000;
const MAX_SOCKETS = 10;

export const linkConnected = (l: Link): boolean => l.closed === null && l.heardAgoMs !== null && l.heardAgoMs < STALE_AFTER_MS;
/** Never heard a single reply: usually UDP blocked between phone and host. */
export const linkNeverHeard = (l: Link): boolean => l.closed === null && l.heardAgoMs === null && l.ageMs > NO_REPLY_HINT_MS;

export interface MoshClientOptions {
  host: string;
  port: number;
  key: Uint8Array;
  cols: number;
  rows: number;
  transport: UdpTransport;
  clock?: () => number;
}

/**
 * Drives MoshProtocol over UDP, event by event (no threads): every input, datagram and timer
 * runs `pump`, which sends whatever is due and re-arms one timer for the next deadline.
 *
 * Roaming works the mosh way: the server replies to wherever our latest authentic datagram came
 * from, so the client only has to keep talking. When the network changes (or nothing has been
 * heard for a while) we "hop" to a fresh socket, keeping the old ones open for a minute in case
 * replies are still in flight.
 */
export class MoshClient {
  private readonly protocol: MoshProtocol;
  private readonly clock: () => number;
  private readonly sockets: { socket: UdpSocket; openedAt: number }[] = [];
  private readonly startedAt: number;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private lastHop = 0;
  private size: [number, number];
  private closedReason: CloseReason | null = null;
  private readonly screenListeners = new Set<(s: Screen) => void>();
  private readonly linkListeners = new Set<(l: Link) => void>();
  private lastLinkAt = -Infinity;
  private closeWaiters: (() => void)[] = [];

  private readonly opts: MoshClientOptions;

  constructor(opts: MoshClientOptions) {
    this.opts = opts;
    this.protocol = new MoshProtocol(opts.key);
    this.clock = opts.clock ?? (() => Math.floor(performance.now()));
    this.startedAt = this.clock();
    this.size = [opts.cols, opts.rows];
    this.hop(this.startedAt);
    this.protocol.queue({ kind: "resize", cols: opts.cols, rows: opts.rows }, this.startedAt);
    this.pump();
  }

  get screen(): Screen {
    return this.protocol.latest;
  }

  get link(): Link {
    const now = this.clock();
    const heard = this.protocol.lastHeard;
    const rtt = this.protocol.rttMs;
    return {
      rttMs: rtt === null ? null : Math.round(rtt),
      heardAgoMs: heard < 0 ? null : now - heard,
      closed: this.closedReason,
      ageMs: now - this.startedAt,
    };
  }

  onScreen(cb: (s: Screen) => void): () => void {
    this.screenListeners.add(cb);
    return () => this.screenListeners.delete(cb);
  }

  /** Link status, at most every 250 ms (and on close). */
  onLink(cb: (l: Link) => void): () => void {
    this.linkListeners.add(cb);
    return () => this.linkListeners.delete(cb);
  }

  write(bytes: Uint8Array): void {
    if (bytes.length === 0 || this.closedReason) return;
    this.protocol.queue({ kind: "keys", bytes }, this.clock());
    this.pump();
  }

  resize(cols: number, rows: number): void {
    if (this.closedReason || (cols === this.size[0] && rows === this.size[1])) return;
    this.size = [cols, rows];
    this.protocol.queue({ kind: "resize", cols, rows }, this.clock());
    this.pump();
  }

  /** Call when the device switches networks: hops to a fresh socket right away. */
  networkChanged(): void {
    if (this.closedReason) return;
    this.hop(this.clock());
    this.pump();
  }

  /** Call when the user starts interacting: wakes the radio path before the first real input. */
  nudge(): void {
    if (this.closedReason) return;
    this.protocol.heartbeatNow(this.clock());
    this.pump();
  }

  /** Asks the server to end the session and waits (briefly) for its acknowledgement. */
  close(timeoutMs = 2000): Promise<void> {
    if (this.closedReason) return Promise.resolve();
    this.protocol.requestShutdown(this.clock());
    const done = new Promise<void>((resolve) => this.closeWaiters.push(resolve));
    this.pump();
    const timeout = new Promise<void>((resolve) => setTimeout(resolve, timeoutMs));
    return Promise.race([done, timeout]).then(() => this.finish("closed-by-us"));
  }

  private receive(data: Uint8Array): void {
    if (this.closedReason) return;
    try {
      if (this.protocol.receive(data, this.clock())) {
        const s = this.protocol.latest;
        for (const cb of this.screenListeners) cb(s);
      }
    } catch (e) {
      if (e instanceof MoshError) {
        this.finish("error");
        return;
      }
      throw e;
    }
    this.pump();
  }

  private pump(): void {
    if (this.closedReason) return;
    const now = this.clock();
    for (const d of this.protocol.poll(now)) this.send(d);
    if (this.protocol.remoteClosed && this.protocol.remoteCloseAcknowledged) {
      this.finish("session-ended");
      return;
    }
    if (this.protocol.shutdownAcknowledged || this.protocol.shutdownGaveUp) {
      this.finish("closed-by-us");
      return;
    }
    this.maybeHop(now);
    if (now - this.lastLinkAt >= 250) {
      this.lastLinkAt = now;
      const l = this.link;
      for (const cb of this.linkListeners) cb(l);
    }
    if (this.timer !== null) clearTimeout(this.timer);
    const wait = Math.min(250, Math.max(1, this.protocol.nextWakeup(now) - now));
    this.timer = setTimeout(() => {
      this.timer = null;
      this.pump();
    }, wait);
  }

  private send(datagram: Uint8Array): void {
    const sock = this.sockets[this.sockets.length - 1];
    try {
      sock?.socket.send(datagram);
    } catch {
      // Offline or mid-switch. Keep going; the protocol retransmits and we hop when it comes back.
    }
  }

  private maybeHop(now: number): void {
    const heard = this.protocol.lastHeard;
    const newest = this.sockets[this.sockets.length - 1];
    const silentSince = heard < 0 ? (newest?.openedAt ?? now) : heard;
    if (now - silentSince > HOP_AFTER_MS && now - this.lastHop > HOP_AFTER_MS) this.hop(now);
    // Retire old sockets once the newest one has been working for a while.
    if (this.sockets.length > 1 && newest && heard > newest.openedAt && now - newest.openedAt > RETIRE_AFTER_MS) {
      while (this.sockets.length > 1) this.sockets.shift()!.socket.close();
    }
    while (this.sockets.length > MAX_SOCKETS) this.sockets.shift()!.socket.close();
  }

  private hop(now: number): void {
    let socket: UdpSocket;
    try {
      socket = this.opts.transport.open(this.opts.host, this.opts.port, (d) => this.receive(d));
    } catch {
      return;
    }
    this.lastHop = now;
    this.sockets.push({ socket, openedAt: now });
  }

  private finish(reason: CloseReason): void {
    if (this.closedReason) return;
    this.closedReason = reason;
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
    for (const s of this.sockets.splice(0)) {
      try {
        s.socket.close();
      } catch {
        // already closed
      }
    }
    const l = this.link;
    for (const cb of this.linkListeners) cb(l);
    for (const w of this.closeWaiters.splice(0)) w();
  }
}
