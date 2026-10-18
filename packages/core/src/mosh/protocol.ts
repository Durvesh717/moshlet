import { getU16 } from "../bytes.ts";
import { Interpreter } from "../term/interpreter.ts";
import { Screen } from "../term/screen.ts";
import { Sealer } from "./crypto.ts";
import { compress, decompress, FragmentAssembler, fragments, InstructionTooLarge, NO_TIMESTAMP, plaintext } from "./framing.ts";
import { decodeHostMessage, decodeInstruction, encodeInstruction, encodeUserEvents, PROTOCOL_VERSION, type UserEvent } from "./messages.ts";

/** uint64 max: the state number that means "this side is shutting down". */
export const SHUTDOWN_NUM = (1n << 64n) - 1n;
const DIRECTION_TO_CLIENT = 1n << 63n;

const MIN_RTO = 50;
const MAX_RTO = 1000;
const MIN_SEND_INTERVAL = 20;
const MAX_SEND_INTERVAL = 250;
// Input goes out 1 ms after the first keystroke, as in the reference client (its server waits 8 ms to batch screen updates).
const SEND_MINDELAY = 1;
const ACK_DELAY = 100;
const ACK_INTERVAL = 3000;
const SHUTDOWN_RETRIES = 16;
const MAX_RECEIVED_STATES = 1024;
// 500-byte datagrams like the reference client: minus nonce (8), timestamps (4), tag (16), fragment header (10).
const MAX_FRAGMENT_PAYLOAD = 500 - 8 - 4 - 16 - 10;

export class MoshError extends Error {}

/** The largest screen a client asks for or accepts; a phone's or a tablet's grid is far smaller. */
export const MAX_COLS = 512;
export const MAX_ROWS = 256;

export const ts16 = (now: number): number => {
  const ts = now & 0xffff;
  return ts === 0xffff ? 0 : ts;
};

interface Sent {
  num: bigint;
  eventCount: number;
}

interface Received {
  num: bigint;
  screen: Screen;
}

/**
 * The client side of mosh's state-synchronization protocol, with no I/O.
 *
 * Two numbered state streams run in opposite directions:
 *  - ours: an append-only log of user events (keys, resizes). We always send "everything since
 *    the newest state the server has acknowledged", so every diff applies to a state the server
 *    is guaranteed to still hold. That's simpler than the reference client, which speculates
 *    about unacknowledged states; for keystroke-sized traffic the extra bytes don't matter.
 *  - theirs: screen states. The server diffs against whatever state it thinks we have, which may
 *    be older than our newest, so we keep every state it hasn't told us to throw away.
 *
 * Time is passed in explicitly (milliseconds, monotonic) so the logic is testable.
 */
export class MoshProtocol {
  private readonly sealer: Sealer;

  // datagram layer
  private nextSeq = 0n;
  private expectedSeq = 0n;
  private savedTimestamp = -1;
  private savedTimestampAt = 0;
  private srtt = 1000;
  private rttvar = 500;
  private haveRtt = false;

  /** Time we last heard an authentic, in-order datagram, or -1 if never. */
  lastHeard = -1;

  // our stream: user events
  private events: UserEvent[] = [];
  private eventsDropped = 0;
  private sent: Sent[] = [{ num: 0n, eventCount: 0 }];
  private firstUnsentAt = -1;
  private lastSendAt = -1e12;
  private nextHeartbeatAt = 0;
  private dataAckDueAt = -1;
  private fragmentId = 0n;
  private lastFragmentKey = "";

  // their stream: screens
  private received: Received[] = [{ num: 0n, screen: new Screen(80, 24) }];
  private ackNum = 0n;
  private readonly assembler = new FragmentAssembler();

  latest: Screen = this.received[0].screen;

  // shutdown
  shutdownRequested = false;
  shutdownAcknowledged = false;
  private shutdownTries = 0;
  private nextShutdownAt = 0;

  /** The server ended the session (its command exited). */
  remoteClosed = false;
  remoteCloseAcknowledged = false;

  constructor(key: Uint8Array) {
    this.sealer = new Sealer(key);
  }

  get rttMs(): number | null {
    return this.haveRtt ? this.srtt : null;
  }

  get shutdownGaveUp(): boolean {
    return this.shutdownRequested && !this.shutdownAcknowledged && this.shutdownTries >= SHUTDOWN_RETRIES;
  }

  private get totalEvents(): number {
    return this.eventsDropped + this.events.length;
  }

  private get rto(): number {
    return Math.floor(clamp(this.srtt + 4 * this.rttvar, MIN_RTO, MAX_RTO));
  }

  private get sendInterval(): number {
    return this.haveRtt ? clamp(Math.floor(this.srtt / 2), MIN_SEND_INTERVAL, MAX_SEND_INTERVAL) : MIN_SEND_INTERVAL;
  }

  queue(event: UserEvent, now: number): void {
    if (this.shutdownRequested) return;
    this.events.push(event);
    if (this.firstUnsentAt < 0) this.firstUnsentAt = now;
  }

  requestShutdown(now: number): void {
    if (this.shutdownRequested) return;
    this.shutdownRequested = true;
    this.nextShutdownAt = now;
  }

  /**
   * Send a heartbeat now (at most every 50 ms). A phone's Wi-Fi radio naps between packets and
   * replies wait for it to wake; poking the link when the user starts touching hides that wake-up.
   */
  heartbeatNow(now: number): void {
    if (!this.shutdownRequested && now - this.lastSendAt >= 50) this.nextHeartbeatAt = now;
  }

  /** Handles one datagram. Returns true when `latest` changed. */
  receive(datagram: Uint8Array, now: number): boolean {
    const opened = this.sealer.open(datagram);
    if (!opened) return false;
    if ((opened.nonce64 & DIRECTION_TO_CLIENT) === 0n) return false; // not server-to-client
    const pt = opened.plaintext;
    if (pt.length < 4) return false;
    const seq = opened.nonce64 & ~DIRECTION_TO_CLIENT;
    if (seq >= this.expectedSeq) {
      // Only in-order datagrams update timing, as in the reference implementation (replay safety).
      this.expectedSeq = seq + 1n;
      const ts = getU16(pt, 0);
      const reply = getU16(pt, 2);
      if (ts !== NO_TIMESTAMP) {
        this.savedTimestamp = ts;
        this.savedTimestampAt = now;
      }
      if (reply !== NO_TIMESTAMP) {
        const sample = (ts16(now) - reply) & 0xffff;
        if (sample < 5000) this.updateRtt(sample);
      }
      this.lastHeard = now;
    }
    let inst;
    try {
      const compressed = this.assembler.add(pt.subarray(4));
      if (!compressed) return false;
      inst = decodeInstruction(decompress(compressed));
    } catch (e) {
      if (e instanceof InstructionTooLarge) throw new MoshError(e.message);
      return false;
    }
    if (inst.protocolVersion !== PROTOCOL_VERSION) {
      throw new MoshError(`server speaks mosh protocol ${inst.protocolVersion}, expected ${PROTOCOL_VERSION}`);
    }
    this.processAck(inst.ackNum);
    return this.applyRemote(inst.oldNum, inst.newNum, inst.throwawayNum, inst.diff, now);
  }

  /** Datagrams that are due to be sent now. */
  poll(now: number): Uint8Array[] {
    const out: Uint8Array[] = [];
    const base = this.sent[0];
    const last = this.sent[this.sent.length - 1];

    if (this.remoteClosed) {
      if (!this.remoteCloseAcknowledged) {
        // Acknowledge the server's final state so it can exit cleanly.
        this.emit(out, now, base.num, last.num + 1n, new Uint8Array(0));
        this.remoteCloseAcknowledged = true;
      }
      return out;
    }

    if (this.shutdownRequested) {
      if (!this.shutdownAcknowledged && this.shutdownTries < SHUTDOWN_RETRIES && now >= this.nextShutdownAt) {
        if (last.num !== SHUTDOWN_NUM) this.sent.push({ num: SHUTDOWN_NUM, eventCount: this.totalEvents });
        this.emit(out, now, base.num, SHUTDOWN_NUM, this.diffFrom(base, this.totalEvents));
        this.shutdownTries++;
        this.nextShutdownAt = now + this.rto;
      }
      return out;
    }

    const total = this.totalEvents;
    const unsent = total > last.eventCount;
    const unacked = last.num !== base.num;
    const dataDue = unsent
      ? now >= Math.max(this.firstUnsentAt + SEND_MINDELAY, this.lastSendAt + this.sendInterval)
      : unacked
        ? now >= this.lastSendAt + this.rto
        : false;
    const ackDue = (this.dataAckDueAt >= 0 && this.dataAckDueAt <= now) || now >= this.nextHeartbeatAt;

    if (dataDue || ackDue) {
      if (unsent || !unacked) {
        // Pending keystrokes ride along with any outgoing ack; with nothing in flight, a heartbeat is a fresh empty state.
        this.sent.push({ num: last.num + 1n, eventCount: total });
        if (unsent) this.firstUnsentAt = -1;
      }
      const target = this.sent[this.sent.length - 1];
      this.emit(out, now, base.num, target.num, this.diffFrom(base, target.eventCount));
      this.lastSendAt = now;
      this.nextHeartbeatAt = now + ACK_INTERVAL;
      this.dataAckDueAt = -1;
    }
    return out;
  }

  /** Earliest time `poll` might have something to send. */
  nextWakeup(now: number): number {
    if (this.remoteClosed) return this.remoteCloseAcknowledged ? Infinity : now;
    if (this.shutdownRequested) {
      return this.shutdownAcknowledged || this.shutdownTries >= SHUTDOWN_RETRIES ? Infinity : this.nextShutdownAt;
    }
    let t = this.nextHeartbeatAt;
    if (this.dataAckDueAt >= 0) t = Math.min(t, this.dataAckDueAt);
    const base = this.sent[0];
    const last = this.sent[this.sent.length - 1];
    if (this.totalEvents > last.eventCount) {
      t = Math.min(t, Math.max(this.firstUnsentAt + SEND_MINDELAY, this.lastSendAt + this.sendInterval));
    } else if (last.num !== base.num) {
      t = Math.min(t, this.lastSendAt + this.rto);
    }
    return t;
  }

  // ---- internals

  private applyRemote(oldNum: bigint, newNum: bigint, throwawayNum: bigint, diff: Uint8Array, now: number): boolean {
    if (this.received.some((r) => r.num === newNum)) return false;
    const ref = this.received.find((r) => r.num === oldNum);
    if (!ref) return false;

    this.received = this.received.filter((r) => r.num >= throwawayNum);
    if (this.received.length > MAX_RECEIVED_STATES) return false;

    let screen = ref.screen;
    if (diff.length > 0) {
      screen = ref.screen.copy();
      for (const inst of decodeHostMessage(diff)) {
        if (inst.kind === "bytes") Interpreter.apply(screen, inst.data);
        else if (inst.kind === "resize") {
          // The server echoes the size the client asked for, which is never this big.
          if (inst.cols > MAX_COLS || inst.rows > MAX_ROWS) throw new MoshError(`the server asked for a ${inst.cols}x${inst.rows} screen`);
          screen.resize(inst.cols, inst.rows);
        }
        // echoAck is only used for local echo prediction, which we don't do (yet)
      }
    }
    const state = { num: newNum, screen };
    const at = this.received.findIndex((r) => newNum < r.num);
    if (at >= 0) {
      this.received.splice(at, 0, state); // out-of-order arrival: keep as a reference, don't display
      return false;
    }
    this.received.push(state);
    this.ackNum = newNum;
    if (newNum === SHUTDOWN_NUM) this.remoteClosed = true;
    else if (diff.length > 0 && this.dataAckDueAt < 0) this.dataAckDueAt = now + ACK_DELAY;
    if (screen === this.latest) return false;
    this.latest = screen;
    return true;
  }

  private processAck(ack: bigint): void {
    if (!this.sent.some((s) => s.num === ack)) return;
    while (this.sent[0].num !== ack) this.sent.shift();
    if (ack === SHUTDOWN_NUM) this.shutdownAcknowledged = true;
    const drop = this.sent[0].eventCount - this.eventsDropped;
    if (drop > 0) {
      this.events.splice(0, drop);
      this.eventsDropped += drop;
    }
  }

  private diffFrom(base: Sent, toEventCount: number): Uint8Array {
    const from = base.eventCount - this.eventsDropped;
    const to = toEventCount - this.eventsDropped;
    return to > from ? encodeUserEvents(this.events.slice(from, to)) : new Uint8Array(0);
  }

  private emit(out: Uint8Array[], now: number, oldNum: bigint, newNum: bigint, diff: Uint8Array): void {
    const throwawayNum = this.sent[0].num;
    const key = `${oldNum},${newNum},${this.ackNum},${throwawayNum}`;
    if (key !== this.lastFragmentKey) {
      this.fragmentId++;
      this.lastFragmentKey = key;
    }
    const body = compress(encodeInstruction({ oldNum, newNum, ackNum: this.ackNum, throwawayNum, diff }));
    for (const fragment of fragments(this.fragmentId, body, MAX_FRAGMENT_PAYLOAD)) {
      const pt = plaintext(ts16(now), this.timestampReply(now), fragment);
      out.push(this.sealer.seal(this.nextSeq++ & ~DIRECTION_TO_CLIENT, pt)); // direction bit 0 = to server
    }
  }

  private timestampReply(now: number): number {
    if (this.savedTimestamp < 0 || now - this.savedTimestampAt >= 1000) return NO_TIMESTAMP;
    const reply = (this.savedTimestamp + (now - this.savedTimestampAt)) & 0xffff;
    this.savedTimestamp = -1;
    return reply;
  }

  private updateRtt(sample: number): void {
    if (!this.haveRtt) {
      this.srtt = sample;
      this.rttvar = sample / 2;
      this.haveRtt = true;
    } else {
      this.rttvar = 0.75 * this.rttvar + 0.25 * Math.abs(this.srtt - sample);
      this.srtt = 0.875 * this.srtt + 0.125 * sample;
    }
  }
}

const clamp = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v);
