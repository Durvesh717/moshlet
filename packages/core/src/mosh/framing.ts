import { unzlibSync, zlibSync } from "fflate";
import { concat, getU16, getU64, putU16, putU64 } from "../bytes.ts";

/**
 * Plaintext of a datagram: timestamp (u16) || timestamp reply (u16) || fragment.
 * A fragment is: instruction id (u64) || (final bit << 15 | index) (u16) || chunk,
 * and the chunks of one id concatenate to a zlib-compressed instruction.
 */
export const FRAGMENT_HEADER = 10;
export const NO_TIMESTAMP = 0xffff;

export function plaintext(timestamp: number, timestampReply: number, fragment: Uint8Array): Uint8Array {
  const out = new Uint8Array(4 + fragment.length);
  putU16(out, 0, timestamp);
  putU16(out, 2, timestampReply);
  out.set(fragment, 4);
  return out;
}

export function fragments(id: bigint, compressed: Uint8Array, maxChunk: number): Uint8Array[] {
  const out: Uint8Array[] = [];
  let offset = 0;
  let index = 0;
  do {
    const len = Math.min(maxChunk, compressed.length - offset);
    const last = offset + len >= compressed.length;
    const frag = new Uint8Array(FRAGMENT_HEADER + len);
    putU64(frag, 0, id);
    putU16(frag, 8, (last ? 0x8000 : 0) | index);
    frag.set(compressed.subarray(offset, offset + len), FRAGMENT_HEADER);
    out.push(frag);
    offset += len;
    index++;
  } while (offset < compressed.length);
  return out;
}

export const compress = (data: Uint8Array): Uint8Array => zlibSync(data);
export const decompress = (data: Uint8Array): Uint8Array => unzlibSync(data);

/** Reassembles fragments. Like the reference implementation, it only tracks the newest instruction id. */
export class FragmentAssembler {
  private currentId = -1n;
  private chunks: (Uint8Array | undefined)[] = [];
  private arrived = 0;
  private total = -1;

  /** Returns the complete compressed instruction once every fragment of an id has arrived. */
  add(fragment: Uint8Array): Uint8Array | null {
    if (fragment.length < FRAGMENT_HEADER) return null;
    const id = getU64(fragment, 0);
    const raw = getU16(fragment, 8);
    const final = (raw & 0x8000) !== 0;
    const index = raw & 0x7fff;
    const body = fragment.slice(FRAGMENT_HEADER);

    if (id !== this.currentId) {
      this.currentId = id;
      this.chunks = [];
      this.arrived = 0;
      this.total = -1;
    }
    if (this.chunks[index] === undefined) {
      this.chunks[index] = body;
      this.arrived++;
    }
    if (final) {
      this.total = index + 1;
      this.chunks.length = this.total;
    }
    if (this.total === -1 || this.arrived !== this.total) return null;
    const whole = concat(...(this.chunks as Uint8Array[]));
    this.chunks = [];
    this.arrived = 0;
    this.total = -1;
    return whole;
  }
}
