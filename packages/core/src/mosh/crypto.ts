import { unsafe } from "@noble/ciphers/aes.js";
import { base64Decode, getU64, putU64 } from "../bytes.ts";

/**
 * AES-128-OCB3 (RFC 7253, 128-bit tag, 96-bit nonce), the way mosh frames datagrams:
 *
 *   datagram = nonce64 (8 bytes, big-endian) || ciphertext || tag (16 bytes)
 *
 * The 96-bit OCB nonce is four zero bytes followed by nonce64. The top bit of nonce64 is the
 * direction (1 = server to client), the rest a sequence number. No platform crypto has OCB
 * (WebCrypto doesn't, Hermes has no node:crypto), so the mode is built here on AES blocks.
 */
export class Sealer {
  private readonly enc: Uint32Array;
  private readonly dec: Uint32Array;
  private readonly lStar: Uint8Array;
  private readonly lDollar: Uint8Array;
  private readonly l: Uint8Array[] = [];

  constructor(key: Uint8Array) {
    if (key.length !== 16) throw new Error("mosh keys are 128-bit");
    this.enc = unsafe.expandKeyLE(key);
    this.dec = unsafe.expandKeyDecLE(key);
    this.lStar = this.encipher(new Uint8Array(16));
    this.lDollar = double(this.lStar);
    this.l.push(double(this.lDollar));
  }

  seal(nonce64: bigint, plaintext: Uint8Array): Uint8Array {
    const out = new Uint8Array(8 + plaintext.length + 16);
    putU64(out, 0, nonce64);
    const ct = out.subarray(8);
    const offset = this.initialOffset(nonce64);
    const checksum = new Uint8Array(16);
    const full = plaintext.length >> 4;
    const block = new Uint8Array(16);
    for (let i = 0; i < full; i++) {
      xorInto(offset, this.lAt(ntz(i + 1)));
      const p = plaintext.subarray(i * 16, i * 16 + 16);
      xorInto(checksum, p);
      for (let k = 0; k < 16; k++) block[k] = p[k] ^ offset[k];
      this.encipherInPlace(block);
      for (let k = 0; k < 16; k++) ct[i * 16 + k] = block[k] ^ offset[k];
    }
    const rest = plaintext.length & 15;
    if (rest > 0) {
      xorInto(offset, this.lStar);
      const pad = this.encipher(offset);
      const at = full * 16;
      for (let k = 0; k < rest; k++) {
        ct[at + k] = plaintext[at + k] ^ pad[k];
        checksum[k] ^= plaintext[at + k];
      }
      checksum[rest] ^= 0x80;
    }
    ct.set(this.tag(checksum, offset), plaintext.length);
    return out;
  }

  /** Returns null when the datagram is too short or fails authentication. */
  open(datagram: Uint8Array): { nonce64: bigint; plaintext: Uint8Array } | null {
    if (datagram.length < 8 + 16) return null;
    const nonce64 = getU64(datagram, 0);
    const ct = datagram.subarray(8, datagram.length - 16);
    const givenTag = datagram.subarray(datagram.length - 16);
    const pt = new Uint8Array(ct.length);
    const offset = this.initialOffset(nonce64);
    const checksum = new Uint8Array(16);
    const full = ct.length >> 4;
    const block = new Uint8Array(16);
    for (let i = 0; i < full; i++) {
      xorInto(offset, this.lAt(ntz(i + 1)));
      for (let k = 0; k < 16; k++) block[k] = ct[i * 16 + k] ^ offset[k];
      this.decipherInPlace(block);
      for (let k = 0; k < 16; k++) {
        const p = block[k] ^ offset[k];
        pt[i * 16 + k] = p;
        checksum[k] ^= p;
      }
    }
    const rest = ct.length & 15;
    if (rest > 0) {
      xorInto(offset, this.lStar);
      const pad = this.encipher(offset);
      const at = full * 16;
      for (let k = 0; k < rest; k++) {
        const p = ct[at + k] ^ pad[k];
        pt[at + k] = p;
        checksum[k] ^= p;
      }
      checksum[rest] ^= 0x80;
    }
    const tag = this.tag(checksum, offset);
    let diff = 0;
    for (let k = 0; k < 16; k++) diff |= tag[k] ^ givenTag[k];
    return diff === 0 ? { nonce64, plaintext: pt } : null;
  }

  /** Tag = ENCIPHER(Checksum ^ Offset ^ L_$); there is never associated data in mosh. */
  private tag(checksum: Uint8Array, offset: Uint8Array): Uint8Array {
    const t = new Uint8Array(16);
    for (let k = 0; k < 16; k++) t[k] = checksum[k] ^ offset[k] ^ this.lDollar[k];
    return this.encipherInPlace(t);
  }

  private initialOffset(nonce64: bigint): Uint8Array {
    // Nonce block: 0^31 || 1 || N, with N = 0x00000000 || nonce64.
    const nonce = new Uint8Array(16);
    nonce[3] = 1;
    putU64(nonce, 8, nonce64);
    const bottom = nonce[15] & 63;
    nonce[15] &= 0xc0;
    const ktop = this.encipherInPlace(nonce);
    const stretch = new Uint8Array(24);
    stretch.set(ktop);
    for (let k = 0; k < 8; k++) stretch[16 + k] = ktop[k] ^ ktop[k + 1];
    // Offset_0 = Stretch[1+bottom .. 128+bottom] (bit positions).
    const byteShift = bottom >> 3;
    const bitShift = bottom & 7;
    const offset = new Uint8Array(16);
    for (let k = 0; k < 16; k++) {
      const hi = stretch[k + byteShift];
      const lo = stretch[k + byteShift + 1];
      offset[k] = bitShift === 0 ? hi : ((hi << bitShift) | (lo >>> (8 - bitShift))) & 0xff;
    }
    return offset;
  }

  private lAt(i: number): Uint8Array {
    while (this.l.length <= i) this.l.push(double(this.l[this.l.length - 1]));
    return this.l[i];
  }

  private encipher(b: Uint8Array): Uint8Array {
    return this.encipherInPlace(Uint8Array.from(b));
  }

  private encipherInPlace(b: Uint8Array): Uint8Array {
    return unsafe.encryptBlock(this.enc, b);
  }

  private decipherInPlace(b: Uint8Array): Uint8Array {
    return unsafe.decryptBlock(this.dec, b);
  }

  /** mosh-server prints its key as 22 base64 characters with the padding stripped. */
  static decodeKey(printable: string): Uint8Array {
    if (printable.length !== 22) throw new Error("mosh key must be 22 characters");
    const key = base64Decode(printable + "==");
    if (key.length !== 16) throw new Error("mosh key must decode to 16 bytes");
    return key;
  }
}

function double(s: Uint8Array): Uint8Array {
  const out = new Uint8Array(16);
  for (let k = 0; k < 15; k++) out[k] = ((s[k] << 1) | (s[k + 1] >>> 7)) & 0xff;
  out[15] = ((s[15] << 1) & 0xff) ^ (s[0] & 0x80 ? 0x87 : 0);
  return out;
}

function xorInto(dst: Uint8Array, src: Uint8Array): void {
  for (let k = 0; k < 16; k++) dst[k] ^= src[k];
}

function ntz(i: number): number {
  let n = 0;
  while ((i & 1) === 0) {
    i >>>= 1;
    n++;
  }
  return n;
}
