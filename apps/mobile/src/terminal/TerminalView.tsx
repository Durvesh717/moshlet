import { KeyField, type Cell, type MoshClient, type Screen } from "@corral/core";
import { Canvas, Picture, Skia, useFonts, useTypeface, type SkPicture } from "@shopify/react-native-skia";
import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from "react";
import { AppState, Keyboard, PixelRatio, Platform, StyleSheet, TextInput, View, type LayoutChangeEvent } from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import { useSharedValue } from "react-native-reanimated";
import { useCSSVariable } from "uniwind";
import { overTerminal } from "../lib/overlay";
import { TERMINAL_FONTS } from "../theme";
import { hexColor, makePalette, type Palette } from "./palette";
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

const TERM_VARS = [
  "--color-term-fg",
  "--color-terminal",
  "--color-term-cursor",
  ...Array.from({ length: 16 }, (_, i) => `--color-term-${i}`),
];

/** The theme's terminal colors (global.css); a new palette when the theme changes. */
function useTerminalPalette(): Palette {
  const values = useCSSVariable(TERM_VARS) as (string | undefined)[];
  const key = values.join("|");
  return useMemo(() => {
    const [fg, bg, cursor, ...ansi] = values.map((v) => hexColor(v));
    return makePalette(fg, bg, cursor, ansi);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
}

function emptyPicture(): SkPicture {
  const rec = Skia.PictureRecorder();
  rec.beginRecording(Skia.XYWHRect(0, 0, 1, 1));
  return rec.finishRecordingAsPicture();
}
const encoder = new TextEncoder();
export const TerminalView = forwardRef<TerminalViewHandle, TerminalViewProps>(function TerminalView(props, ref) {
  const p = useRef(props);
  p.current = props;

  // ---- fonts and renderer
  const regular = useTypeface(TERMINAL_FONTS["JetBrains Mono"][0]);
  const bold = useTypeface(TERMINAL_FONTS["JetBrains Mono"][1]);
  const symRegular = useTypeface(TERMINAL_FONTS["Adwaita Mono"][0]);
  const symBold = useTypeface(TERMINAL_FONTS["Adwaita Mono"][1]);
  const provider = useFonts(TERMINAL_FONTS);
  const palette = useTerminalPalette();
  const renderer = useMemo(
    () => (regular && bold && symRegular && symBold ? new Renderer({ regular, bold, symRegular, symBold, provider }, props.fontSize, PixelRatio.get(), palette) : null),
    // The font size and colors are applied separately: pinching or a new theme don't rebuild the renderer.
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
  const redrawNow = useCallback(() => {
    frameQueued.current = false;
    const s = screen.current;
    const { width, height } = size.current;
    if (!renderer || !s || width === 0) return;
    picture.value = renderer.render({
      screen: s,
      history: p.current.historyMode ? p.current.history : [],
      scrollPx: p.current.historyMode ? scrollPx.current : 0,
      width,
      height,
      focused: focused.current,
    });
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
      p.current.onGrid(g.cols, g.rows);
    }
  }, [renderer]);

  useEffect(() => {
    if (!renderer) return;
    if (renderer.fontSize !== props.fontSize) renderer.setFontSize(props.fontSize);
    updateGrid();
    redraw();
  }, [renderer, props.fontSize, updateGrid, redraw]);

  useEffect(() => {
    renderer?.setPalette(palette);
    redraw();
  }, [renderer, palette, redraw]);

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

  const sendWheel = useCallback((up: boolean) => {
    const s = screen.current;
    if (!s || s.mouseMode === 0) return;
    if (!up && live.current.notches === 0 && fling.current) return;
    setNotches(up ? live.current.notches + 1 : Math.max(0, live.current.notches - 1));
    const button = up ? 64 : 65;
    const { col, row } = live.current;
    const seq = s.mouseEncoding === 1006 ? `\x1b[<${button};${col};${row}M` : `\x1b[M${String.fromCharCode(32 + button, 32 + col, 32 + row)}`;
    p.current.onInput(encoder.encode(seq));
  }, []);

  /** Turns finger travel into wheel notches, rowsPerNotch rows each, so the content keeps pace with the finger. */
  const wheel = useCallback(
    (dy: number) => {
      const step = (renderer?.cellH ?? 20) * p.current.rowsPerNotch;
      live.current.accum += dy;
      while (live.current.accum >= step) {
        sendWheel(true);
        live.current.accum -= step;
      }
      while (live.current.accum <= -step) {
        sendWheel(false);
        live.current.accum += step;
      }
    },
    [renderer, sendWheel],
  );

  // ---- frames straight from the mosh client (no React state per frame)
  useEffect(() => {
    const c = props.client;
    if (!c) return;
    screen.current = c.screen;
    redraw();
    return c.onScreen((s) => {
      screen.current = s;
      redraw();
    });
  }, [props.client, redraw]);

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
    live.current = { notches: 0, accum: 0, col: 1, row: 1 };
    p.current.onRemoteScroll(0);
    scrollPx.current = 0;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.paneKey]);

  useEffect(() => {
    // Entering History mode shows the screen above; leaving it returns to live.
    if (!renderer) return;
    scrollPx.current = props.historyMode ? Math.min(props.history.length, grid.current.rows) * renderer.cellH : 0;
    redraw();
  }, [props.historyMode, props.history, renderer, redraw]);

  // ---- gestures
  const axis = useRef<"none" | "v" | "h">("none");
  /** The touch began while a menu or dialog covered the terminal: it was meant for that. */
  const ignored = useRef(false);
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
        ignored.current = overTerminal();
        if (ignored.current) return;
        stopFling();
        axis.current = "none";
        lastY.current = 0;
        live.current.accum = 0;
        const cw = renderer?.cellW ?? 8;
        const ch = renderer?.cellH ?? 16;
        live.current.col = Math.min(Math.max(Math.floor(e.x / cw), 0), Math.max(0, grid.current.cols - 1)) + 1;
        live.current.row = Math.min(Math.max(Math.floor(e.y / ch), 0), Math.max(0, grid.current.rows - 1)) + 1;
        p.current.onTouchStart();
      })
      .onUpdate((e) => {
        if (ignored.current) return;
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
        if (ignored.current) return;
        if (axis.current === "v") {
          if (Math.abs(e.velocityY) > 200) startFling(e.velocityY, p.current.historyMode);
        } else if (axis.current === "h") {
          if (Math.abs(e.translationX) > size.current.width * 0.25 && Math.abs(e.velocityX) > 500) p.current.onSwipe(e.translationX < 0 ? 1 : -1);
        }
      });
    const tap = Gesture.Tap()
      .runOnJS(true)
      .onBegin(() => {
        ignored.current = overTerminal();
      })
      .onEnd(() => !ignored.current && showKeyboard());
    const longPress = Gesture.LongPress()
      .runOnJS(true)
      .minDuration(450)
      .onStart(() => !overTerminal() && p.current.onLongPress());
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
  }, [renderer, wheel, setScroll, redraw, updateGrid]);

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
