import { describe, expect, it } from "vitest";
import { isNegative, parseApproval, samePrompt } from "../src/herdr/approval.ts";

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

describe("samePrompt", () => {
  const dialog = (command: string, marker = 1) =>
    parseApproval(
      [
        "Bash command",
        `  ${command}`,
        "Do you want to proceed?",
        `${marker === 1 ? "❯" : " "} 1. Yes`,
        `${marker === 2 ? "❯" : " "} 2. Yes, and don't ask again this session`,
        "  3. No, and tell Claude what to do differently (esc)",
      ].join("\n"),
    );

  it("matches the same dialog, wherever the cursor sits", () => {
    expect(samePrompt(dialog("ls"), dialog("ls"))).toBe(true);
    expect(samePrompt(dialog("ls", 1), dialog("ls", 2))).toBe(true);
  });

  it("tells a new request apart, though the digits are the same", () => {
    expect(samePrompt(dialog("ls"), dialog("rm -rf build"))).toBe(false);
  });

  it("tells a dialog apart from a screen with none", () => {
    expect(samePrompt(dialog("ls"), parseApproval("$ "))).toBe(false);
  });
});
