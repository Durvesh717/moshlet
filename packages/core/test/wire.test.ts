import { describe, expect, it } from "vitest";
import { utf8Encode } from "../src/bytes.ts";
import { Sealer } from "../src/mosh/crypto.ts";
import { compress, decompress, FragmentAssembler, fragments, InstructionTooLarge, MAX_INSTRUCTION, NO_TIMESTAMP, plaintext } from "../src/mosh/framing.ts";
import { decodeHostMessage, decodeInstruction, encodeInstruction, encodeUserEvents } from "../src/mosh/messages.ts";
import { ProtoWriter, readFields } from "../src/mosh/proto.ts";
import { MoshError, MoshProtocol } from "../src/mosh/protocol.ts";

const U64_MAX = (1n << 64n) - 1n;

describe("wire format", () => {
  it("decodes a printable key", () => {
    expect(Sealer.decodeKey("AAECAwQFBgcICQoLDA0ODw")).toEqual(Uint8Array.from({ length: 16 }, (_, i) => i));
  });

  it("round-trips an instruction with the shutdown number", () => {
    const back = decodeInstruction(encodeInstruction({ oldNum: 5n, newNum: U64_MAX, ackNum: 7n, throwawayNum: 3n, diff: Uint8Array.of(1, 2, 3) }));
    expect(back).toMatchObject({ protocolVersion: 2, oldNum: 5n, newNum: U64_MAX, ackNum: 7n, throwawayNum: 3n });
    expect(back.diff).toEqual(Uint8Array.of(1, 2, 3));
  });

  it("reassembles fragments arriving out of order", () => {
    const data = Uint8Array.from({ length: 2000 }, (_, i) => (i * 31) & 0xff);
    const frags = fragments(9n, data, 300);
    const asm = new FragmentAssembler();
    let result: Uint8Array | null = null;
    for (const f of frags.reverse()) result = asm.add(f) ?? result;
    expect(result).toEqual(data);
  });

  it("round-trips zlib", () => {
    const data = utf8Encode("x".repeat(5000));
    expect(decompress(compress(data))).toEqual(data);
  });

  it("inflates up to mosh's limit and stops past it", () => {
    const atLimit = new Uint8Array(MAX_INSTRUCTION);
    expect(decompress(compress(atLimit)).length).toBe(MAX_INSTRUCTION);
    // 64 MiB of zeros compresses to about 64 KiB.
    const bomb = compress(new Uint8Array(64 << 20));
    expect(() => decompress(bomb)).toThrow(InstructionTooLarge);
  });

  it("still rejects empty and corrupt zlib", () => {
    expect(() => decompress(new Uint8Array(0))).toThrow();
    expect(() => decompress(Uint8Array.of(1, 2, 3, 4, 5, 6))).toThrow();
  });

  it("stops reassembling an instruction whose fragments pass the limit", () => {
    const asm = new FragmentAssembler();
    const frags = fragments(3n, new Uint8Array(MAX_INSTRUCTION + 100_000), 60_000);
    expect(() => frags.forEach((f) => asm.add(f))).toThrow(InstructionTooLarge);
  });

  it("merges adjacent keystrokes and keeps resizes in order", () => {
    const enc = encodeUserEvents([
      { kind: "keys", bytes: utf8Encode("ab") },
      { kind: "keys", bytes: utf8Encode("c") },
      { kind: "resize", cols: 45, rows: 22 },
    ]);
    const insts = readFields(enc).map((f) => readFields(f.bytes!)[0]);
    expect(insts.map((i) => i.number)).toEqual([2, 3]);
    expect(readFields(insts[0].bytes!)[0].bytes).toEqual(utf8Encode("abc"));
  });

  it("decodes host bytes, resizes and echo acks", () => {
    const msg = new ProtoWriter()
      .message(1, (m) => m.message(2, (h) => h.bytes(4, utf8Encode("hi"))))
      .message(1, (m) => m.message(3, (r) => r.uint(5, 100).uint(6, 30)))
      .message(1, (m) => m.message(7, (e) => e.uint(8, 12)))
      .toBytes();
    expect(decodeHostMessage(msg)).toEqual([
      { kind: "bytes", data: utf8Encode("hi") },
      { kind: "resize", cols: 100, rows: 30 },
      { kind: "echoAck", num: 12n },
    ]);
  });
});

describe("base64", () => {
  it("round-trips every length and ignores padding and stray characters", async () => {
    const { base64Decode, base64Encode } = await import("../src/bytes.ts");
    for (let len = 0; len < 70; len++) {
      const b = Uint8Array.from({ length: len }, (_, i) => (i * 37 + len) & 0xff);
      expect(base64Decode(base64Encode(b))).toEqual(b);
      expect(base64Encode(b)).toBe(Buffer.from(b).toString("base64"));
    }
    expect(base64Decode("aGVs\nbG8=")).toEqual(new TextEncoder().encode("hello"));
  });
});

describe("protocol limits", () => {
  const key = Uint8Array.from({ length: 16 }, (_, i) => i);
  const fromServer = (seq: bigint, diff: Uint8Array) => {
    const inst = compress(encodeInstruction({ oldNum: 0n, newNum: seq, ackNum: 0n, throwawayNum: 0n, diff }));
    return new Sealer(key).seal((1n << 63n) | seq, plaintext(NO_TIMESTAMP, NO_TIMESTAMP, fragments(seq, inst, 1 << 20)[0]));
  };
  const resize = (cols: number, rows: number) =>
    new ProtoWriter().message(1, (m) => m.message(3, (r) => r.uint(5, cols).uint(6, rows))).toBytes();

  it("takes a resize the client could have asked for", () => {
    const p = new MoshProtocol(key);
    expect(p.receive(fromServer(1n, resize(200, 60)), 0)).toBe(true);
    expect([p.latest.cols, p.latest.rows]).toEqual([200, 60]);
  });

  it("ends the session on a screen far larger than any client asks for", () => {
    const p = new MoshProtocol(key);
    expect(() => p.receive(fromServer(1n, resize(100_000, 100_000)), 0)).toThrow(MoshError);
  });

  it("ends the session on an instruction that inflates past the limit", () => {
    const p = new MoshProtocol(key);
    const big = new ProtoWriter().message(1, (m) => m.message(2, (h) => h.bytes(4, new Uint8Array(MAX_INSTRUCTION)))).toBytes();
    expect(() => p.receive(fromServer(1n, big), 0)).toThrow(MoshError);
  });
});
