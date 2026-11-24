import { describe, expect, it } from "vitest";
import { parseApproval } from "../src/herdr/approval.ts";
import { answerDialog } from "../src/herdr/dialog.ts";
import { FakeArrows, FakeAsk, FakeForm, type FakeDialog } from "./support/dialogs.ts";

const timing = { settleMs: 20, pollMs: 1 };
const shown = (d: FakeDialog) => parseApproval(d.screen());

const colour = { header: "Colour", text: "Which colour should the badge be?", options: ["Red", "Green", "Blue"] };
const toppings = { header: "Toppings", text: "Which toppings do you want?", options: ["Cheese", "Olives", "Basil"], multi: true };

describe("answerDialog: arrow lists", () => {
  it("moves the cursor one row at a time, then picks with Enter", async () => {
    const d = new FakeArrows("Trust this folder?", ["No, exit", "Maybe later", "Yes, I trust this folder"]);
    const r = await answerDialog(d, shown(d), { do: "choose", option: 2 }, timing);
    expect(r.ok).toBe(true);
    expect(d.chosen).toBe(2);
    expect(d.sent).toEqual(["down", "down", "enter"]);
  });

  it("moves up as well", async () => {
    const d = new FakeArrows("Trust this folder?", ["No, exit", "Yes, I trust this folder"]);
    d.cursor = 1;
    await answerDialog(d, shown(d), { do: "choose", option: 0 }, timing);
    expect(d.sent).toEqual(["up", "enter"]);
    expect(d.chosen).toBe(0);
  });

  it("sends Esc for Cancel", async () => {
    const d = new FakeArrows("Trust this folder?", ["No, exit", "Yes, I trust this folder"]);
    const p = shown(d);
    await answerDialog(d, p, { do: "choose", option: p.options.findIndex((o) => o.keys[0] === "esc") }, timing);
    expect(d.sent).toEqual(["esc"]);
    expect(d.cancelled).toBe(true);
  });

  it("sends nothing when the dialog changed since it was shown", async () => {
    const d = new FakeArrows("Trust this folder?", ["No, exit", "Yes, I trust this folder"]);
    const p = shown(d);
    d.question = "Delete everything?";
    const r = await answerDialog(d, p, { do: "choose", option: 1 }, timing);
    expect(r).toMatchObject({ ok: false, why: "changed" });
    expect(d.sent).toEqual([]);
  });

  it("stops without Enter when the cursor doesn't move", async () => {
    const d = new FakeArrows("Trust this folder?", ["No, exit", "Yes, I trust this folder"]);
    d.frozen = true;
    const r = await answerDialog(d, shown(d), { do: "choose", option: 1 }, timing);
    expect(r).toMatchObject({ ok: false, why: "stuck" });
    expect(d.sent).not.toContain("enter");
    expect(d.chosen).toBeNull();
  });

  it("waits out a frame caught halfway through a redraw", async () => {
    const d = new FakeArrows("Trust this folder?", ["No, exit", "Maybe later", "Yes, I trust this folder"]);
    const p = shown(d);
    const full = d.screen.bind(d);
    let half = false;
    d.screen = () => (half ? ((half = false), full().split("\n").slice(0, 3).join("\n")) : full());
    const keys = d.keys.bind(d);
    d.keys = async (k) => {
      await keys(k);
      half = true;
    };
    const r = await answerDialog(d, p, { do: "choose", option: 2 }, timing);
    expect(r.ok).toBe(true);
    expect(d.chosen).toBe(2);
  });

  it("stops without Enter when the list changes on the way", async () => {
    const d = new FakeArrows("Trust this folder?", ["No, exit", "Maybe later", "Yes, I trust this folder"]);
    const p = shown(d);
    let reads = 0;
    d.onRead = () => {
      if (++reads === 3) d.options = ["Run rm -rf ~", "Don't", "Ask again"];
    };
    const r = await answerDialog(d, p, { do: "choose", option: 2 }, timing);
    expect(r.ok).toBe(false);
    expect(d.sent).not.toContain("enter");
  });
});

describe("answerDialog: omp's ask", () => {
  const db = { text: "Which database?", options: ["Postgres", "SQLite", "MySQL"] };
  const extras = { text: "Which extras?", options: ["Auth", "Logging", "Metrics"], multi: true };

  it("picks a radio with Enter, and the ask stays for Submit", async () => {
    const d = new FakeAsk([db]);
    let r = await answerDialog(d, shown(d), { do: "choose", option: 1 }, timing);
    expect(d.sent).toEqual(["down", "enter"]);
    expect(r.ok && r.prompt.stays).toBe(true);
    expect(r.prompt.options.filter((o) => o.checked).map((o) => o.label)).toEqual(["SQLite"]);
    expect(r.prompt.cursor).toBe(r.prompt.options.findIndex((o) => o.submit));
    r = await answerDialog(d, r.prompt, { do: "choose", option: r.prompt.options.findIndex((o) => o.submit) }, timing);
    expect(r.ok).toBe(true);
    expect(d.submitted).toBe(true);
    expect(d.picked).toEqual([1]);
  });

  it("ticks a box with Space and stays on it", async () => {
    const d = new FakeAsk([db, extras]);
    // Postgres, SQLite, MySQL, then Auth (3), Logging (4), Metrics (5), then Submit.
    let r = await answerDialog(d, shown(d), { do: "choose", option: 5 }, timing);
    expect(d.sent).toEqual(["down", "down", "down", "down", "down", "space"]);
    expect(r.ok && r.prompt.cursor).toBe(5);
    r = await answerDialog(d, r.prompt, { do: "choose", option: 3 }, timing);
    expect(r.prompt.options.filter((o) => o.checked).map((o) => o.label)).toEqual(["Postgres", "Auth", "Metrics"]);
    r = await answerDialog(d, r.prompt, { do: "choose", option: r.prompt.options.findIndex((o) => o.submit) }, timing);
    expect(d.submitted).toBe(true);
    expect([...d.ticks[1]].sort()).toEqual([0, 2]);
  });

  it("sends nothing when a box was ticked on the computer since it was shown", async () => {
    const d = new FakeAsk([db, extras]);
    const p = shown(d);
    d.ticks[1].add(1);
    const r = await answerDialog(d, p, { do: "choose", option: 5 }, timing);
    expect(r).toMatchObject({ ok: false, why: "changed" });
    expect(d.sent).toEqual([]);
  });
});

describe("answerDialog: Claude Code's question forms", () => {
  it("picks with the digit, and the form moves on to the next question", async () => {
    const d = new FakeForm([colour, toppings]);
    const r = await answerDialog(d, shown(d), { do: "choose", option: 1 }, timing);
    expect(d.sent).toEqual(["2"]);
    expect(d.answers[0]).toBe(1);
    expect(r.ok && r.prompt.tab).toBe(1);
    expect(r.ok && r.prompt.multi).toBe(true);
  });

  it("ticks boxes and stays on the question", async () => {
    const d = new FakeForm([colour, toppings]);
    d.tab = 1;
    let r = await answerDialog(d, shown(d), { do: "choose", option: 0 }, timing);
    r = await answerDialog(d, r.prompt, { do: "choose", option: 2 }, timing);
    expect([...d.ticks[1]]).toEqual([0, 2]);
    expect(r.prompt.options.filter((o) => o.checked).map((o) => o.label)).toEqual(["Cheese", "Basil"]);
    expect(r.prompt.tab).toBe(1);
  });

  it("types an answer of its own, then Enter for a single choice", async () => {
    const d = new FakeForm([colour, toppings]);
    const r = await answerDialog(d, shown(d), { do: "type", option: 3, text: "purple" }, timing);
    expect(d.sent).toEqual(["down", "down", "down", "text:purple", "enter"]);
    expect(d.answers[0]).toBe("purple");
    expect(r.ok && r.prompt.tab).toBe(1);
  });

  it("clears what was typed before", async () => {
    const d = new FakeForm([colour, toppings]);
    d.typed[0] = "teal";
    d.cursor = 3;
    await answerDialog(d, shown(d), { do: "type", option: 3, text: "purple" }, timing);
    expect(d.answers[0]).toBe("purple");
    expect(d.sent.filter((k) => k === "backspace").length).toBeGreaterThanOrEqual(4);
  });

  it("types into a tick-box question, then steps off the row so digits pick again", async () => {
    const d = new FakeForm([colour, toppings]);
    d.tab = 1;
    let r = await answerDialog(d, shown(d), { do: "type", option: 3, text: "anchovies" }, timing);
    expect(r.ok).toBe(true);
    expect(d.typed[1]).toBe("anchovies");
    expect(d.typedTicked[1]).toBe(true);
    r = await answerDialog(d, r.prompt, { do: "choose", option: 0 }, timing);
    expect(d.typed[1]).toBe("anchovies");
    expect([...d.ticks[1]]).toEqual([0]);
  });

  it("steps off the row being typed into before a digit", async () => {
    const d = new FakeForm([colour, toppings]);
    d.cursor = 3;
    await answerDialog(d, shown(d), { do: "choose", option: 0 }, timing);
    expect(d.sent).toEqual(["up", "1"]);
    expect(d.typed[0]).toBe("");
    expect(d.answers[0]).toBe(0);
  });

  it("opens another tab, an arrow at a time", async () => {
    const d = new FakeForm([colour, toppings]);
    let r = await answerDialog(d, shown(d), { do: "tab", to: 2 }, timing);
    expect(d.sent).toEqual(["right", "right"]);
    expect(r.ok && r.prompt.kind).toBe("review");
    r = await answerDialog(d, r.prompt, { do: "tab", to: 0 }, timing);
    expect(r.ok && r.prompt.tab).toBe(0);
  });

  it("goes to the review from the Submit row, and submits", async () => {
    const d = new FakeForm([toppings]);
    let r = await answerDialog(d, shown(d), { do: "choose", option: 1 }, timing);
    r = await answerDialog(d, r.prompt, { do: "choose", option: r.prompt.options.findIndex((o) => o.submit) }, timing);
    expect(r.ok && r.prompt.kind).toBe("review");
    expect(r.prompt.answers).toEqual([{ question: toppings.text, answer: "Olives" }]);
    r = await answerDialog(d, r.prompt, { do: "choose", option: 0 }, timing);
    expect(d.outcome).toBe("submitted");
    expect(r.ok && r.prompt.kind).toBe("unknown");
  });

  it("answers a whole form", async () => {
    const d = new FakeForm([colour, toppings]);
    let p = shown(d);
    p = (await answerDialog(d, p, { do: "choose", option: 2 }, timing)).prompt;
    p = (await answerDialog(d, p, { do: "choose", option: 0 }, timing)).prompt;
    p = (await answerDialog(d, p, { do: "type", option: 3, text: "anchovies" }, timing)).prompt;
    p = (await answerDialog(d, p, { do: "tab", to: 2 }, timing)).prompt;
    expect(p.answers).toEqual([
      { question: colour.text, answer: "Blue" },
      { question: toppings.text, answer: "Cheese, anchovies" },
    ]);
    await answerDialog(d, p, { do: "choose", option: 0 }, timing);
    expect(d.outcome).toBe("submitted");
  });

  it("a single question is answered by its pick", async () => {
    const d = new FakeForm([{ header: "Size", text: "Which size?", options: ["Small", "Medium", "Large"] }]);
    const p = shown(d);
    expect(p.tabs?.length).toBe(1);
    await answerDialog(d, p, { do: "choose", option: 1 }, timing);
    expect(d.outcome).toBe("submitted");
    expect(d.answers[0]).toBe(1);
  });

  it("sends nothing when the question changed since it was shown", async () => {
    const d = new FakeForm([colour, toppings]);
    const p = shown(d);
    d.tab = 1;
    const r = await answerDialog(d, p, { do: "choose", option: 0 }, timing);
    expect(r).toMatchObject({ ok: false, why: "changed" });
    expect(d.sent).toEqual([]);
  });
});

describe("answerDialog: numbered choices", () => {
  it("sends just the digit", async () => {
    let sent: string[] = [];
    const screen = "Do you want to proceed?\n❯ 1. Yes\n  2. No\n\nEsc to cancel";
    const io = { read: async () => screen, keys: async (k: string[]) => void (sent = [...sent, ...k]), type: async () => {}, sleep: async () => {} };
    await answerDialog(io, parseApproval(screen), { do: "choose", option: 1 }, timing);
    expect(sent).toEqual(["2"]);
  });
});
