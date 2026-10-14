/**
 * Soft keyboards only report text changes, so terminal input goes through a hidden text field that
 * is reset to a run of zero-width sentinels between edits (the run gives a burst of backspaces
 * something to delete). Resets travel to the native field asynchronously and are dropped if the
 * user typed in the meantime, so each change is diffed against what the field really held. The
 * sentinel alternates between two characters, which tells a change made after a reset from one
 * made before.
 */
export const KEY_FIELD_SENTINELS = ["​".repeat(8), "‌".repeat(8)] as const;

const SENTINEL_CHARS = /[​‌]/g;

export interface KeyFieldEdit {
  /** Characters to erase (one backspace each), before `text`. */
  deletes: number;
  text: string;
}

/** The edit turning `prior` into `next`: code points removed from the end of prior, then text appended. */
export function keyFieldEdit(prior: string, next: string): KeyFieldEdit {
  const same = sharedPrefix(prior, next);
  let deletes = 0;
  for (const _ of prior.slice(same)) deletes++;
  return { deletes, text: next.slice(same).replace(SENTINEL_CHARS, "") };
}

/** Follows a hidden key field across resets; see {@link KEY_FIELD_SENTINELS}. */
export class KeyField {
  /** The text the field should be reset to. */
  target: string = KEY_FIELD_SENTINELS[0];
  /** The text the field last reported. */
  private last: string = KEY_FIELD_SENTINELS[0];

  /** Takes the field's new text and returns the input it stands for. Afterwards, reset the field to `target`. */
  change(next: string): KeyFieldEdit {
    // Fields can report the same text twice; resets never restore it, as they switch sentinels.
    if (next === this.last) return { deletes: 0, text: "" };
    // A reset may have landed since the last change; whichever start explains the change more
    // simply is the one the field had.
    let prior = this.last;
    if (this.last !== this.target && cost(this.target, next) < cost(this.last, next)) prior = this.target;
    this.last = next;
    // Once the field holds an edit of the current sentinels, the next reset needs the other ones.
    if (next !== this.target && next.charAt(0) === this.target.charAt(0)) {
      this.target = this.target === KEY_FIELD_SENTINELS[0] ? KEY_FIELD_SENTINELS[1] : KEY_FIELD_SENTINELS[0];
    }
    return keyFieldEdit(prior, next);
  }
}

function sharedPrefix(a: string, b: string): number {
  let n = 0;
  const max = Math.min(a.length, b.length);
  while (n < max && a.charCodeAt(n) === b.charCodeAt(n)) n++;
  // Never split a surrogate pair.
  if (n > 0 && n < a.length && isHighSurrogate(a.charCodeAt(n - 1))) n--;
  return n;
}

/** Code units removed plus added, sentinels included, to get from one text to the other. */
function cost(prior: string, next: string): number {
  const same = sharedPrefix(prior, next);
  return prior.length - same + next.length - same;
}

const isHighSurrogate = (c: number) => c >= 0xd800 && c <= 0xdbff;
