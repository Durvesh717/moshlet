import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { isNegative, isPlaceholder, parseApproval, samePrompt } from "../src/herdr/approval.ts";

/** Screens read off real dialogs (trimmed to the dialog), with their colours or as plain text. */
const screen = (name: string, ext: "ansi" | "txt" = "ansi") =>
  readFileSync(new URL(`./fixtures/approval/${name}.${ext}`, import.meta.url), "utf8");

describe("parseApproval: numbered choices", () => {
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
    expect(p.kind).toBe("numbered");
    expect(p.parsed).toBe(true);
    expect(p.options.map((o) => o.number)).toEqual(["1", "2", "3"]);
    expect(p.options[1].label).toBe("Yes, and don't ask again");
    expect(p.question.at(-1)).toBe("Do you want to proceed?");
    expect(p.cursor).toBe(0);
    expect(isNegative(p.options[2])).toBe(true);
    expect(isNegative(p.options[0])).toBe(false);
  });

  it("joins choices that wrap, and leaves dashed rules out of the question", () => {
    const p = parseApproval(screen("claude-permission"));
    expect(p.kind).toBe("numbered");
    expect(p.options.map((o) => o.label)).toEqual([
      "Yes",
      "Yes, and always allow access to /home/sam/code/clients/acme-dashboard/packages/web-app/src/components/status-badges/generated/svg from this project",
      "Yes, and switch to auto mode · auto mode handles these prompts for you",
      "No",
    ]);
    expect(p.options.map((o) => o.keys)).toEqual([["1"], ["2"], ["3"], ["4"]]);
    expect(p.question).toContain("touch hello.txt");
    expect(p.question.at(-1)).toBe("Do you want to proceed?");
    expect(p.question.some((l) => l.includes("╌"))).toBe(false);
  });

  it("joins a word cut at the screen's edge without a space", () => {
    const rule = "─".repeat(20);
    const p = parseApproval([rule, "Allow?", "❯ 1. Yes", "  2. Always allow", "     /home/sam/projec", "     ts/web and", "     more", "  3. No", "", "Esc to cancel"].join("\n"));
    expect(p.options[1].label).toBe("Always allow /home/sam/projects/web and more");
  });

  it("joins a word cut after other words on its line, and not words that just fill a line", () => {
    const rule = "─".repeat(24);
    const p = parseApproval(
      [rule, "Allow?", "❯ 1. Allow it to /home/s", "     am/projects/web and", "     its files", "  2. Yes, and now switch", "     it on for good", "", "Esc to cancel"].join("\n"),
    );
    expect(p.options[0].label).toBe("Allow it to /home/sam/projects/web and its files");
    expect(p.options[1].label).toBe("Yes, and now switch it on for good");
  });

  it("reads the same from plain text", () => {
    expect(samePrompt(parseApproval(screen("claude-permission")), parseApproval(screen("claude-permission", "txt")))).toBe(true);
  });

  it("prefers the live dialog over older numbered output", () => {
    const p = parseApproval("1. old item\n2. old item\nsome output\nAllow this?\n› 1. Yes, proceed\n  2. No");
    expect(p.options.map((o) => o.label)).toEqual(["Yes, proceed", "No"]);
    expect(p.question.at(-1)).toBe("Allow this?");
  });

  it("isn't fooled by a to-do list above a dialog", () => {
    const p = parseApproval(["☐ Fix the flaky test", "☒ Read the logs", "Do you want to proceed?", "❯ 1. Yes", "  2. No", "", "Esc to cancel"].join("\n"));
    expect(p.kind).toBe("numbered");
  });
});

describe("parseApproval: arrow lists", () => {
  it("reads Claude Code's folder trust prompt", () => {
    const p = parseApproval(screen("claude-trust"));
    expect(p.kind).toBe("arrows");
    expect(p.options.map((o) => o.label)).toEqual(["No, exit", "Yes, I trust this folder", "Cancel (Esc)"]);
    expect(p.options[0].keys).toEqual([]);
    expect(p.options[2].keys).toEqual(["esc"]);
    expect(p.cursor).toBe(0);
    expect(p.question.at(-1)).toBe("Security guide");
  });

  it("reads omp's question inside its box", () => {
    const p = parseApproval(screen("omp-ask"));
    expect(p.kind).toBe("arrows");
    expect(p.options.map((o) => o.label)).toEqual(["Red", "Green", "Blue", "Other (type your own)", "Cancel (Esc)"]);
    expect(p.cursor).toBe(0);
    expect(p.question).toEqual(["Which colour should the badge be?"]);
  });

  it("follows the cursor, and still reads as the same dialog", () => {
    const down = screen("omp-ask", "txt").replace("❯ ○ Red  ", "  ○ Red  ").replace("  ○ Green", "❯ ○ Green");
    const a = parseApproval(screen("omp-ask"));
    const b = parseApproval(down);
    expect(b.cursor).toBe(1);
    expect(samePrompt(a, b)).toBe(true);
  });

  it("needs a hint that Enter picks, so a quoted message isn't taken for a list", () => {
    const p = parseApproval(["❯ Fix the login bug", "  and then run the tests", "", "● Looking at the code…"].join("\n"));
    expect(p.kind).toBe("unknown");
  });
});

describe("parseApproval: Claude Code's question forms", () => {
  it("reads the first question, its tabs and which one is open", () => {
    const p = parseApproval(screen("claude-form-first"));
    expect(p.kind).toBe("form");
    expect(p.tabs).toEqual([
      { label: "Colour", answered: false, submit: false },
      { label: "Toppings", answered: false, submit: false },
      { label: "Submit", answered: false, submit: true },
    ]);
    expect(p.tab).toBe(0);
    expect(p.multi).toBe(false);
    expect(p.question).toEqual(["Which colour should the badge be?"]);
    expect(p.options.map((o) => [o.number, o.label, o.detail ?? null])).toEqual([
      ["1", "Red", "A bold, high-attention red."],
      ["2", "Green", "A fresh, positive green."],
      ["3", "Blue", "A calm, neutral blue."],
      ["4", "Type something.", null],
      ["5", "Chat about this", null],
    ]);
    expect(p.options[3].typed).toBe(true);
    expect(p.options[3].keys).toEqual([]);
    expect(isPlaceholder(p.options[3])).toBe(true);
    expect(p.options[4].extra).toBe(true);
    expect(p.cursor).toBe(0);
  });

  it("can't tell the open tab from plain text", () => {
    const p = parseApproval(screen("claude-form-first", "txt"));
    expect(p.kind).toBe("form");
    expect(p.tab).toBe(-1);
  });

  it("reads tick-boxes and the Submit row", () => {
    const p = parseApproval(screen("claude-form-ticks"));
    expect(p.kind).toBe("form");
    expect(p.multi).toBe(true);
    expect(p.tab).toBe(1);
    expect(p.tabs?.[0].answered).toBe(true);
    expect(p.options.map((o) => [o.label, o.checked ?? null, o.submit ?? false])).toEqual([
      ["Cheese", false, false],
      ["Olives", false, false],
      ["Basil", false, false],
      ["Type something", false, false],
      ["Submit", null, true],
      ["Chat about this", null, false],
    ]);
    expect(p.options[4].keys).toEqual([]);
  });

  it("shows what's ticked, and ticking makes it a different dialog", () => {
    const before = parseApproval(screen("claude-form-ticks"));
    const after = parseApproval(screen("claude-form-ticked"));
    expect(after.options.filter((o) => o.checked).map((o) => o.label)).toEqual(["Cheese", "Basil"]);
    expect(samePrompt(before, after)).toBe(false);
  });

  it("reads typed text in place of the placeholder", () => {
    const p = parseApproval(screen("claude-form-ticks-typed"));
    const typed = p.options[3];
    expect(typed.label).toBe("anchovies");
    expect(typed.typed).toBe(true);
    expect(typed.checked).toBe(true);
    expect(isPlaceholder(typed)).toBe(false);
    expect(p.cursor).toBe(3);
  });

  it("finds the cursor on the Submit row", () => {
    expect(parseApproval(screen("claude-form-ticks-on-submit")).cursor).toBe(4);
  });

  it("reads an answered question", () => {
    const p = parseApproval(screen("claude-form-answered"));
    expect(p.tab).toBe(0);
    expect(p.tabs?.map((t) => t.answered)).toEqual([true, true, false]);
    expect(p.options[0]).toMatchObject({ label: "Red", checked: true });
  });

  it("reads the cursor on the row being typed into", () => {
    const p = parseApproval(screen("claude-form-typing"));
    expect(p.kind).toBe("form");
    expect(p.cursor).toBe(2);
    expect(p.options[2].typed).toBe(true);
    expect(parseApproval(screen("claude-form-typed")).options[2].label).toBe("mango");
  });

  it("reads a single question, which has no Submit tab", () => {
    const p = parseApproval(screen("claude-form-single"));
    expect(p.kind).toBe("form");
    expect(p.tabs).toEqual([{ label: "Size", answered: false, submit: false }]);
    expect(p.tab).toBe(0);
    expect(p.options.map((o) => o.label)).toEqual(["Small", "Medium", "Large", "Type something.", "Chat about this"]);
  });

  it("reads a single question with tick-boxes, which does", () => {
    const p = parseApproval(screen("claude-form-single-ticks"));
    expect(p.multi).toBe(true);
    expect(p.tabs?.map((t) => t.label)).toEqual(["Days", "Submit"]);
  });

  it("reads the review", () => {
    const p = parseApproval(screen("claude-form-review"));
    expect(p.kind).toBe("review");
    expect(p.tab).toBe(2);
    expect(p.answers).toEqual([
      { question: "Which colour should the badge be?", answer: "Red" },
      { question: "Which toppings do you want?", answer: "Cheese, Basil, anchovies" },
    ]);
    expect(p.question).toEqual(["Ready to submit your answers?"]);
    expect(p.options.map((o) => [o.keys, o.label])).toEqual([
      [["1"], "Submit answers"],
      [["2"], "Cancel"],
    ]);
  });
});

describe("parseApproval: anything else", () => {
  it("falls back to Enter and Esc", () => {
    const p = parseApproval("Approve running rm -rf build? [y/N]");
    expect(p.parsed).toBe(false);
    expect(p.kind).toBe("unknown");
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

  it("tells one form tab from the next", () => {
    expect(samePrompt(parseApproval(screen("claude-form-first")), parseApproval(screen("claude-form-ticks")))).toBe(false);
  });
});
