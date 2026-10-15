import { fixedRows, KeyField, rowsMoved, rowTexts, type Cell, type MoshClient, type Screen } from "@corral/core";
import { Canvas, Picture, Skia, useFonts, useTypeface, type SkPicture } from "@shopify/react-native-skia";
import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from "react";
import { AppState, Keyboard, PixelRatio, Platform, StyleSheet, TextInput, View, type LayoutChangeEvent } from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import { useSharedValue } from "react-native-reanimated";
import { TERMINAL_FONTS } from "../theme";
import { Renderer } from "./renderer";

export interface TerminalViewHandle {
  focus(): void;
  blur(): void;
  /** Scrolls the live pane back to the bottom (after live scrolling). */
  wheelToBottom(): void;
  cols(): number;
}

export interface TerminalViewProps {
  client: MoshClient | null;
  /** Changes when a different pane is shown: resets scrolling state. */
  paneKey: string | null;
  history: readonly (readonly Cell[])[];
  historyMode: boolean;
  fontSize: number;
  /** Rows a wheel notch moves the content: herdr's own history 3, Claude Code and similar apps 1. */
  rowsPerNotch: number;
  ctrl: boolean;
  alt: boolean;
  onModifiersUsed(): void;
  onInput(bytes: Uint8Array): void;
  onGrid(cols: number, rows: number): void;
  onSwipe(direction: 1 | -1): void;
  onLongPress(): void;
  onFontSize(size: number): void;
  /** History mode reached the live screen again. */
  onLeaveHistory(): void;
  /** Wheel notches the live pane is scrolled up by (0 = at the bottom). */
  onRemoteScroll(notches: number): void;
  onTouchStart(): void;
  onFocusChange(focused: boolean): void;
}

function emptyPicture(): SkPicture {
  const rec = Skia.PictureRecorder();
  rec.beginRecording(Skia.XYWHRect(0, 0, 1, 1));
  return rec.finishRecordingAsPicture();
}
const encoder = new TextEncoder();
/** Rows asked for that no frame has brought by then aren't coming, even without an echo ack to say so. */
const GIVE_UP_MS = 1000;
/** Rows kept from just beyond the moving band: a few notches' worth, enough for the edge a drag uncovers. */
const SPILL_ROWS = 12;

function newFollow() {
  return {
    pendingRows: 0,
    settlePx: 0,
    rows: [] as string[],
    last: null as Screen | null,
    spill: { above: [] as (readonly Cell[])[], below: [] as (readonly Cell[])[] },
    echoAt: 0,
    edge: 0,
    raf: 0,
    timer: null as ReturnType<typeof setTimeout> | null,
  };
}

export const TerminalView = forwardRef<TerminalViewHandle, TerminalViewProps>(function TerminalView(props, ref) {
  const p = useRef(props);
  p.current = props;

  // ---- fonts and renderer
  const regular = useTypeface(TERMINAL_FONTS["JetBrains Mono"][0]);
  const bold = useTypeface(TERMINAL_FONTS["JetBrains Mono"][1]);
  const symRegular = useTypeface(TERMINAL_FONTS["Adwaita Mono"][0]);
  const symBold = useTypeface(TERMINAL_FONTS["Adwaita Mono"][1]);
  const provider = useFonts(TERMINAL_FONTS);
  const renderer = useMemo(
    () => (regular && bold && symRegular && symBold ? new Renderer({ regular, bold, symRegular, symBold, provider }, props.fontSize, PixelRatio.get()) : null),
    // The font size is applied separately so pinching doesn't rebuild the renderer.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [regular, bold, symRegular, symBold, provider],
  );

  const picture = useSharedValue<SkPicture>(emptyPicture());
  const size = useRef({ width: 0, height: 0 });
  const grid = useRef({ cols: 0, rows: 0 });
  const screen = useRef<Screen | null>(null);
  const focused = useRef(false);
  const scrollPx = useRef(0);
  const frameQueued = useRef(false);
  const live = useRef({ notches: 0, accum: 0, col: 1, row: 1 });
  /**
   * A live pane scrolls on the computer, a round trip away, so here the content moves with the
   * finger first: rows asked for but not yet seen in a frame (`pendingRows`) and the drag not yet
   * sent as a notch both offset the drawing, and each frame that brings rows takes them back.
   * `rows` is the last frame's text, to tell how far the next one moved (`last` the frame itself);
   * `spill` the rows recent scrolls pushed out of view, which fill the edge a drag uncovers;
   * `echoAt` the input count that, once the server echoes it, means every notch so far has been
   * acted on; `edge` the direction the pane stopped moving in, where nothing more is predicted
   * until the next touch.
   */
  const follow = useRef(newFollow());
  /** Rows the pane's app keeps in place while it scrolls (its header, input box), as last seen: they don't move with the finger. */
  const pinned = useRef({ top: 0, bottom: 0 });

  /** The drag not yet sent as a notch, as far as the pane can go that way. */
  const shownDrag = (): number => {
    const a = live.current.accum;
    const f = follow.current;
    if (a < 0 && live.current.notches === 0 && f.pendingRows <= 0) return 0; // at the bottom
    if (f.edge !== 0 && Math.sign(a) === f.edge) return 0; // at the top of the history
    return a;
  };

  /** How far below its last frame the live screen is drawn (negative: above). */
  const liveOffset = (): number => {
    const s = screen.current;
    if (!renderer || !s || s.mouseMode === 0) return 0;
    const f = follow.current;
    const cap = size.current.height / 2;
    return Math.min(Math.max(shownDrag() + f.pendingRows * renderer.cellH + f.settlePx, -cap), cap);
  };

  const redrawNow = useCallback(() => {
    frameQueued.current = false;
    const s = screen.current;
    const { width, height } = size.current;
    if (!renderer || !s || width === 0) return;
    picture.value = renderer.render({
      screen: s,
      history: p.current.historyMode ? p.current.history : [],
      scrollPx: p.current.historyMode ? scrollPx.current : liveOffset(),
      pinTop: p.current.historyMode ? 0 : pinned.current.top,
      pinBottom: p.current.historyMode ? 0 : pinned.current.bottom,
      spillAbove: p.current.historyMode ? [] : follow.current.spill.above,
      spillBelow: p.current.historyMode ? [] : follow.current.spill.below,
      width,
      height,
      focused: focused.current,
    });
    // liveOffset reads only refs and the renderer.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [renderer, picture]);

  const redraw = useCallback(() => {
    if (frameQueued.current) return;
    frameQueued.current = true;
    requestAnimationFrame(redrawNow);
  }, [redrawNow]);

  const updateGrid = useCallback(() => {
    if (!renderer) return;
    const g = renderer.grid(size.current.width, size.current.height);
    if (g.cols !== grid.current.cols || g.rows !== grid.current.rows) {
      grid.current = g;
      pinned.current = { top: 0, bottom: 0 };
      p.current.onGrid(g.cols, g.rows);
    }
  }, [renderer]);

  useEffect(() => {
    if (!renderer) return;
    if (renderer.fontSize !== props.fontSize) renderer.setFontSize(props.fontSize);
    updateGrid();
    redraw();
  }, [renderer, props.fontSize, updateGrid, redraw]);

  // ---- scrolling: live (wheel events to the pane) and local (History mode)
  const fling = useRef<{ raf: number; local: boolean } | null>(null);

  const setScroll = useCallback(
    (px: number) => {
      const max = p.current.history.length * (renderer?.cellH ?? 1);
      const next = Math.min(Math.max(px, 0), max);
      const wasBack = scrollPx.current > 0;
      scrollPx.current = next;
      if (wasBack && next === 0) p.current.onLeaveHistory();
      redraw();
    },
    [renderer, redraw],
  );

  const setNotches = (n: number) => {
    if (n === live.current.notches) return;
    live.current.notches = n;
    p.current.onRemoteScroll(n);
  };

  const sendWheel = useCallback((up: boolean): boolean => {
    const s = screen.current;
    if (!s || s.mouseMode === 0) return false;
    if (!up && live.current.notches === 0 && fling.current) return false;
    setNotches(up ? live.current.notches + 1 : Math.max(0, live.current.notches - 1));
    const button = up ? 64 : 65;
    const { col, row } = live.current;
    const seq = s.mouseEncoding === 1006 ? `\x1b[<${button};${col};${row}M` : `\x1b[M${String.fromCharCode(32 + button, 32 + col, 32 + row)}`;
    p.current.onInput(encoder.encode(seq));
    return true;
  }, []);

  /** Eases settlePx (a correction to the predicted position) away. */
  const settle = useCallback(() => {
    const f = follow.current;
    if (f.raf) return;
    let last = performance.now();
    const step = () => {
      const now = performance.now();
      f.settlePx *= Math.exp(-(now - last) / 70);
      last = now;
      if (Math.abs(f.settlePx) < 0.5) f.settlePx = 0;
      f.raf = f.settlePx === 0 ? 0 : requestAnimationFrame(step);
      redraw();
    };
    f.raf = requestAnimationFrame(step);
  }, [redraw]);

  /** Rows asked for aren't coming (the pane is at the top of its history): ease them back. */
  const giveUp = useCallback(() => {
    const f = follow.current;
    if (f.timer) clearTimeout(f.timer);
    f.timer = null;
    if (f.pendingRows === 0) return;
    f.edge = Math.sign(f.pendingRows);
    f.settlePx += f.pendingRows * (renderer?.cellH ?? 1);
    f.pendingRows = 0;
    settle();
  }, [renderer, settle]);

  const awaitRows = useCallback(() => {
    const f = follow.current;
    if (f.timer) clearTimeout(f.timer);
    f.timer = setTimeout(giveUp, GIVE_UP_MS);
  }, [giveUp]);

  /** Whether a notch that way can be drawn ahead: not past the bottom, nor past where the pane last stopped. */
  const predictable = (up: boolean): boolean => {
    const s = screen.current;
    if (!s || s.mouseMode === 0) return false;
    if (!up && live.current.notches === 0) return false;
    return follow.current.edge !== (up ? 1 : -1);
  };

  /** Sends a wheel notch whose rows are drawn ahead (check `predictable` first). */
  const notch = useCallback(
    (up: boolean) => {
      if (!sendWheel(up)) return;
      const f = follow.current;
      f.edge = 0;
      if (f.pendingRows === 0) {
        f.rows = rowTexts(screen.current!);
        f.last = screen.current;
        awaitRows();
      }
      f.pendingRows += (up ? 1 : -1) * p.current.rowsPerNotch;
      f.echoAt = p.current.client?.inputEvents ?? 0;
    },
    [sendWheel, awaitRows],
  );

  /** A frame came in: rows it moved by were drawn ahead already, so take them back. */
  const followFrame = useCallback(
    (s: Screen) => {
      const f = follow.current;
      if (f.pendingRows === 0) return;
      const next = rowTexts(s);
      const n = p.current.rowsPerNotch;
      const prev = f.rows;
      const before = f.last;
      const k = rowsMoved(prev, next, Math.min(0, f.pendingRows) - n, Math.max(0, f.pendingRows) + n, f.pendingRows);
      f.rows = next;
      f.last = s;
      if (k !== 0) {
        const pins = fixedRows(prev, next, k);
        pinned.current = pins;
        // Keep the rows this pushed out of the moving band: a drag uncovering that edge shows them.
        if (before && before.rows === s.rows) {
          const lo = pins.top;
          const hi = s.rows - pins.bottom;
          f.spill =
            k > 0
              ? { above: [], below: [...before.lines.slice(Math.max(lo, hi - k), hi), ...f.spill.below].slice(0, SPILL_ROWS) }
              : { above: [...f.spill.above, ...before.lines.slice(lo, Math.min(hi, lo - k))].slice(-SPILL_ROWS), below: [] };
        }
        // Further than asked means other output moved it too: that part is real, not ours to undo.
        const left = f.pendingRows - k;
        f.pendingRows = Math.sign(left) === Math.sign(f.pendingRows) ? left : 0;
      }
      // The server has acted on every notch and this is the screen after: what didn't come won't.
      if (f.pendingRows !== 0 && (p.current.client?.echoedInputs ?? 0) >= f.echoAt) giveUp();
      else if (f.pendingRows !== 0) {
        if (k !== 0) awaitRows();
      } else if (f.timer) {
        clearTimeout(f.timer);
        f.timer = null;
      }
    },
    [awaitRows, giveUp],
  );

  /** Typing, another pane or History mode: the screen goes wherever the computer puts it. */
  const resetFollow = useCallback(() => {
    const f = follow.current;
    if (f.timer) clearTimeout(f.timer);
    if (f.raf) cancelAnimationFrame(f.raf);
    follow.current = newFollow();
    live.current.accum = 0;
  }, []);

  /**
   * Turns finger travel into wheel notches, rowsPerNotch rows each; the drawing follows the finger
   * in between. Each notch goes out as soon as the finger starts on its rows rather than once it
   * has crossed them, so they are usually there by the time it gets there.
   */
  const wheel = useCallback(
    (dy: number) => {
      const step = (renderer?.cellH ?? 20) * p.current.rowsPerNotch;
      const l = live.current;
      l.accum += dy;
      if (dy > 0) {
        while (l.accum > 0 && predictable(true)) {
          notch(true);
          l.accum -= step;
        }
      } else if (dy < 0) {
        while (l.accum < 0 && predictable(false)) {
          notch(false);
          l.accum += step;
        }
      }
      // Where nothing is predicted (an edge, or no mouse), a notch per step of travel, as a plain wheel would.
      while (l.accum >= step) {
        sendWheel(true);
        l.accum -= step;
      }
      while (l.accum <= -step) {
        sendWheel(false);
        l.accum += step;
      }
      redraw();
    },
    // predictable reads only refs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [renderer, notch, sendWheel, redraw],
  );

  /** A drag or fling that stops between notches finishes on the nearer one, easing the difference. */
  const landDrag = useCallback(() => {
    const l = live.current;
    const f = follow.current;
    const s = screen.current;
    let shown = shownDrag();
    l.accum = 0;
    if (!renderer || !s || s.mouseMode === 0 || shown === 0) return;
    const step = renderer.cellH * p.current.rowsPerNotch;
    if (Math.abs(shown) >= step / 2 && predictable(shown > 0)) {
      notch(shown > 0);
      shown -= Math.sign(shown) * step;
    }
    f.settlePx += shown;
    settle();
    // predictable and shownDrag read only refs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [renderer, notch, settle]);

  // ---- frames straight from the mosh client (no React state per frame)
  useEffect(() => {
    const c = props.client;
    if (!c) return;
    screen.current = c.screen;
    redraw();
    return c.onScreen((s) => {
      screen.current = s;
      followFrame(s);
      redraw();
    });
  }, [props.client, redraw, followFrame]);

  useEffect(() => resetFollow, [resetFollow]);

  const stopFling = () => {
    if (fling.current) cancelAnimationFrame(fling.current.raf);
    fling.current = null;
  };

  const startFling = (velocity: number, local: boolean) => {
    stopFling();
    let v = velocity;
    let last = performance.now();
    const step = () => {
      const now = performance.now();
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      v *= Math.exp(-dt / 0.35);
      if (Math.abs(v) < 60) {
        fling.current = null;
        if (!local) landDrag();
        return;
      }
      if (local) setScroll(scrollPx.current + v * dt);
      else wheel(v * dt);
      if (fling.current) fling.current.raf = requestAnimationFrame(step);
    };
    fling.current = { raf: requestAnimationFrame(step), local };
  };

  useEffect(() => {
    // A new pane starts at its bottom, with no scroll of ours to undo.
    stopFling();
    resetFollow();
    live.current = { notches: 0, accum: 0, col: 1, row: 1 };
    p.current.onRemoteScroll(0);
    scrollPx.current = 0;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.paneKey]);

  // Another pane, or the app in it starting or quitting (herdr's own history scrolls every row).
  useEffect(() => {
    pinned.current = { top: 0, bottom: 0 };
    follow.current.spill = { above: [], below: [] };
  }, [props.paneKey, props.rowsPerNotch]);

  useEffect(() => {
    // Entering History mode shows the screen above; leaving it returns to live.
    if (!renderer) return;
    resetFollow();
    scrollPx.current = props.historyMode ? Math.min(props.history.length, grid.current.rows) * renderer.cellH : 0;
    redraw();
  }, [props.historyMode, props.history, renderer, redraw, resetFollow]);

  // ---- gestures
  const axis = useRef<"none" | "v" | "h">("none");
  const lastY = useRef(0);
  const pinchStart = useRef(props.fontSize);
  // Declared before the gestures: their callbacks capture these when they are built.
  const input = useRef<TextInput>(null);
  const showKeyboard = () => {
    const field = input.current;
    if (!field) return;
    // Android keeps the field focused when Back hides the keyboard, and focusing a focused field
    // does nothing, so take focus away first to bring the keyboard back.
    if (field.isFocused() && !Keyboard.isVisible()) field.blur();
    field.focus();
  };

  const gesture = useMemo(() => {
    const pan = Gesture.Pan()
      .runOnJS(true)
      .minDistance(6)
      .onBegin((e) => {
        stopFling();
        axis.current = "none";
        lastY.current = 0;
        // A new touch tries again past where the pane last stopped.
        follow.current.edge = 0;
        const cw = renderer?.cellW ?? 8;
        const ch = renderer?.cellH ?? 16;
        live.current.col = Math.min(Math.max(Math.floor(e.x / cw), 0), Math.max(0, grid.current.cols - 1)) + 1;
        live.current.row = Math.min(Math.max(Math.floor(e.y / ch), 0), Math.max(0, grid.current.rows - 1)) + 1;
        p.current.onTouchStart();
      })
      .onUpdate((e) => {
        if (axis.current === "none") {
          // The first update can come before any movement; pick the axis once there is some.
          const ax = Math.abs(e.translationX);
          const ay = Math.abs(e.translationY);
          if (Math.max(ax, ay) < 6) return;
          axis.current = ay >= ax ? "v" : "h";
        }
        const dy = e.translationY - lastY.current;
        lastY.current = e.translationY;
        if (axis.current !== "v") return;
        // Content follows the finger: dragging down reveals older rows.
        if (p.current.historyMode) setScroll(scrollPx.current + dy);
        else wheel(dy);
      })
      .onEnd((e) => {
        if (axis.current === "v") {
          if (Math.abs(e.velocityY) > 200) startFling(e.velocityY, p.current.historyMode);
        } else if (axis.current === "h") {
          if (Math.abs(e.translationX) > size.current.width * 0.25 && Math.abs(e.velocityX) > 500) p.current.onSwipe(e.translationX < 0 ? 1 : -1);
        }
      })
      .onFinalize(() => {
        if (!fling.current && !p.current.historyMode) landDrag();
      });
    const tap = Gesture.Tap()
      .runOnJS(true)
      .onEnd(() => showKeyboard());
    const longPress = Gesture.LongPress()
      .runOnJS(true)
      .minDuration(450)
      .onStart(() => p.current.onLongPress());
    const pinch = Gesture.Pinch()
      .runOnJS(true)
      .onBegin(() => {
        pinchStart.current = p.current.fontSize;
      })
      .onUpdate((e) => {
        if (!renderer) return;
        const next = Math.min(22, Math.max(8, pinchStart.current * e.scale));
        renderer.setFontSize(next);
        redraw();
      })
      .onEnd(() => {
        if (!renderer) return;
        const committed = Math.round(renderer.fontSize * 2) / 2;
        renderer.setFontSize(committed);
        updateGrid();
        p.current.onFontSize(committed);
      });
    return Gesture.Simultaneous(pinch, Gesture.Exclusive(pan, longPress, tap));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [renderer, wheel, setScroll, redraw, updateGrid, landDrag]);

  // ---- keyboard: a hidden input reset to a sentinel between edits, so every edit is a delta
  const keyField = useRef<KeyField>(null);
  keyField.current ??= new KeyField();
  const [value, setValue] = useState(keyField.current.target);

  const send = useCallback(
    (text: string) => {
      if (text === "") return;
      let out = text;
      const { ctrl, alt } = p.current;
      if (ctrl || alt) {
        const first = String.fromCodePoint(out.codePointAt(0)!);
        let head = ctrl ? ctrlOf(first) : first;
        if (alt) head = "\x1b" + head;
        out = head + out.slice(first.length);
        p.current.onModifiersUsed();
      }
      // Typing returns to the live screen; herdr also snaps a scrolled pane to the bottom on input.
      stopFling();
      resetFollow();
      setNotches(0);
      if (p.current.historyMode) p.current.onLeaveHistory();
      p.current.onInput(encoder.encode(out));
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  const onChangeText = (next: string) => {
    const keys = keyField.current!;
    const { deletes, text } = keys.change(next);
    for (let i = 0; i < deletes; i++) p.current.onInput(Uint8Array.of(0x7f));
    send(text.replace(/\n/g, "\r"));
    // While a reset is still on its way the target is unchanged; TextInput resends it after every change.
    setValue(keys.target);
  };

  useImperativeHandle(ref, () => ({
    focus: showKeyboard,
    blur: () => input.current?.blur(),
    wheelToBottom: () => {
      stopFling();
      resetFollow();
      const n = live.current.notches + 2;
      for (let i = 0; i < n; i++) sendWheel(false);
      setNotches(0);
    },
    cols: () => grid.current.cols,
  }));

  // Android can leave Skia's surface without a GL context once the app has been in the background
  // (the screen locked), and every frame after that draws nothing. A fresh Canvas draws again.
  const [surface, setSurface] = useState(0);
  useEffect(() => {
    let away = false;
    const sub = AppState.addEventListener("change", (state) => {
      if (state === "background") away = true;
      else if (state === "active" && away) {
        away = false;
        setSurface((n) => n + 1);
      }
    });
    return () => sub.remove();
  }, []);

  const onLayout = (e: LayoutChangeEvent) => {
    size.current = { width: e.nativeEvent.layout.width, height: e.nativeEvent.layout.height };
    updateGrid();
    redraw();
  };

  return (
    <View style={styles.root} onLayout={onLayout}>
      <GestureDetector gesture={gesture}>
        <Canvas key={surface} style={StyleSheet.absoluteFill}>
          <Picture picture={picture} />
        </Canvas>
      </GestureDetector>
      <TextInput
        ref={input}
        value={value}
        onChangeText={onChangeText}
        onSubmitEditing={() => send("\r")}
        onFocus={() => {
          focused.current = true;
          props.onFocusChange(true);
          redraw();
        }}
        onBlur={() => {
          focused.current = false;
          props.onFocusChange(false);
          redraw();
        }}
        selection={{ start: value.length, end: value.length }}
        submitBehavior="submit"
        autoCorrect={false}
        autoCapitalize="none"
        autoComplete="off"
        spellCheck={false}
        importantForAutofill="no"
        keyboardType={Platform.OS === "android" ? "visible-password" : "ascii-capable"}
        caretHidden
        contextMenuHidden
        style={styles.hiddenInput}
      />
    </View>
  );
});

export function ctrlOf(s: string): string {
  if (s.length !== 1) return s;
  const c = s.charCodeAt(0);
  if (c >= 0x61 && c <= 0x7a) return String.fromCharCode(c - 0x60);
  if (c >= 0x41 && c <= 0x5a) return String.fromCharCode(c - 0x40);
  switch (s) {
    case " ": case "2": case "@": return "\x00";
    case "[": case "3": return "\x1b";
    case "\\": case "4": return "\x1c";
    case "]": case "5": return "\x1d";
    case "^": case "6": return "\x1e";
    case "_": case "7": case "/": return "\x1f";
    case "8": case "?": return "\x7f";
    default: return s;
  }
}

const styles = StyleSheet.create({
  root: { flex: 1, overflow: "hidden" },
  hiddenInput: { position: "absolute", left: -1000, top: 0, width: 10, height: 10, opacity: 0 },
});
