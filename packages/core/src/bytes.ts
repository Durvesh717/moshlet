/** Small byte helpers that work the same in Node and React Native (no Buffer, no TextDecoder). */

export function concat(...parts: Uint8Array[]): Uint8Array {
  let n = 0;
  for (const p of parts) n += p.length;
  const out = new Uint8Array(n);
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

export function putU16(dst: Uint8Array, off: number, v: number): void {
  dst[off] = (v >>> 8) & 0xff;
  dst[off + 1] = v & 0xff;
}

export function getU16(src: Uint8Array, off: number): number {
  return (src[off] << 8) | src[off + 1];
}

export function putU64(dst: Uint8Array, off: number, v: bigint): void {
  for (let i = 7; i >= 0; i--) {
    dst[off + i] = Number(v & 0xffn);
    v >>= 8n;
  }
}

export function getU64(src: Uint8Array, off: number): bigint {
  let v = 0n;
  for (let i = 0; i < 8; i++) v = (v << 8n) | BigInt(src[off + i]);
  return v;
}

export function utf8Encode(s: string): Uint8Array {
  const out: number[] = [];
  for (const ch of s) {
    const cp = ch.codePointAt(0)!;
    if (cp < 0x80) out.push(cp);
    else if (cp < 0x800) out.push(0xc0 | (cp >> 6), 0x80 | (cp & 63));
    else if (cp < 0x10000) out.push(0xe0 | (cp >> 12), 0x80 | ((cp >> 6) & 63), 0x80 | (cp & 63));
    else out.push(0xf0 | (cp >> 18), 0x80 | ((cp >> 12) & 63), 0x80 | ((cp >> 6) & 63), 0x80 | (cp & 63));
  }
  return Uint8Array.from(out);
}

/** Lenient UTF-8 decode: invalid sequences become U+FFFD. */
export function utf8Decode(b: Uint8Array): string {
  let s = "";
  let i = 0;
  while (i < b.length) {
    const c = b[i];
    let cp: number;
    let need: number;
    if (c < 0x80) {
      cp = c;
      need = 0;
    } else if ((c & 0xe0) === 0xc0) {
      cp = c & 0x1f;
      need = 1;
    } else if ((c & 0xf0) === 0xe0) {
      cp = c & 0x0f;
      need = 2;
    } else if ((c & 0xf8) === 0xf0) {
      cp = c & 0x07;
      need = 3;
    } else {
      s += "�";
      i++;
      continue;
    }
    let j = 1;
    for (; j <= need; j++) {
      const n = b[i + j];
      if (n === undefined || (n & 0xc0) !== 0x80) break;
      cp = (cp << 6) | (n & 0x3f);
    }
    if (j <= need) {
      s += "�";
      i += j;
      continue;
    }
    s += String.fromCodePoint(cp);
    i += need + 1;
  }
  return s;
}

const B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

const B64_INDEX = (() => {
  const t = new Int16Array(128).fill(-1);
  for (let i = 0; i < 64; i++) t[B64.charCodeAt(i)] = i;
  return t;
})();

/** Decodes base64 (padding and stray characters ignored). Hot path: every mosh datagram from the native UDP module. */
export function base64Decode(s: string): Uint8Array {
  const out = new Uint8Array(Math.floor((s.length * 3) / 4) + 3);
  let n = 0;
  let acc = 0;
  let bits = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    const v = c < 128 ? B64_INDEX[c] : -1;
    if (v < 0) continue;
    acc = ((acc << 6) | v) & 0xffffff;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out[n++] = (acc >> bits) & 0xff;
    }
  }
  return out.subarray(0, n);
}

export function base64Encode(b: Uint8Array): string {
  let s = "";
  for (let i = 0; i < b.length; i += 3) {
    const n = (b[i] << 16) | ((b[i + 1] ?? 0) << 8) | (b[i + 2] ?? 0);
    s += B64[(n >> 18) & 63] + B64[(n >> 12) & 63];
    s += i + 1 < b.length ? B64[(n >> 6) & 63] : "=";
    s += i + 2 < b.length ? B64[n & 63] : "=";
  }
  return s;
}
