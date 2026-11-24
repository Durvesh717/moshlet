import { describe, expect, it } from "vitest";
import { Screen } from "../src/term/screen.ts";
import { Interpreter } from "../src/term/interpreter.ts";
import { selectionText, wordAt } from "../src/term/selection.ts";
import { utf8Encode } from "../src/bytes.ts";

function screen(cols: number, rows: number, text: string): Screen {
  const s = new Screen(cols, rows);
  Interpreter.apply(s, utf8Encode(text));
  return s;
}
const rowsOf = (s: Screen) => ({ rows: s.lines, wrapped: s.wrapped });

describe("selectionText", () => {
  it("joins soft-wrapped rows and keeps real newlines, in either direction", () => {
    const s = screen(5, 4, "abcdefg\r\nxy  \r\nz");
    expect(selectionText(rowsOf(s), { row: 0, col: 0 }, { row: 3, col: 0 })).toBe("abcdefg\nxy\nz");
    expect(selectionText(rowsOf(s), { row: 3, col: 0 }, { row: 0, col: 2 })).toBe("cdefg\nxy\nz");
  });

  it("keeps a wrapped row's own spaces but drops trailing blanks at a newline", () => {
    const s = screen(4, 3, "ab  cd\r\nef");
    expect(selectionText(rowsOf(s), { row: 0, col: 0 }, { row: 1, col: 3 })).toBe("ab  cd");
  });

  it("copies a wide glyph once, even when the selection starts on its right half", () => {
    const s = screen(10, 2, "a界b");
    expect(selectionText(rowsOf(s), { row: 0, col: 2 }, { row: 0, col: 3 })).toBe("界b");
  });

  it("keeps blank lines between selected rows", () => {
    const s = screen(5, 4, "a\r\n\r\nb");
    expect(selectionText(rowsOf(s), { row: 0, col: 0 }, { row: 2, col: 4 })).toBe("a\n\nb");
  });
});

describe("wordAt", () => {
  const row = screen(40, 1, 'cat "~/src/a-b.ts:12" x').lines[0];

  it("takes a whole path, stopping at quotes", () => {
    expect(wordAt(row, 9)).toEqual([5, 19]);
  });

  it("selects just the cell on a separator", () => {
    expect(wordAt(row, 3)).toEqual([3, 3]);
  });

  it("covers both halves of wide glyphs", () => {
    expect(wordAt(screen(10, 1, "界界 x").lines[0], 3)).toEqual([0, 3]);
  });
});
