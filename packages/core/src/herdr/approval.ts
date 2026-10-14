/**
 * Reads an agent's approval dialog off its screen. Agents draw these differently, but nearly all
 * list numbered choices ("1. Yes", "2. Yes, and don't ask again", "3. No..."), and pressing the
 * digit picks it. When no numbered list is found we fall back to Enter / Esc.
 */
export interface ApprovalOption {
  keys: string[];
  label: string;
  number: string | null;
}

export interface ApprovalPrompt {
  question: string[];
  options: ApprovalOption[];
  parsed: boolean;
}

const OPTION_LINE = /^\s*(?:[❯›>▶●*]\s*)?(\d)[.)]\s+(.+?)\s*$/u;
const FRAME = /^[\s│┃|╭╮╰╯─━]+|[\s│┃|╭╮╰╯─━]+$/gu;

export function parseApproval(screen: string): ApprovalPrompt {
  const lines = screen.split(/\r?\n/).map((l) => l.replace(FRAME, ""));
  const candidates: [number, ApprovalOption][] = [];
  lines.forEach((line, i) => {
    const m = OPTION_LINE.exec(line);
    if (m) candidates.push([i, { keys: [m[1]], label: m[2], number: m[1] }]);
  });
  // The live dialog is the last run that starts at 1 and counts up; earlier numbered output is ignored.
  let start = -1;
  for (let i = candidates.length - 1; i >= 0; i--) {
    if (candidates[i][1].number === "1") {
      start = i;
      break;
    }
  }
  const live: [number, ApprovalOption][] = [];
  if (start >= 0) {
    for (const c of candidates.slice(start)) {
      if (c[1].number !== String(live.length + 1)) break;
      live.push(c);
    }
  }
  if (live.length >= 2) {
    const question = lines.slice(0, live[0][0]).map((l) => l.trim()).filter((l) => l !== "").slice(-5);
    return { question, options: live.map((c) => c[1]), parsed: true };
  }
  return {
    question: lines.map((l) => l.trim()).filter((l) => l !== "").slice(-6),
    options: [
      { keys: ["enter"], label: "Approve (Enter)", number: null },
      { keys: ["esc"], label: "Reject (Esc)", number: null },
    ],
    parsed: false,
  };
}

/** Heuristic: options that say no/reject/deny get the danger style. */
export function isNegative(option: ApprovalOption): boolean {
  const l = option.label.toLowerCase();
  return l.startsWith("no") || l.includes("reject") || l.includes("deny") || l.includes("cancel") || l.includes("esc");
}
