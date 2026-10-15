import { describe, expect, it } from "vitest";
import { Interpreter } from "../src/term/interpreter.ts";
import { Screen } from "../src/term/screen.ts";
import { rowsMoved, rowTexts } from "../src/term/shift.ts";

const lines = (from: number, n: number) => Array.from({ length: n }, (_, i) => `line ${from + i}`);

describe("rowsMoved", () => {
  it("sees older rows coming in at the top as a move down", () => {
    expect(rowsMoved(lines(10, 8), lines(7, 8), -6, 6, 3)).toBe(3);
  });

  it("sees newer rows coming in at the bottom as a move up", () => {
    expect(rowsMoved(lines(10, 8), lines(13, 8), -6, 6, -3)).toBe(-3);
  });

  it("says 0 when nothing moved, or the frame is something else entirely", () => {
    expect(rowsMoved(lines(10, 8), lines(10, 8), -6, 6, 3)).toBe(0);
    expect(rowsMoved(lines(10, 8), lines(500, 8), -6, 6, 3)).toBe(0);
  });

  it("ignores blank rows and stays within the range it was given", () => {
    const blanks = ["", "", "a", "", "b", "", "c", ""];
    expect(rowsMoved(blanks, ["", "", "", "", "a", "", "b", ""], -1, 1, 1)).toBe(0);
    expect(rowsMoved(blanks, ["", "", "", "", "a", "", "b", ""], -3, 3, 2)).toBe(2);
  });

  it("still finds the move when a new line was printed at the same time", () => {
    const next = lines(7, 8);
    next[7] = "fresh output";
    expect(rowsMoved(lines(10, 8), next, -6, 6, 3)).toBe(3);
  });

  it("breaks ties between repeating rows with the expected move", () => {
    const border = ["──", "x", "──", "x", "──", "x"];
    expect(rowsMoved(border, ["x", "──", "x", "──", "x", "──"], -3, 3, 1)).toBe(1);
    expect(rowsMoved(border, ["x", "──", "x", "──", "x", "──"], -3, 3, -1)).toBe(-1);
  });
});

describe("rowTexts", () => {
  it("reads each row as text, wide characters once, trailing blanks dropped", () => {
    const s = new Screen(10, 3);
    new Interpreter(s).feed(new TextEncoder().encode("hi there  \r\n界!\r\n"));
    expect(rowTexts(s)).toEqual(["hi there", "界!", ""]);
  });
});
