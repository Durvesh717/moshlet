import * as Speech from "expo-speech-recognition";
import { Keyboard as KeyboardIcon, Mic, Pencil, Send, X } from "lucide-react-native";
import { useEffect, useRef, useState } from "react";
import { Pressable, StyleSheet, TextInput, View } from "react-native";
import { C, F, R } from "../theme";
import { IconButton, KeyCap, KeyLabel } from "../ui/kit";

type Key = { label: string; bytes: string | null; desc: string };

// Arrows go out in application form, like a terminal running mosh; mosh-server turns them into the
// normal form whenever the program on the far side hasn't asked for application cursor keys.

const TYPING: Key[] = [
  { label: "esc", bytes: "\x1b", desc: "Escape" },
  { label: "tab", bytes: "\t", desc: "Tab" },
  { label: "ctrl", bytes: null, desc: "Control" },
  { label: "alt", bytes: null, desc: "Alt" },
  { label: "←", bytes: "\x1bOD", desc: "Left" },
  { label: "↑", bytes: "\x1bOA", desc: "Up" },
  { label: "↓", bytes: "\x1bOB", desc: "Down" },
  { label: "→", bytes: "\x1bOC", desc: "Right" },
  { label: "/", bytes: "/", desc: "Slash" },
];

const IDLE: Key[] = [
  { label: "esc", bytes: "\x1b", desc: "Escape" },
  { label: "^C", bytes: "\x03", desc: "Control C" },
  { label: "⇧⇥", bytes: "\x1b[Z", desc: "Shift Tab" },
  { label: "↑", bytes: "\x1bOA", desc: "Up" },
  { label: "↓", bytes: "\x1bOB", desc: "Down" },
  { label: "⏎", bytes: "\r", desc: "Enter" },
];

const encoder = new TextEncoder();

/**
 * The one row under the terminal. While typing into the terminal it carries the keys a phone
 * keyboard lacks; otherwise the few an agent session needs (stop it, cycle its mode, pick an
 * option), plus the keyboard and the prompt box.
 */
export function KeyBar(props: {
  typing: boolean;
  ctrl: boolean;
  alt: boolean;
  onCtrl(): void;
  onAlt(): void;
  onKey(bytes: Uint8Array): void;
  onKeyboard(): void;
  onCompose(): void;
}) {
  const keys = props.typing ? TYPING : IDLE;
  return (
    <View style={styles.row}>
      {keys.map((k) => {
        const active = (k.label === "ctrl" && props.ctrl) || (k.label === "alt" && props.alt);
        return (
          <KeyCap
            key={k.label}
            label={k.desc}
            active={active}
            onPress={() => {
              if (k.label === "ctrl") props.onCtrl();
              else if (k.label === "alt") props.onAlt();
              else if (k.bytes) props.onKey(encoder.encode(k.bytes));
            }}
          >
            <KeyLabel text={k.label} active={active} />
          </KeyCap>
        );
      })}
      {!props.typing && (
        <>
          <KeyCap label="Keyboard" onPress={props.onKeyboard}>
            <KeyboardIcon size={18} color={C.text} />
          </KeyCap>
          <KeyCap label="Write a prompt" onPress={props.onCompose} color={C.accentStrong} flex={1.3}>
            <Pencil size={17} color="#fff" />
          </KeyCap>
        </>
      )}
    </View>
  );
}

/** The prompt box: takes the key row's place while open, sends through herdr, then gets out of the way. */
export function Composer(props: { placeholder: string; onSend(text: string): void; onClose(): void }) {
  const [text, setText] = useState("");
  const [listening, setListening] = useState(false);
  const input = useRef<TextInput>(null);

  useEffect(() => {
    const t = setTimeout(() => input.current?.focus(), 50);
    return () => clearTimeout(t);
  }, []);

  Speech.useSpeechRecognitionEvent("result", (e) => {
    const spoken = e.results[0]?.transcript;
    if (spoken && e.isFinal) setText((cur) => (cur.trim() ? `${cur} ${spoken}` : spoken));
  });
  Speech.useSpeechRecognitionEvent("end", () => setListening(false));

  const dictate = async () => {
    const perm = await Speech.ExpoSpeechRecognitionModule.requestPermissionsAsync();
    if (!perm.granted) return;
    setListening(true);
    Speech.ExpoSpeechRecognitionModule.start({ lang: "en-US", interimResults: false, continuous: false });
  };

  const send = () => {
    if (!text.trim()) return;
    props.onSend(text);
    setText("");
  };

  return (
    <View style={[styles.row, { alignItems: "flex-end" }]}>
      <IconButton icon={X} label="Close" size={42} onPress={props.onClose} />
      <TextInput
        ref={input}
        value={text}
        onChangeText={setText}
        placeholder={props.placeholder}
        placeholderTextColor={C.faint}
        multiline
        style={styles.input}
        onSubmitEditing={send}
        submitBehavior="blurAndSubmit"
        returnKeyType="send"
      />
      {text.trim() ? (
        <Pressable accessibilityLabel="Send" onPress={send} style={({ pressed }) => [styles.send, pressed && { opacity: 0.8 }]}>
          <Send size={19} color="#fff" />
        </Pressable>
      ) : (
        <IconButton icon={Mic} label="Dictate" size={42} active={listening} background={C.surface2} border={C.line2} onPress={() => void dictate()} />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", gap: 5, padding: 6 },
  input: {
    flex: 1,
    minHeight: 42,
    maxHeight: 140,
    borderRadius: 21,
    backgroundColor: C.surface,
    borderColor: C.line,
    borderWidth: 1,
    paddingHorizontal: 16,
    paddingTop: 11,
    paddingBottom: 11,
    color: C.text,
    fontFamily: F.regular,
    fontSize: 15,
  },
  send: { width: 42, height: 42, borderRadius: R.pill, backgroundColor: C.accentStrong, alignItems: "center", justifyContent: "center" },
});
