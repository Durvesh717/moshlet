import { describe, expect, it } from "vitest";
import { KEY_FIELD_SENTINELS, KeyField, keyFieldEdit } from "../src/term/keyField.ts";

const [A, B] = KEY_FIELD_SENTINELS;

describe("keyFieldEdit", () => {
  it("appends, erases and replaces", () => {
    expect(keyFieldEdit(A, A + "x")).toEqual({ deletes: 0, text: "x" });
    expect(keyFieldEdit(A + "ab", A + "a")).toEqual({ deletes: 1, text: "" });
    expect(keyFieldEdit(A, A.slice(1))).toEqual({ deletes: 1, text: "" });
    expect(keyFieldEdit(A + "teh", A + "the ")).toEqual({ deletes: 2, text: "he " });
  });

  it("counts code points and keeps surrogate pairs whole", () => {
    expect(keyFieldEdit(A + "😀", A)).toEqual({ deletes: 1, text: "" });
    expect(keyFieldEdit(A + "😀", A + "😃")).toEqual({ deletes: 1, text: "😃" });
  });

  it("never sends a sentinel", () => {
    expect(keyFieldEdit("", B + "x")).toEqual({ deletes: 0, text: "x" });
  });
});

/** A native field whose resets can be delayed past further typing, as on a real device. */
class FakeField {
  text: string = A;
  sent = "";
  readonly keys = new KeyField();
  private pending: string | null = null;

  type(chars: string, resetLands: boolean) {
    for (const ch of chars) {
      const before = this.text;
      if (ch === "\b") this.text = [...this.text].slice(0, -1).join("");
      else this.text += ch;
      // Like a native field, an unchanged text raises no event.
      if (this.text !== before) this.report();
      if (resetLands) this.land();
    }
  }

  report() {
    const { deletes, text } = this.keys.change(this.text);
    this.sent += "\b".repeat(deletes) + text;
    this.pending = this.keys.target;
  }

  land() {
    if (this.pending !== null) this.text = this.pending;
    this.pending = null;
  }
}

describe("KeyField", () => {
  it("turns slow typing into exact input", () => {
    const f = new FakeField();
    f.type("echo hi\b\bok", true);
    expect(f.sent).toBe("echo hi\b\bok");
  });

  it("doesn't repeat text when resets arrive late", () => {
    const f = new FakeField();
    f.type("ec", false);
    f.type("ho", false);
    f.land();
    f.type(" 42", false);
    f.land();
    f.type("!", true);
    expect(f.sent).toBe("echo 42!");
  });

  it("ignores a change reported twice", () => {
    const f = new FakeField();
    f.type("sle", false);
    f.report();
    f.type("ep", false);
    expect(f.sent).toBe("sleep");
  });

  it("keeps every backspace of a burst on either side of a late reset", () => {
    const f = new FakeField();
    f.type("ab\b", false);
    f.land();
    f.type("\b\b\b\b\b", false);
    f.land();
    f.type("\b", true);
    f.type("c", true);
    expect(f.sent).toBe("ab" + "\b".repeat(7) + "c");
  });

  it("recovers after the sentinels themselves are erased", () => {
    const f = new FakeField();
    f.type("\b".repeat(A.length), false);
    f.type("x", false);
    f.land();
    f.type("y", true);
    expect(f.sent).toBe("\b".repeat(A.length) + "xy");
  });
});
