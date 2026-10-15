import * as Speech from "expo-speech-recognition";
import { Keyboard as KeyboardIcon, Mic, Pencil, Send, X } from "lucide-react-native";
import { useEffect, useRef, useState } from "react";
import { type TextInput, View } from "react-native";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "../lib/store";
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
    <View className="flex-row gap-[5px] p-1.5">
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
            <Icon as={KeyboardIcon} size={18} className="text-foreground" />
          </KeyCap>
          <KeyCap label="Write a prompt" onPress={props.onCompose} primary flex={1.3}>
            <Icon as={Pencil} size={17} className="text-primary-foreground" />
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
  // What the recognizer has heard so far, shown after the text until it settles.
  const [heard, setHeard] = useState("");
  const input = useRef<TextInput>(null);
  const listeningRef = useRef(false);
  listeningRef.current = listening;

  useEffect(() => {
    const t = setTimeout(() => input.current?.focus(), 50);
    return () => {
      clearTimeout(t);
      if (listeningRef.current) Speech.ExpoSpeechRecognitionModule.abort();
    };
  }, []);

  Speech.useSpeechRecognitionEvent("result", (e) => {
    const spoken = e.results[0]?.transcript ?? "";
    if (!e.isFinal) return setHeard(spoken);
    setHeard("");
    if (spoken) setText((cur) => joinWords(cur, spoken));
  });
  Speech.useSpeechRecognitionEvent("end", () => {
    setListening(false);
    setHeard("");
  });
  Speech.useSpeechRecognitionEvent("error", (e) => {
    setListening(false);
    if (e.error !== "no-speech" && e.error !== "aborted") toast(`Dictation: ${e.message}`);
  });

  const dictate = async () => {
    // A second tap ends the dictation; what was heard so far still arrives as the final result.
    if (listening) return Speech.ExpoSpeechRecognitionModule.stop();
    const perm = await Speech.ExpoSpeechRecognitionModule.requestPermissionsAsync();
    if (!perm.granted) return toast("Dictation needs the microphone");
    setListening(true);
    Speech.ExpoSpeechRecognitionModule.start({ lang: "en-US", interimResults: true, continuous: false });
  };

  const send = () => {
    if (!text.trim()) return;
    props.onSend(text);
    setText("");
  };

  return (
    <View className="flex-row items-end gap-[5px] p-1.5">
      <IconButton icon={X} label="Close" size={42} onPress={props.onClose} />
      <Textarea
        ref={input}
        value={heard ? joinWords(text, heard) : text}
        onChangeText={(t) => {
          setHeard("");
          setText(t);
        }}
        placeholder={props.placeholder}
        placeholderTextColorClassName="accent-faint"
        numberOfLines={undefined}
        textAlignVertical="center"
        className="max-h-[140px] min-h-[42px] flex-1 rounded-[21px] border-border bg-card px-4 py-[11px] text-[15px] leading-5"
        onSubmitEditing={send}
        submitBehavior="blurAndSubmit"
        returnKeyType="send"
      />
      {text.trim() && !listening ? (
        <Button accessibilityLabel="Send" onPress={send} size="icon" className="size-[42px] rounded-full active:opacity-80">
          <Icon as={Send} size={19} className="text-primary-foreground" />
        </Button>
      ) : (
        <IconButton icon={Mic} label="Dictate" size={42} active={listening} className="border-border-strong bg-secondary" onPress={() => void dictate()} />
      )}
    </View>
  );
}

const joinWords = (a: string, b: string) => (a.trim() ? `${a.trimEnd()} ${b}` : b);
