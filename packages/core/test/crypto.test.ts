import { createCipheriv, randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { Sealer } from "../src/mosh/crypto.ts";

/** Node's OpenSSL has AES-128-OCB; it is the reference our pure-TS mode must match byte for byte. */
function opensslSeal(key: Uint8Array, nonce64: bigint, pt: Uint8Array): Uint8Array {
  const nonce = Buffer.alloc(12);
  nonce.writeBigUInt64BE(nonce64, 4);
  const c = createCipheriv("aes-128-ocb", key, nonce, { authTagLength: 16 });
  const body = Buffer.concat([c.update(pt), c.final()]);
  const head = Buffer.alloc(8);
  head.writeBigUInt64BE(nonce64);
  return new Uint8Array(Buffer.concat([head, body, c.getAuthTag()]));
}

describe("Sealer (AES-128-OCB3)", () => {
  it("matches OpenSSL for every length 0..80 and a range of nonces", () => {
    for (let len = 0; len <= 80; len++) {
      const key = new Uint8Array(randomBytes(16));
      const pt = new Uint8Array(randomBytes(len));
      const nonce = (BigInt(len) * 0x1234_5678_9abn) | (len % 2 ? 1n << 63n : 0n);
      const ours = new Sealer(key).seal(nonce, pt);
      expect(Buffer.from(ours).toString("hex")).toBe(Buffer.from(opensslSeal(key, nonce, pt)).toString("hex"));
    }
  });

  it("opens what it seals and what OpenSSL seals, and rejects tampering", () => {
    const key = new Uint8Array(randomBytes(16));
    const s = new Sealer(key);
    for (const len of [0, 1, 15, 16, 17, 33, 499]) {
      const pt = new Uint8Array(randomBytes(len));
      for (const sealed of [s.seal(42n, pt), opensslSeal(key, 42n, pt)]) {
        const opened = s.open(sealed)!;
        expect(opened.nonce64).toBe(42n);
        expect(Buffer.from(opened.plaintext).equals(Buffer.from(pt))).toBe(true);
        const bad = Uint8Array.from(sealed);
        bad[bad.length - 1] ^= 1;
        expect(s.open(bad)).toBeNull();
      }
    }
  });

  it("decodes mosh's printable keys", () => {
    expect(Sealer.decodeKey("AAAAAAAAAAAAAAAAAAAAAA")).toEqual(new Uint8Array(16));
    expect(() => Sealer.decodeKey("short")).toThrow();
  });
});
