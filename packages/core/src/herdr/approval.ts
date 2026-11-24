/**
 * Reads an agent's approval dialog or question off its screen. Four shapes are known:
 *
 * - numbered choices ("1. Yes", "2. Yes, and don't ask again", "3. No"): the digit picks one;
 * - arrow lists (a ❯ on one of a few lines, no digits): move the cursor there, then Enter;
 * - Claude Code's question forms: a tab per question (and a Submit tab when there is more than one
 *   question or tick-boxes), numbered options, tick-boxes when several may be picked, a row that
 *   takes typed text ("Type something"), and below a rule, "Chat about this";
 * - the form's review, with each answer and Submit answers / Cancel;
 * - omp's ask: one or more questions in a box, radios or tick-boxes under each, picked with the
 *   arrows (Space ticks a box), then Submit.
 *
 * Anything else falls back to Enter / Esc. The screen may come as plain text or with its colours
 * (ANSI); the colours only tell which form tab is open, since that tab is shown highlighted.
 */
export type ApprovalKind = "numbered" | "arrows" | "form" | "review" | "unknown";

export interface ApprovalOption {
  /** Keys that pick it in one go (its digit, or Esc). Empty when the cursor has to go there. */
  keys: string[];
  label: string;
  number: string | null;
  /** Form: the line under the option. */
  detail?: string;
  /** Form: ticked ([✔]), or the answer already given (✔). */
  checked?: boolean;
  /** Form: the row that takes typed text ("Type something", or what was typed into it). */
  typed?: boolean;
  /** Form: the Submit row under tick-boxes. omp's ask: its Submit row. */
  submit?: boolean;
  /** omp's ask: a tick-box, ticked with Space (Enter would move on). */
  toggle?: boolean;
  /** Form: under the rule ("Chat about this"). */
  extra?: boolean;
}

export interface FormTab {
  label: string;
  answered: boolean;
  /** The last tab, which reviews the answers. */
  submit: boolean;
}

export interface ApprovalPrompt {
  kind: ApprovalKind;
  question: string[];
  options: ApprovalOption[];
  /** The option the ❯ is on, or -1. */
  cursor: number;
  parsed: boolean;
  /** Forms and reviews: one tab per question, then Submit. */
  tabs?: FormTab[];
  /** The open tab, or -1 when the read carried no colours to tell. */
  tab?: number;
  /** Form: several options may be ticked. */
  multi?: boolean;
  /** omp's ask: picking a choice only marks it, and the dialog stays until Submit. */
  stays?: boolean;
  /** Review: each question with its answer. */
  answers?: { question: string; answer: string }[];
}

/** One screen line with box edges taken off, and which of its characters have a background. */
interface Line {
  text: string;
  indent: number;
  /** A horizontal rule or a box's top, bottom or divider. */
  rule: boolean;
  /** Per character of `text`: drawn on a background (highlighted). */
  marked: boolean[];
}

const CURSOR = "❯›>▶\uf054";
const OPTION = /^(?:([❯›>▶●*])\s*)?(\d)[.)]\s+(.+)$/u;
const RULE_ONLY = /^[─━╌┄┈═\s]+$/u;
const BOX_EDGE = /^[╭╰├┌└╞╘]/u;
const TAB_BAR = /^(?:←\s+)?[☐☒✔]\s+\S.*$/u;
const PLACEHOLDER = /^Type something\.?$/;

/** Splits a screen into lines, taking colours out but noting which characters are highlighted. */
function decode(screen: string): { chars: string[]; marked: boolean[] }[] {
  const out: { chars: string[]; marked: boolean[] }[] = [{ chars: [], marked: [] }];
  let bg = false;
  let inverse = false;
  const cps = Array.from(screen);
  for (let i = 0; i < cps.length; i++) {
    const c = cps[i];
    if (c === "\x1b") {
      const next = cps[i + 1];
      if (next === "[") {
        let j = i + 2;
        let params = "";
        while (j < cps.length && !/[@-~]/.test(cps[j])) params += cps[j++];
        if (cps[j] === "m") [bg, inverse] = sgr(params, bg, inverse);
        i = j;
      } else if (next === "]") {
        let j = i + 2;
        while (j < cps.length && cps[j] !== "\x07" && !(cps[j] === "\x1b" && cps[j + 1] === "\\")) j++;
        i = cps[j] === "\x07" ? j : j + 1;
      } else i++;
      continue;
    }
    if (c === "\r") continue;
    if (c === "\n") {
      out.push({ chars: [], marked: [] });
      continue;
    }
    const line = out[out.length - 1];
    line.chars.push(c);
    line.marked.push(bg || inverse);
  }
  return out;
}

/** Follows SGR parameters far enough to know whether a background (or inverse) is on. */
function sgr(params: string, bg: boolean, inverse: boolean): [boolean, boolean] {
  const p = params === "" ? [0] : params.split(/[;:]/).map((n) => (n === "" ? 0 : Number(n)));
  for (let i = 0; i < p.length; i++) {
    const n = p[i];
    if (n === 0) [bg, inverse] = [false, false];
    else if (n === 7) inverse = true;
    else if (n === 27) inverse = false;
    else if ((n >= 40 && n <= 47) || (n >= 100 && n <= 107)) bg = true;
    else if (n === 49) bg = false;
    else if (n === 48 || n === 38) {
      if (n === 48) bg = true;
      i += p[i + 1] === 5 ? 2 : p[i + 1] === 2 ? 4 : 1;
    }
  }
  return [bg, inverse];
}

function lines(screen: string): Line[] {
  return decode(screen).map(({ chars, marked }) => {
    let a = 0;
    let b = chars.length;
    while (b > a && /\s/.test(chars[b - 1])) b--;
    // A box's side walls: "│ text │".
    let s = a;
    while (s < b && chars[s] === " ") s++;
    if (s < b && "│┃|".includes(chars[s]) && b - 1 > s && chars[b - 1] === chars[s]) {
      a = s + 1;
      b--;
      while (b > a && /\s/.test(chars[b - 1])) b--;
    }
    const kept = chars.slice(a, b);
    const raw = kept.join("");
    const trimmed = raw.trimStart();
    const indent = raw.length - trimmed.length;
    const rule = trimmed !== "" && (RULE_ONLY.test(trimmed) || BOX_EDGE.test(trimmed));
    return { text: trimmed, indent, rule, marked: marked.slice(a + indent, b) };
  });
}

interface Found {
  line: number;
  marker: string | undefined;
  number: string;
  label: string;
}

/** The live run of numbered options: the last one numbered 1, and those counting up from it. */
function numbered(ls: Line[]): Found[] {
  const found: Found[] = [];
  ls.forEach((l, i) => {
    const m = OPTION.exec(l.text);
    if (m) found.push({ line: i, marker: m[1], number: m[2], label: m[3].trim() });
  });
  let start = -1;
  for (let i = found.length - 1; i >= 0; i--) {
    if (found[i].number === "1") {
      start = i;
      break;
    }
  }
  const live: Found[] = [];
  if (start >= 0) {
    for (const f of found.slice(start)) {
      if (f.number !== String(live.length + 1)) break;
      live.push(f);
    }
  }
  return live;
}

const isCursor = (marker: string | undefined) => marker !== undefined && CURSOR.includes(marker);

/** Up to `max` lines of text above `end`, rules and blanks left out. */
function above(ls: Line[], end: number, max: number): string[] {
  return ls
    .slice(0, end)
    .filter((l) => !l.rule && l.text !== "")
    .map((l) => l.text)
    .slice(-max);
}

export function parseApproval(screen: string): ApprovalPrompt {
  const ls = lines(screen);
  const live = numbered(ls);
  if (live.length >= 2) {
    const form = parseForm(ls, live);
    if (form) return form;
    return parseNumbered(ls, live);
  }
  return parseArrows(ls) ?? fallback(ls);
}

function fallback(ls: Line[]): ApprovalPrompt {
  return {
    kind: "unknown",
    question: above(ls, ls.length, 6),
    options: [
      { keys: ["enter"], label: "Approve (Enter)", number: null },
      { keys: ["esc"], label: "Reject (Esc)", number: null },
    ],
    cursor: -1,
    parsed: false,
  };
}

const lineWidth = (l: Line) => l.indent + Array.from(l.text).length;

/**
 * The text of a line and the lines it wraps onto. Wrapping goes between words: a word that fits
 * on a line moves whole to the next one. Only a word too long for any line (a path, a URL) is cut
 * where the line ends. So when a line fills the screen and its last word with the next line's
 * first would be too long to fit on a line, that is one word cut in two, and it goes on without
 * a space.
 */
function unwrap(ls: Line[], first: number, text: string, more: number[]): string {
  const width = Math.max(...ls.map(lineWidth));
  const len = (s: string) => Array.from(s).length;
  let out = text;
  let prev = ls[first];
  for (const i of more) {
    const l = ls[i];
    const tail = /\S+$/u.exec(prev.text)?.[0] ?? "";
    const head = /^\S+/u.exec(l.text)?.[0] ?? "";
    const cut = lineWidth(prev) >= width && len(tail) + len(head) > width - l.indent;
    out += (cut ? "" : " ") + l.text;
    prev = l;
  }
  return out;
}

/** Numbered choices. A label that wraps goes on, indented, on the lines under it. */
function parseNumbered(ls: Line[], live: Found[]): ApprovalPrompt {
  const options: ApprovalOption[] = [];
  let cursor = -1;
  live.forEach((f, k) => {
    const labelAt = ls[f.line].indent + ls[f.line].text.indexOf(f.label);
    const more: number[] = [];
    const stop = k + 1 < live.length ? live[k + 1].line : ls.length;
    for (let i = f.line + 1; i < stop; i++) {
      const l = ls[i];
      if (l.text === "" || l.rule || l.indent < labelAt) break;
      more.push(i);
    }
    if (isCursor(f.marker)) cursor = k;
    options.push({ keys: [f.number], label: unwrap(ls, f.line, f.label, more), number: f.number });
  });
  return { kind: "numbered", question: above(ls, live[0].line, 5), options, cursor, parsed: true };
}

/** The tab bar's chips, "←  ☒ Colour  ☐ Toppings  ✔ Submit  →", and which one is highlighted. */
function tabBar(l: Line): { tabs: FormTab[]; tab: number } | null {
  if (!TAB_BAR.test(l.text)) return null;
  const tabs: FormTab[] = [];
  const marks: boolean[] = [];
  const chars = Array.from(l.text);
  let i = chars[0] === "←" ? 1 : 0;
  while (i < chars.length) {
    while (i < chars.length && chars[i] === " ") i++;
    if (i >= chars.length) break;
    if (chars[i] === "→" && chars.slice(i + 1).every((c) => c === " ")) break;
    const box = chars[i];
    if (!"☐☒✔".includes(box)) return null;
    let j = i + 1;
    while (j < chars.length && !("☐☒✔".includes(chars[j]) && chars[j - 1] === " ") && !(chars[j] === "→" && j === chars.length - 1)) j++;
    const label = chars.slice(i + 1, j).join("").trim();
    if (label === "") return null;
    tabs.push({ label, answered: box === "☒", submit: box === "✔" });
    marks.push(l.marked[i] === true);
    i = j;
  }
  if (tabs.length === 0) return null;
  const lit = marks.filter(Boolean).length;
  return { tabs, tab: lit === 1 ? marks.indexOf(true) : -1 };
}

/** Claude Code's question form, or its review, when the screen holds one. */
function parseForm(ls: Line[], live: Found[]): ApprovalPrompt | null {
  const first = live[0].line;
  let barAt = -1;
  for (let i = first - 1; i >= Math.max(0, first - 12); i--) {
    if (tabBar(ls[i])) {
      barAt = i;
      break;
    }
  }
  if (barAt < 0) return null;
  const bar = tabBar(ls[barAt])!;
  const between = ls.slice(barAt + 1, first);

  if (between.some((l) => l.text === "Review your answers")) {
    const answers: { question: string; answer: string }[] = [];
    let text: string[] = [];
    for (const l of between) {
      const last = answers[answers.length - 1];
      if (l.text.startsWith("● ")) answers.push({ question: l.text.slice(2).trim(), answer: "" });
      else if (l.text.startsWith("→ ") && last) last.answer = l.text.slice(2).trim();
      else if (last && l.text !== "" && l.indent > 1) {
        // A question or answer too long for one line goes on under it.
        if (last.answer === "") last.question += ` ${l.text}`;
        else last.answer += ` ${l.text}`;
      } else if (l.text !== "" && l.text !== "Review your answers") text.push(l.text);
    }
    text = text.slice(-2);
    const options = live.map((f) => ({ keys: [f.number], label: f.label, number: f.number }));
    const cursor = live.findIndex((f) => isCursor(f.marker));
    return { kind: "review", question: text, options, cursor, parsed: true, tabs: bar.tabs, tab: bar.tab, answers };
  }

  // A question: the footer says how to answer it, which tells a form from a list that happens to
  // sit under a line of boxes (a to-do list).
  const footer = ls.slice(live[live.length - 1].line).some((l) => l.text.startsWith("Enter to select"));
  if (!footer) return null;
  const question = between.filter((l) => l.text !== "" && !l.rule).map((l) => l.text);
  const options: ApprovalOption[] = [];
  let cursor = -1;
  let multi = false;
  let extra = false;
  const end = live[live.length - 1].line;
  let k = 0;
  for (let i = first; i < ls.length; i++) {
    const l = ls[i];
    if (l.text.startsWith("Enter to select")) break;
    if (l.rule) {
      extra = true;
      continue;
    }
    if (l.text === "") {
      if (i > end) break;
      continue;
    }
    const f = k < live.length && live[k].line === i ? live[k] : undefined;
    if (f) {
      k++;
      let label = f.label;
      let checked: boolean | undefined;
      const box = /^\[(.)\]\s+(.*)$/u.exec(label);
      if (box) {
        multi = true;
        checked = box[1] !== " ";
        label = box[2];
      } else if (label.endsWith(" ✔")) {
        checked = true;
        label = label.slice(0, -2).trimEnd();
      }
      if (isCursor(f.marker)) cursor = options.length;
      options.push({ keys: [f.number], label, number: f.number, ...(checked !== undefined ? { checked } : {}), ...(extra ? { extra: true } : {}) });
      continue;
    }
    const sub = /^([❯›>▶])?\s*Submit$/u.exec(l.text);
    if (sub && !extra) {
      if (sub[1]) cursor = options.length;
      options.push({ keys: [], label: "Submit", number: null, submit: true });
      continue;
    }
    const last = options[options.length - 1];
    if (last && !last.submit) last.detail = last.detail ? `${last.detail} ${l.text}` : l.text;
  }
  // The row that takes typed text is the last numbered one above Submit and the rule. Its digit
  // moves the cursor there (or ticks it), and what goes in it is typed, so it has no keys of its own.
  const main = options.filter((o) => !o.extra && !o.submit);
  const typed = main[main.length - 1];
  if (typed && main.length >= 2) {
    typed.typed = true;
    typed.keys = [];
  }
  return { kind: "form", question, options, cursor, parsed: true, tabs: bar.tabs, tab: bar.tab, multi };
}

/** A radio or tick-box before an arrow list's label: ticked or not, and whether it is a tick-box. */
const MARK: Record<string, { checked: boolean; toggle: boolean }> = {
  "○": { checked: false, toggle: false },
  "◯": { checked: false, toggle: false },
  "\uf10c": { checked: false, toggle: false },
  "◉": { checked: true, toggle: false },
  "●": { checked: true, toggle: false },
  "\uf192": { checked: true, toggle: false },
  "☐": { checked: false, toggle: true },
  "\uf096": { checked: false, toggle: true },
  "☒": { checked: true, toggle: true },
  "☑": { checked: true, toggle: true },
  "\uf046": { checked: true, toggle: true },
  "\uf14a": { checked: true, toggle: true },
};

/** An arrow list's row: its label, and its radio or tick-box when it has one. */
function row(text: string): ApprovalOption {
  const m = /^(\S)\s+(.*)$/u.exec(text);
  const mark = m ? MARK[m[1]] : undefined;
  if (m && mark) return { keys: [], label: m[2].replace(/\s+/g, " "), number: null, checked: mark.checked, ...(mark.toggle ? { toggle: true } : {}) };
  return { keys: [], label: (/^[•◦]\s+/u.test(text) ? text.replace(/^[•◦]\s+/u, "") : text).replace(/\s+/g, " "), number: null };
}

/**
 * A list with a ❯ on one line and no digits; the hint under it says Enter (or a pick) answers.
 * Inside a box with no rule between its top and the cursor (omp's ask), the box can hold several
 * questions: each one's line, then its choices, and a Submit row at the end. The cursor moves
 * through all of them in order.
 */
function parseArrows(ls: Line[]): ApprovalPrompt | null {
  let at = -1;
  for (let i = ls.length - 1; i >= 0; i--) {
    if (CURSOR.includes(Array.from(ls[i].text)[0] ?? "") && /^.\s+\S/u.test(ls[i].text)) {
      at = i;
      break;
    }
  }
  if (at < 0) return null;
  const marked = ls[at];
  const body = marked.text.replace(/^.\s+/u, "");
  const col = marked.indent + (Array.from(marked.text).length - Array.from(body).length);
  const sibling = (l: Line) => !l.rule && l.text !== "" && l.indent === col;
  const nested = (l: Line) => !l.rule && l.text !== "" && l.indent > col;

  let ruleAbove = at - 1;
  while (ruleAbove >= 0 && !ls[ruleAbove].rule) ruleAbove--;
  const boxed = ruleAbove >= 0 && ls[ruleAbove].text.startsWith("╭");
  let top = at;
  let bottom = at;
  const headers: string[] = [];
  if (boxed) {
    top = ruleAbove + 1;
    while (bottom + 1 < ls.length && !ls[bottom + 1].rule) bottom++;
  } else {
    while (top > 0 && (sibling(ls[top - 1]) || nested(ls[top - 1]))) top--;
    while (top < at && !sibling(ls[top])) top++;
    while (bottom + 1 < ls.length && (sibling(ls[bottom + 1]) || nested(ls[bottom + 1]))) bottom++;
  }

  const options: ApprovalOption[] = [];
  let cursor = -1;
  for (let i = top; i <= bottom; i++) {
    const l = ls[i];
    if (l.text === "") continue;
    if (i === at || sibling(l)) {
      if (i === at) cursor = options.length;
      const text = i === at ? body : l.text;
      options.push(boxed && text === "Submit" ? { keys: [], label: "Submit", number: null, submit: true } : row(text));
    } else if (nested(l) && options.length > 0) {
      const o = options[options.length - 1];
      o.detail = o.detail ? `${o.detail} ${l.text}` : l.text;
    } else if (boxed && l.indent < col) headers.push(l.text);
  }
  if (options.length < 2) return null;
  const after = ls.slice(bottom + 1).filter((l) => !l.rule && l.text !== "");
  if (after.length > 4 || !after.some((l) => /enter|⏎|select|confirm|choose|submit|toggle/i.test(l.text))) return null;
  if (after.some((l) => /\besc\b|⎋|\bcancel\b/i.test(l.text))) options.push({ keys: ["esc"], label: "Cancel (Esc)", number: null });
  const stays = options.some((o) => o.submit);
  const question = boxed && headers.length > 0 ? headers.slice(-4) : above(ls, top, 5);
  return {
    kind: "arrows",
    question,
    options,
    cursor,
    parsed: true,
    ...(stays ? { stays: true } : {}),
    ...(options.some((o) => o.toggle) ? { multi: true } : {}),
  };
}

/**
 * Whether two reads show the same dialog: the same question, choices, ticks and tab. Where the
 * cursor sits doesn't count. A key is sent only while the dialog still reads as it did when
 * shown, since a digit answers whatever dialog is there now.
 */
export function samePrompt(a: ApprovalPrompt, b: ApprovalPrompt): boolean {
  const text = (p: ApprovalPrompt) =>
    JSON.stringify([
      p.kind,
      p.parsed,
      p.question,
      p.options.map((o) => [o.keys, o.label, o.detail ?? null, o.checked ?? null, o.typed ?? false, o.submit ?? false, o.extra ?? false, o.toggle ?? false]),
      p.tabs ?? null,
      p.tab ?? null,
      p.multi ?? null,
      p.stays ?? null,
      p.answers ?? null,
    ]);
  return text(a) === text(b);
}

/** Whether a typed row still shows its placeholder rather than an answer. */
export function isPlaceholder(option: ApprovalOption): boolean {
  return PLACEHOLDER.test(option.label);
}

/** Heuristic: options that say no/reject/deny get the danger style. */
export function isNegative(option: ApprovalOption): boolean {
  const l = option.label.toLowerCase();
  return l.startsWith("no") || l.includes("reject") || l.includes("deny") || l.includes("cancel") || l.includes("esc");
}
