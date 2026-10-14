/**
 * Just enough protobuf (proto2 wire format) for mosh's three tiny schemas.
 * Varints are unsigned 64-bit bigints, so uint64(-1) is 2^64 - 1.
 */
export class ProtoWriter {
  private readonly out: number[] = [];

  uint(field: number, value: bigint | number): this {
    this.tag(field, WIRE_VARINT);
    this.varint(BigInt(value));
    return this;
  }

  bytes(field: number, value: Uint8Array): this {
    this.tag(field, WIRE_LEN);
    this.varint(BigInt(value.length));
    for (const b of value) this.out.push(b);
    return this;
  }

  message(field: number, body: (w: ProtoWriter) => void): this {
    const inner = new ProtoWriter();
    body(inner);
    return this.bytes(field, inner.toBytes());
  }

  toBytes(): Uint8Array {
    return Uint8Array.from(this.out);
  }

  private tag(field: number, wire: number): void {
    this.varint(BigInt((field << 3) | wire));
  }

  private varint(v: bigint): void {
    let x = BigInt.asUintN(64, v);
    while (x > 0x7fn) {
      this.out.push(Number(x & 0x7fn) | 0x80);
      x >>= 7n;
    }
    this.out.push(Number(x));
  }
}

export interface ProtoField {
  number: number;
  wire: number;
  varint: bigint;
  bytes: Uint8Array | null;
}

export function readFields(buf: Uint8Array): ProtoField[] {
  const result: ProtoField[] = [];
  let pos = 0;
  const varint = (): bigint => {
    let shift = 0n;
    let v = 0n;
    for (;;) {
      if (pos >= buf.length) throw new ProtoError("truncated varint");
      const b = buf[pos++];
      v |= BigInt(b & 0x7f) << shift;
      if ((b & 0x80) === 0) return v;
      shift += 7n;
      if (shift > 63n) throw new ProtoError("varint too long");
    }
  };
  const skip = (n: number) => {
    if (pos + n > buf.length) throw new ProtoError("truncated");
    pos += n;
  };
  while (pos < buf.length) {
    const key = varint();
    const number = Number(key >> 3n);
    const wire = Number(key & 7n);
    switch (wire) {
      case WIRE_VARINT:
        result.push({ number, wire, varint: varint(), bytes: null });
        break;
      case WIRE_LEN: {
        const len = Number(varint());
        if (len < 0 || pos + len > buf.length) throw new ProtoError(`truncated field ${number}`);
        result.push({ number, wire, varint: 0n, bytes: buf.subarray(pos, pos + len) });
        pos += len;
        break;
      }
      case WIRE_FIXED64:
        skip(8);
        break;
      case WIRE_FIXED32:
        skip(4);
        break;
      default:
        throw new ProtoError(`unsupported wire type ${wire}`);
    }
  }
  return result;
}

export class ProtoError extends Error {}

const WIRE_VARINT = 0;
const WIRE_FIXED64 = 1;
const WIRE_LEN = 2;
const WIRE_FIXED32 = 5;
