import type { DialogIO } from "../../src/herdr/dialog.ts";

/**
 * Stand-ins for dialogs on the computer. They draw their screens the way the real ones do (see
 * fixtures/approval) and take keys the way the real ones were seen to.
 */
export abstract class FakeDialog implements DialogIO {
  sent: string[] = [];
  /** Called before each read, to change things on the computer meanwhile. */
  onRead?: () => void;

  abstract screen(): string;
  protected abstract key(k: string): void;
  protected text(_t: string): void {}

  async read(): Promise<string> {
    this.onRead?.();
    return this.screen();
  }
  async keys(keys: string[]): Promise<void> {
    for (const k of keys) {
      this.sent.push(k);
      this.key(k);
    }
  }
  async type(text: string): Promise<void> {
    this.sent.push(`text:${text}`);
    this.text(text);
  }
  async sleep(): Promise<void> {}
}

const RULE = "─".repeat(55);
const lit = (s: string) => `\x1b[0m\x1b[38;2;0;0;0m\x1b[48;2;177;185;249m${s}\x1b[0m`;

/** A list picked with the arrows and Enter, like Claude Code's folder trust prompt. */
export class FakeArrows extends FakeDialog {
  cursor = 0;
  chosen: number | null = null;
  cancelled = false;
  /** When set, the arrows do nothing (a list that doesn't answer to them). */
  frozen = false;

  question: string;
  options: string[];

  constructor(question: string, options: string[]) {
    super();
    this.question = question;
    this.options = options;
  }

  screen(): string {
    if (this.chosen !== null || this.cancelled) return "❯ ";
    return [RULE, ` ${this.question}`, "", ...this.options.map((o, i) => `${i === this.cursor ? " ❯ " : "   "}${o}`), "", " Enter to confirm · Esc to cancel"].join("\n");
  }

  protected override key(k: string): void {
    if (this.chosen !== null || this.cancelled) return;
    if (k === "down" && !this.frozen) this.cursor = Math.min(this.options.length - 1, this.cursor + 1);
    else if (k === "up" && !this.frozen) this.cursor = Math.max(0, this.cursor - 1);
    else if (k === "enter") this.chosen = this.cursor;
    else if (k === "esc") this.cancelled = true;
  }
}

/**
 * omp's ask: questions in a box, each with radios (Enter picks one and moves on) or tick-boxes
 * (Space ticks, the cursor stays), then Submit. Drawn with the Nerd Font marks omp uses.
 */
export class FakeAsk extends FakeDialog {
  cursor = 0;
  submitted = false;
  cancelled = false;
  questions: { text: string; options: string[]; multi?: boolean }[];
  picked: (number | null)[];
  ticks: Set<number>[];

  constructor(questions: { text: string; options: string[]; multi?: boolean }[]) {
    super();
    this.questions = questions;
    this.picked = questions.map((q) => (q.multi ? null : 0));
    this.ticks = questions.map(() => new Set());
  }

  /** Every row the cursor goes through: [question, option], then Submit as [-1, -1]. */
  private rows(): [number, number][] {
    return [...this.questions.flatMap((q, qi) => q.options.map((_, oi) => [qi, oi] as [number, number])), [-1, -1]];
  }

  screen(): string {
    if (this.submitted || this.cancelled) return "● Done.";
    const out = ["╭─ Ask " + "─".repeat(40) + "╮"];
    let r = 0;
    this.questions.forEach((q, qi) => {
      if (qi > 0) out.push("│");
      out.push(`│ ${q.text}`);
      q.options.forEach((o, oi) => {
        const on = q.multi ? this.ticks[qi].has(oi) : this.picked[qi] === oi;
        const mark = q.multi ? (on ? "\uf14a" : "\uf096") : on ? "\uf192" : "\uf10c";
        out.push(`│ ${r++ === this.cursor ? "\uf054" : " "} ${mark} ${o}`);
      });
    });
    out.push("│", `│ ${r === this.cursor ? "\uf054" : " "} Submit`, "├" + "─".repeat(46) + "┤", "│ \u{f0311} choose · ↑/↓ move · \u{f12b7} cancel", "╰" + "─".repeat(46) + "╯");
    // Both side walls, as omp draws them.
    return out.map((l) => (l.startsWith("│") ? `${l.padEnd(47)}│` : l)).join("\n");
  }

  protected override key(k: string): void {
    if (this.submitted || this.cancelled) return;
    const rows = this.rows();
    const [qi, oi] = rows[this.cursor];
    if (k === "down") this.cursor = Math.min(rows.length - 1, this.cursor + 1);
    else if (k === "up") this.cursor = Math.max(0, this.cursor - 1);
    else if (k === "esc") this.cancelled = true;
    else if (k === "space" && qi >= 0 && this.questions[qi].multi) {
      if (!this.ticks[qi].delete(oi)) this.ticks[qi].add(oi);
    } else if (k === "enter") {
      if (qi < 0) this.submitted = true;
      else if (this.questions[qi].multi) this.cursor = rows.findIndex(([q]) => q === qi + 1 || q === -1);
      else {
        this.picked[qi] = oi;
        this.cursor = rows.findIndex(([q]) => q === qi + 1 || q === -1);
      }
    }
  }
}

export interface FakeQuestion {
  header: string;
  text: string;
  options: string[];
  multi?: boolean;
}

/** Claude Code's question form: a tab per question, then Submit and a review. */
export class FakeForm extends FakeDialog {
  tab = 0;
  cursor = 0;
  /** Single choice: the option index, or typed text. */
  answers: (number | string | null)[];
  ticks: Set<number>[];
  typed: string[];
  typedTicked: boolean[];
  outcome: "submitted" | "cancelled" | "chat" | null = null;

  questions: FakeQuestion[];

  constructor(questions: FakeQuestion[]) {
    super();
    this.questions = questions;
    this.answers = questions.map(() => null);
    this.ticks = questions.map(() => new Set());
    this.typed = questions.map(() => "");
    this.typedTicked = questions.map(() => false);
  }

  get hasSubmitTab(): boolean {
    return this.questions.length > 1 || this.questions.some((q) => q.multi);
  }
  get onReview(): boolean {
    return this.hasSubmitTab && this.tab === this.questions.length;
  }
  private q(): FakeQuestion {
    return this.questions[this.tab];
  }
  /** Rows the cursor moves over: options, the typed row, Submit (tick-boxes), Chat about this. */
  private rows(): ("option" | "typed" | "submit" | "chat")[] {
    if (this.onReview) return ["option", "option"];
    const q = this.q();
    return [...q.options.map(() => "option" as const), "typed", ...(q.multi ? ["submit" as const] : []), "chat"];
  }
  private onTyped(): boolean {
    return !this.onReview && this.rows()[this.cursor] === "typed";
  }
  private answered(i: number): boolean {
    return this.questions[i].multi ? this.ticks[i].size > 0 || this.typedTicked[i] : this.answers[i] !== null;
  }

  screen(): string {
    if (this.outcome) return `● Answers: ${JSON.stringify(this.answers)}`;
    const chips = [...this.questions.map((q, i) => `${this.answered(i) ? "☒" : "☐"} ${q.header}`), ...(this.hasSubmitTab ? ["✔ Submit"] : [])];
    const bar = this.hasSubmitTab ? `← ${chips.map((c, i) => (i === this.tab ? lit(` ${c} `) : ` ${c} `)).join("")} →` : lit(` ${chips[0]} `);
    const out = [RULE, bar, ""];
    const mark = (i: number) => (i === this.cursor ? "❯ " : "  ");
    if (this.onReview) {
      out.push("Review your answers", "");
      this.questions.forEach((q, i) => {
        const a = q.multi
          ? [...[...this.ticks[i]].sort().map((t) => q.options[t]), ...(this.typedTicked[i] ? [this.typed[i]] : [])].join(", ")
          : typeof this.answers[i] === "number"
            ? q.options[this.answers[i] as number]
            : (this.answers[i] ?? "");
        out.push(` ● ${q.text}`, `   → ${a}`);
      });
      out.push("", "Ready to submit your answers?", "", `${mark(0)}1. Submit answers`, `${mark(1)}2. Cancel`);
      return out.join("\n");
    }
    const q = this.q();
    out.push(q.text, "");
    q.options.forEach((o, i) => {
      const box = q.multi ? `[${this.ticks[this.tab].has(i) ? "✔" : " "}] ` : "";
      const done = !q.multi && this.answers[this.tab] === i ? " ✔" : "";
      out.push(`${mark(i)}${i + 1}. ${box}${o}${done}`);
    });
    const n = q.options.length;
    const typedLabel = this.typed[this.tab] || (q.multi ? "Type something" : "Type something.");
    out.push(`${mark(n)}${n + 1}. ${q.multi ? `[${this.typedTicked[this.tab] ? "✔" : " "}] ` : ""}${typedLabel}`);
    if (q.multi) out.push(`${mark(n + 1)}   Submit`);
    out.push(RULE, `${mark(this.rows().length - 1)}${n + 2}. Chat about this`, "", "Enter to select · Tab/Arrow keys to navigate · Esc to cancel");
    return out.join("\n");
  }

  private advance(): void {
    if (!this.hasSubmitTab) this.outcome = "submitted";
    else this.tab++;
    this.cursor = 0;
  }

  /** What Enter or a digit does to a row. */
  private pick(row: number): void {
    const kind = this.rows()[row];
    if (this.onReview) {
      this.outcome = row === 0 ? "submitted" : "cancelled";
      return;
    }
    const q = this.q();
    if (kind === "chat") this.outcome = "chat";
    else if (kind === "submit") {
      this.tab = this.questions.length;
      this.cursor = 0;
    } else if (kind === "typed") {
      if (q.multi) this.typedTicked[this.tab] = !this.typedTicked[this.tab];
      else this.cursor = row;
    } else if (q.multi) {
      const t = this.ticks[this.tab];
      if (t.has(row)) t.delete(row);
      else t.add(row);
    } else {
      this.answers[this.tab] = row;
      this.advance();
    }
  }

  protected override key(k: string): void {
    if (this.outcome) return;
    const rows = this.rows();
    if (/^\d$/.test(k)) {
      if (this.onTyped()) return this.text(k);
      const row = Number(k) - 1;
      if (row >= 0 && row < rows.length) this.pick(row);
    } else if (k === "down") this.cursor = Math.min(rows.length - 1, this.cursor + 1);
    else if (k === "up") this.cursor = Math.max(0, this.cursor - 1);
    else if (k === "left" || k === "right") {
      if (this.onTyped()) return;
      const last = this.hasSubmitTab ? this.questions.length : 0;
      this.tab = Math.max(0, Math.min(last, this.tab + (k === "right" ? 1 : -1)));
      this.cursor = 0;
    } else if (k === "backspace") {
      if (this.onTyped()) this.typed[this.tab] = this.typed[this.tab].slice(0, -1);
    } else if (k === "enter") {
      if (this.onTyped() && !this.q().multi) {
        if (this.typed[this.tab]) {
          this.answers[this.tab] = this.typed[this.tab];
          this.advance();
        }
      } else this.pick(this.cursor);
    } else if (k === "esc") this.outcome = "cancelled";
  }

  protected override text(t: string): void {
    if (!this.onTyped()) return;
    this.typed[this.tab] += t;
    if (this.q().multi) this.typedTicked[this.tab] = true;
  }
}
