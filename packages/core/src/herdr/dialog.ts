import { isPlaceholder, parseApproval, samePrompt, type ApprovalPrompt } from "./approval.ts";

/** What the phone can do to the pane a dialog is in. */
export interface DialogIO {
  /** The pane's screen; with its colours (ANSI) when it can, so a form's open tab shows. */
  read(): Promise<string>;
  /** Key names as herdr takes them: "1", "enter", "esc", "up", "down", "left", "right", "backspace". */
  keys(keys: string[]): Promise<void>;
  /** Text typed as it is, without Enter. */
  type(text: string): Promise<void>;
  sleep(ms: number): Promise<void>;
}

export type DialogStep =
  /** Pick an option: its digit, or the cursor moved onto it and Enter. */
  | { do: "choose"; option: number }
  /** Put text in a form's "Type something" row (for one answer, that also picks it). */
  | { do: "type"; option: number; text: string }
  /** Open another tab of a form. */
  | { do: "tab"; to: number };

export type DialogResult =
  /** Done; the dialog as it reads now (another tab, the review, or gone). */
  | { ok: true; prompt: ApprovalPrompt }
  /** Nothing more was sent: the dialog changed on the computer, or didn't move as expected. */
  | { ok: false; why: "changed" | "stuck"; prompt: ApprovalPrompt };

export interface DialogTiming {
  /** How long a key gets to show on the screen. */
  settleMs?: number;
  pollMs?: number;
}

/**
 * Carries out one step on a dialog the phone showed. Every key goes in only while the dialog
 * still reads as it did, and moving the cursor is one arrow at a time, reading the screen again
 * after each to see it moved one row and nothing else changed. A digit or Enter answers whatever
 * dialog is there by then, so a surprise stops it.
 */
export async function answerDialog(io: DialogIO, shown: ApprovalPrompt, step: DialogStep, timing: DialogTiming = {}): Promise<DialogResult> {
  const settleMs = timing.settleMs ?? 1500;
  const pollMs = timing.pollMs ?? 50;
  let raw = await io.read();
  let now = parseApproval(raw);
  if (!samePrompt(now, shown)) return { ok: false, why: "changed", prompt: now };

  /**
   * Reads until the screen has changed and either shows what the key was meant to do or holds
   * still for a poll, or until the wait runs out.
   */
  const settle = async (expect?: (p: ApprovalPrompt) => boolean) => {
    const before = raw;
    for (let waited = 0; waited < settleMs; waited += pollMs) {
      await io.sleep(pollMs);
      const r = await io.read();
      const held = r === raw;
      raw = r;
      if (r !== before && (held || expect?.(parseApproval(r)))) break;
    }
    now = parseApproval(raw);
  };
  const press = async (keys: string[], expect?: (p: ApprovalPrompt) => boolean) => {
    await io.keys(keys);
    await settle(expect);
  };
  const stuck = (): DialogResult => ({ ok: false, why: "stuck", prompt: now });
  const changed = (): DialogResult => ({ ok: false, why: "changed", prompt: now });

  /** Moves the cursor to an option, a row at a time. */
  const moveTo = async (target: number): Promise<boolean> => {
    for (let n = 0; n <= now.options.length; n++) {
      if (now.cursor === target) return true;
      if (now.cursor < 0) return false;
      const from = now.cursor;
      const before = now;
      const down = target > from;
      const moved = (p: ApprovalPrompt) => samePrompt(p, before) && p.cursor === from + (down ? 1 : -1);
      await press([down ? "down" : "up"], moved);
      if (!moved(now)) return false;
    }
    return now.cursor === target;
  };
  /** Off the row that takes text: there, digits and arrows would be typed or move the caret. */
  const leaveTyped = async (): Promise<boolean> => {
    const at = now.options[now.cursor];
    if (!at?.typed) return true;
    return moveTo(now.cursor > 0 ? now.cursor - 1 : now.cursor + 1);
  };

  switch (step.do) {
    case "choose": {
      const option = now.options[step.option];
      if (!option || option.typed) return stuck();
      if (option.keys.length > 0) {
        if (now.kind === "form" && !(await leaveTyped())) return stuck();
        await press(option.keys);
        return { ok: true, prompt: now };
      }
      if (!(await moveTo(step.option))) return stuck();
      await press(["enter"]);
      return { ok: true, prompt: now };
    }

    case "type": {
      const option = now.options[step.option];
      const text = step.text.replace(/\s+/g, " ").trim();
      if (now.kind !== "form" || !option?.typed || text === "") return stuck();
      if (!(await moveTo(step.option))) return stuck();
      // Whatever is in the row already goes first.
      for (let n = 0; n < 8 && !isPlaceholder(now.options[step.option]); n++) {
        const before = now;
        await press(Array.from({ length: 64 }, () => "backspace"));
        if (now.kind !== "form" || now.cursor !== before.cursor || now.question.join("\n") !== before.question.join("\n")) return changed();
      }
      if (!isPlaceholder(now.options[step.option])) return stuck();
      const blank = now;
      const typed = (p: ApprovalPrompt) => {
        const row = p.options[step.option];
        const shows = row ? `${row.label} ${row.detail ?? ""}`.replace(/\s+/g, "") : "";
        return p.kind === "form" && p.question.join("\n") === blank.question.join("\n") && shows.startsWith(text.replace(/\s+/g, "").slice(0, 24));
      };
      await io.type(text);
      await settle(typed);
      if (!typed(now)) return stuck();
      if (now.multi) {
        // Ticked by typing. The cursor steps off the row so the next digit picks, not types.
        if (!(await leaveTyped())) return stuck();
        return { ok: true, prompt: now };
      }
      await press(["enter"]);
      return { ok: true, prompt: now };
    }

    case "tab": {
      const tabs = now.tabs ?? [];
      if (now.tab === undefined || now.tab < 0 || step.to < 0 || step.to >= tabs.length) return stuck();
      if (now.kind === "form" && !(await leaveTyped())) return stuck();
      for (let n = 0; n < tabs.length && now.tab !== step.to; n++) {
        const from: number = now.tab ?? -1;
        const right: boolean = step.to > from;
        const next = (p: ApprovalPrompt) => (p.kind === "form" || p.kind === "review") && p.tab === from + (right ? 1 : -1);
        await press([right ? "right" : "left"], next);
        if (!next(now)) return stuck();
        if (JSON.stringify(now.tabs?.map((t) => t.label)) !== JSON.stringify(tabs.map((t) => t.label))) return changed();
      }
      return now.tab === step.to ? { ok: true, prompt: now } : stuck();
    }
  }
}
