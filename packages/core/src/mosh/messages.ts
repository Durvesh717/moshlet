import { concat } from "../bytes.ts";
import { ProtoWriter, readFields } from "./proto.ts";

export const PROTOCOL_VERSION = 2;

/** TransportBuffers.Instruction: one state-sync step, "apply diff to state oldNum to get newNum". */
export interface Instruction {
  protocolVersion: number;
  oldNum: bigint;
  newNum: bigint;
  ackNum: bigint;
  throwawayNum: bigint;
  diff: Uint8Array;
}

export function encodeInstruction(i: Omit<Instruction, "protocolVersion">): Uint8Array {
  return new ProtoWriter()
    .uint(1, PROTOCOL_VERSION)
    .uint(2, i.oldNum)
    .uint(3, i.newNum)
    .uint(4, i.ackNum)
    .uint(5, i.throwawayNum)
    .bytes(6, i.diff)
    .toBytes();
}

export function decodeInstruction(bytes: Uint8Array): Instruction {
  const inst: Instruction = { protocolVersion: 0, oldNum: 0n, newNum: 0n, ackNum: 0n, throwawayNum: 0n, diff: new Uint8Array(0) };
  for (const f of readFields(bytes)) {
    switch (f.number) {
      case 1: inst.protocolVersion = Number(f.varint); break;
      case 2: inst.oldNum = f.varint; break;
      case 3: inst.newNum = f.varint; break;
      case 4: inst.ackNum = f.varint; break;
      case 5: inst.throwawayNum = f.varint; break;
      case 6: if (f.bytes) inst.diff = f.bytes; break;
    }
  }
  return inst;
}

/** What the client sends: keystrokes and window-size changes (ClientBuffers.UserMessage). */
export type UserEvent = { kind: "keys"; bytes: Uint8Array } | { kind: "resize"; cols: number; rows: number };

export function encodeUserEvents(events: readonly UserEvent[]): Uint8Array {
  const w = new ProtoWriter();
  let pending: Uint8Array[] = [];
  const flushKeys = () => {
    if (pending.length === 0) return;
    const keys = concat(...pending);
    w.message(1, (m) => m.message(2, (k) => k.bytes(4, keys)));
    pending = [];
  };
  for (const e of events) {
    if (e.kind === "keys") {
      pending.push(e.bytes);
    } else {
      flushKeys();
      w.message(1, (m) => m.message(3, (r) => r.uint(5, e.cols).uint(6, e.rows)));
    }
  }
  flushKeys();
  return w.toBytes();
}

/** What the server sends (HostBuffers.HostMessage). */
export type HostInstruction =
  | { kind: "bytes"; data: Uint8Array }
  | { kind: "resize"; cols: number; rows: number }
  | { kind: "echoAck"; num: bigint };

export function decodeHostMessage(bytes: Uint8Array): HostInstruction[] {
  const out: HostInstruction[] = [];
  for (const inst of readFields(bytes)) {
    if (inst.number !== 1 || !inst.bytes) continue;
    for (const ext of readFields(inst.bytes)) {
      if (!ext.bytes) continue;
      const fields = readFields(ext.bytes);
      const field = (n: number) => fields.find((f) => f.number === n);
      switch (ext.number) {
        case 2: {
          const data = field(4)?.bytes;
          if (data) out.push({ kind: "bytes", data });
          break;
        }
        case 3:
          out.push({ kind: "resize", cols: Number(field(5)?.varint ?? 80n), rows: Number(field(6)?.varint ?? 24n) });
          break;
        case 7:
          out.push({ kind: "echoAck", num: field(8)?.varint ?? 0n });
          break;
      }
    }
  }
  return out;
}
