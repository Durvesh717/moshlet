import { describe, expect, it } from "vitest";
import { isNegative, parseApproval } from "../src/herdr/approval.ts";

describe("parseApproval", () => {
  it("reads a Claude-style dialog inside a box", () => {
    const screen = [
      "⏺ Checking why the phone link drops…",
      "╭──────────────────────────────────────╮",
      "│ Bash command                         │",
      "│   journalctl -u sshd --since today   │",
      "│ Do you want to proceed?              │",
      "│ ❯ 1. Yes                             │",
      "│   2. Yes, and don't ask again        │",
      "│   3. No, and tell Claude what to do differently (esc) │",
      "╰──────────────────────────────────────╯",
    ].join("\n");
    const p = parseApproval(screen);
    expect(p.parsed).toBe(true);
    expect(p.options.map((o) => o.number)).toEqual(["1", "2", "3"]);
    expect(p.options[1].label).toBe("Yes, and don't ask again");
    expect(p.question.at(-1)).toBe("Do you want to proceed?");
    expect(isNegative(p.options[2])).toBe(true);
    expect(isNegative(p.options[0])).toBe(false);
  });

  it("prefers the live dialog over older numbered output", () => {
    const p = parseApproval("1. old item\n2. old item\nsome output\nAllow this?\n› 1. Yes, proceed\n  2. No");
    expect(p.options.map((o) => o.label)).toEqual(["Yes, proceed", "No"]);
    expect(p.question.at(-1)).toBe("Allow this?");
  });

  it("falls back to Enter and Esc", () => {
    const p = parseApproval("Approve running rm -rf build? [y/N]");
    expect(p.parsed).toBe(false);
    expect(p.options.map((o) => o.keys)).toEqual([["enter"], ["esc"]]);
  });
});
