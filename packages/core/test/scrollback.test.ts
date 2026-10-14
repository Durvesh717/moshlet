import { describe, expect, it } from "vitest";
import { historyAbove, layoutScrollback } from "../src/term/scrollback.ts";
import { Attr, has, PLAIN, type Cell } from "../src/term/style.ts";

const text = (row: readonly Cell[]) => row.filter((c) => c.width !== 0).map((c) => c.text || " ").join("").trimEnd();

describe("layoutScrollback", () => {
  it("wraps long lines and keeps blank ones", () => {
    expect(layoutScrollback(["abcdefghij", "", "xy"], 4).map(text)).toEqual(["abcd", "efgh", "ij", "", "xy"]);
  });

  it("adds no blank rows for lines that exactly fill the width", () => {
    expect(layoutScrollback(["abcd", "efgh"], 4).map(text)).toEqual(["abcd", "efgh"]);
  });

  it("keeps colors, drops links and doesn't bleed style across lines", () => {
    const rows = layoutScrollback(["\x1b[1;31mred\x1b]8;;http://x\x07link\x1b]8;;\x07", "plain"], 20);
    expect(rows.map(text)).toEqual(["redlink", "plain"]);
    expect(rows[0][0].style.fg).toBe(1);
    expect(has(rows[0][0].style, Attr.BOLD)).toBe(true);
    expect(rows[1][0].style).toBe(PLAIN);
  });

  it("lays out emoji presentation two columns wide like herdr", () => {
    const rows = layoutScrollback(["⚠️ Memory", "⚠ plain"], 20);
    expect([rows[0][0].width, rows[0][1].width, rows[0][3].text]).toEqual([2, 0, "M"]);
    expect([rows[1][0].width, rows[1][2].text]).toEqual([1, "p"]);
  });

  it("never loses the oldest rows to wide glyphs wrapping early", () => {
    const rows = layoutScrollback(Array.from({ length: 50 }, () => "界".repeat(5)), 9);
    expect(rows.length).toBe(100);
    expect(text(rows[0])).toBe("界界界界");
  });
});

describe("historyAbove", () => {
  it("cuts the visible screen off the end of a recent read", () => {
    expect(historyAbove("a\r\nb\r\nc\r\nd\r\n", "c\r\nd\r\n")).toEqual(["a", "b"]);
    expect(historyAbove("c\nd", "c\nd")).toEqual([]);
  });
});
