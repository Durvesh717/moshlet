import { describe, expect, it } from "vitest";
import { utf8Encode } from "../src/bytes.ts";
import { Sealer } from "../src/mosh/crypto.ts";
import { compress, decompress, FragmentAssembler, fragments } from "../src/mosh/framing.ts";
import { decodeHostMessage, decodeInstruction, encodeInstruction, encodeUserEvents } from "../src/mosh/messages.ts";
import { ProtoWriter, readFields } from "../src/mosh/proto.ts";

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
