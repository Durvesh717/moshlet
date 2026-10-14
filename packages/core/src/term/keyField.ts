/**
 * Soft keyboards only report text changes, so terminal input goes through a hidden text field that
 * is reset to a single zero-width sentinel between edits (the sentinel gives backspace something to
 * delete). Resets travel to the native field asynchronously and are dropped if the user typed in
 * the meantime, so each change is diffed against what the field really held. The sentinel
 * alternates between two characters, which tells a change made after a reset from one made before.
 */
export const KEY_FIELD_SENTINELS = ["\u200b", "\u200c"] as const;

export interface KeyFieldEdit {
  /** Characters to erase (one backspace each), before `text`. */
  deletes: number;
  text: string;
}

/** The edit turning `prior` into `next`: code points removed from the end of prior, then text appended. */
export function keyFieldEdit(prior: string, next: string): KeyFieldEdit {
  let same = 0;
  const max = Math.min(prior.length, next.length);
  while (same < max && prior.charCodeAt(same) === next.charCodeAt(same)) same++;
  // Never split a surrogate pair.
  if (same > 0 && isHighSurrogate(prior.charCodeAt(same - 1)) && same < prior.length) same--;
  let deletes = 0;
  for (const _ of prior.slice(same)) deletes++;
  let text = next.slice(same);
  for (const s of KEY_FIELD_SENTINELS) text = text.replaceAll(s, "");
  return { deletes, text };
}

/** Follows a hidden key field across resets; see {@link KEY_FIELD_SENTINELS}. */
export class KeyField {
  /** The text the field should be reset to. */
  target: string = KEY_FIELD_SENTINELS[0];
  /** The text the field last reported. */
  private last: string = KEY_FIELD_SENTINELS[0];

  /** Takes the field's new text and returns the input it stands for. Afterwards, reset the field to `target`. */
  change(next: string): KeyFieldEdit {
    let edit = keyFieldEdit(this.last, next);
    if (this.last !== this.target) {
      // A reset may have landed since the last change; whichever start explains the change more
      // simply is the one the field had. A change from the last text to itself means a reset landed.
      const fromReset = keyFieldEdit(this.target, next);
      if (cost(fromReset) < cost(edit) || next === this.last) edit = fromReset;
    }
    this.last = next;
    // Once the field holds the current sentinel plus an edit, the next reset needs the other one.
    if (next !== this.target && next.startsWith(this.target)) {
      this.target = this.target === KEY_FIELD_SENTINELS[0] ? KEY_FIELD_SENTINELS[1] : KEY_FIELD_SENTINELS[0];
    }
    return edit;
  }
}

const cost = (e: KeyFieldEdit) => e.deletes + e.text.length;
const isHighSurrogate = (c: number) => c >= 0xd800 && c <= 0xdbff;
