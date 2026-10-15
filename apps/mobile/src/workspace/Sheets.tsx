import { isNegative, parseApproval, type ApprovalPrompt, type Layout, type Pane, type Snapshot } from "@corral/core";
import { BottomSheetBackdrop, BottomSheetModal, BottomSheetScrollView, BottomSheetTextInput, type BottomSheetBackdropProps } from "@gorhom/bottom-sheet";
import { Bot, Columns2, Pencil, Rows2, Send, Trash2 } from "lucide-react-native";
import { forwardRef, useCallback, useEffect, useRef, useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";
import { C, F, R } from "../theme";
import { confirm } from "../ui/Confirm";
import { StatusGlyph } from "../ui/kit";

const backdrop = (p: BottomSheetBackdropProps) => <BottomSheetBackdrop {...p} appearsOnIndex={0} disappearsOnIndex={-1} opacity={0.6} />;

const sheetProps = {
  backdropComponent: backdrop,
  backgroundStyle: { backgroundColor: C.surface, borderTopLeftRadius: 28, borderTopRightRadius: 28 },
  handleIndicatorStyle: { backgroundColor: C.line2, width: 44 },
  enableDynamicSizing: true,
  keyboardBehavior: "interactive" as const,
  keyboardBlurBehavior: "restore" as const,
};

/** The agent's approval dialog, read off its screen, as big buttons; plus a reply box. */
export const ApprovalSheet = forwardRef<
  BottomSheetModal,
  { agentName: string; where: string; read(): Promise<string>; onChoose(keys: string[]): void; onReply(text: string): void }
>(function ApprovalSheet(props, ref) {
  const [prompt, setPrompt] = useState<ApprovalPrompt | null>(null);
  const [reply, setReply] = useState("");
  const { read } = props;
  const load = useCallback(() => {
    setPrompt(null);
    void read()
      .then((text) => setPrompt(parseApproval(text)))
      .catch(() => setPrompt(parseApproval("")));
  }, [read]);
  return (
    <BottomSheetModal ref={ref} {...sheetProps} onChange={(i) => i >= 0 && load()}>
      <BottomSheetScrollView contentContainerStyle={styles.sheet}>
        <View style={styles.head}>
          <View style={styles.warn}>
            <StatusGlyph status="blocked" size={22} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.title}>{props.agentName} needs approval</Text>
            <Text style={styles.sub}>{props.where}</Text>
          </View>
        </View>
        {!prompt ? (
          <ActivityIndicator color={C.accent} style={{ margin: 24 }} />
        ) : (
          <>
            {prompt.question.length > 0 && (
              <View style={styles.preview}>
                {prompt.question.map((l, i) => (
                  <Text key={i} style={styles.previewText} numberOfLines={2}>
                    {l}
                  </Text>
                ))}
              </View>
            )}
            {prompt.options.map((o, i) => {
              const primary = i === 0;
              const negative = isNegative(o);
              return (
                <Pressable
                  key={`${i}-${o.label}`}
                  onPress={() => props.onChoose(o.keys)}
                  style={({ pressed }) => [
                    styles.option,
                    primary ? styles.optionPrimary : negative ? styles.optionNegative : null,
                    pressed && { opacity: 0.8 },
                  ]}
                >
                  {o.number && <Text style={[styles.optionNum, primary && { color: "#fff" }]}>{o.number}</Text>}
                  <Text style={[styles.optionText, primary && { color: "#fff", fontFamily: F.semibold }, negative && !primary && { color: C.danger }]}>{o.label}</Text>
                </Pressable>
              );
            })}
          </>
        )}
        <View style={styles.replyRow}>
          <BottomSheetTextInput
            value={reply}
            onChangeText={setReply}
            placeholder={`Reply to ${props.agentName}`}
            placeholderTextColor={C.faint}
            style={styles.reply}
          />
          <Pressable
            accessibilityLabel="Send reply"
            onPress={() => {
              if (!reply.trim()) return;
              props.onReply(reply);
              setReply("");
            }}
            style={({ pressed }) => [styles.send, pressed && { opacity: 0.8 }]}
          >
            <Send size={20} color="#fff" />
          </Pressable>
        </View>
      </BottomSheetScrollView>
    </BottomSheetModal>
  );
});

/** The tab's layout as herdr has it: tap a pane to open it; split, close, start an agent, rename. */
export const PaneMapSheet = forwardRef<
  BottomSheetModal,
  {
    snapshot: Snapshot | null;
    tabId: string | undefined;
    paneId: string | null;
    onOpen(paneId: string): void;
    onSplit(direction: "right" | "down"): void;
    onClose(): void;
    onStartAgent(kind: string): void;
    onRename(): void;
  }
>(function PaneMapSheet(props, ref) {
  const layout: Layout | undefined = props.snapshot?.layouts.find((l) => l.tab_id === props.tabId);
  const panes: Pane[] = props.snapshot?.panes.filter((p) => p.tab_id === props.tabId) ?? [];
  const [width, setWidth] = useState(0);
  const area = layout?.area ?? { x: 0, y: 0, width: 1, height: 1 };
  const scale = width > 0 ? width / Math.max(1, area.width) : 0;
  const mapHeight = Math.min(260, area.height * scale * 2.1);
  const sy = mapHeight / Math.max(1, area.height);
  const agentOf = (paneId: string) => props.snapshot?.agents.find((a) => a.pane_id === paneId);

  return (
    <BottomSheetModal ref={ref} {...sheetProps}>
      <BottomSheetScrollView contentContainerStyle={styles.sheet}>
        <Text style={styles.title}>Panes</Text>
        <View style={[styles.map, { height: mapHeight }]} onLayout={(e) => setWidth(e.nativeEvent.layout.width)}>
          {scale > 0 &&
            (layout?.panes ?? []).map((lp, i) => {
              const pane = panes.find((p) => p.pane_id === lp.pane_id);
              const agent = agentOf(lp.pane_id);
              const current = lp.pane_id === props.paneId;
              return (
                <Pressable
                  key={lp.pane_id}
                  onPress={() => props.onOpen(lp.pane_id)}
                  style={[
                    styles.mapPane,
                    {
                      left: (lp.rect.x - area.x) * scale + 2,
                      top: (lp.rect.y - area.y) * sy + 2,
                      width: lp.rect.width * scale - 4,
                      height: lp.rect.height * sy - 4,
                    },
                    current && styles.mapPaneCurrent,
                  ]}
                >
                  <Text style={[styles.mapLabel, current && { color: C.accent }]}>{i + 1}</Text>
                  {agent ? (
                    <View style={styles.mapAgent}>
                      <StatusGlyph status={agent.agent_status} size={11} />
                      <Text style={styles.mapSub} numberOfLines={1}>
                        {agent.name ?? agent.agent}
                      </Text>
                    </View>
                  ) : (
                    <Text style={styles.mapSub} numberOfLines={1}>
                      {pane?.foreground_cwd?.split("/").pop() ?? ""}
                    </Text>
                  )}
                </Pressable>
              );
            })}
        </View>
        <View style={styles.actions}>
          <Action icon={<Columns2 size={18} color={C.text} />} label="Split right" onPress={() => props.onSplit("right")} />
          <Action icon={<Rows2 size={18} color={C.text} />} label="Split down" onPress={() => props.onSplit("down")} />
        </View>
        <View style={styles.actions}>
          <Action icon={<Bot size={18} color={C.text} />} label="Start claude" onPress={() => props.onStartAgent("claude")} />
          <Action icon={<Bot size={18} color={C.text} />} label="Start codex" onPress={() => props.onStartAgent("codex")} />
        </View>
        <View style={styles.actions}>
          <Action icon={<Pencil size={18} color={C.text} />} label="Rename tab" onPress={props.onRename} />
          <Action
            icon={<Trash2 size={18} color={C.danger} />}
            label="Close pane"
            danger
            onPress={() =>
              void confirm({ title: "Close this pane?", message: "Whatever runs in it is ended.", action: "Close", danger: true }).then(
                (ok) => ok && props.onClose(),
              )
            }
          />
        </View>
      </BottomSheetScrollView>
    </BottomSheetModal>
  );
});

function Action(props: { icon: React.ReactNode; label: string; onPress(): void; danger?: boolean }) {
  return (
    <Pressable onPress={props.onPress} style={({ pressed }) => [styles.action, props.danger && styles.actionDanger, pressed && { opacity: 0.8 }]}>
      {props.icon}
      <Text style={[styles.actionText, props.danger && { color: C.danger }]}>{props.label}</Text>
    </Pressable>
  );
}

/** A small text prompt (rename tab, new workspace). */
export function useTextPrompt() {
  const [state, setState] = useState<{ title: string; initial: string; resolve: (v: string | null) => void } | null>(null);
  const ask = (title: string, initial = "") => new Promise<string | null>((resolve) => setState({ title, initial, resolve }));
  return { state, ask, done: (v: string | null) => (state?.resolve(v), setState(null)) };
}

export function TextPromptSheet(props: { state: { title: string; initial: string } | null; done(v: string | null): void }) {
  const [value, setValue] = useState("");
  const sheet = useRef<BottomSheetModal>(null);
  useEffect(() => {
    setValue(props.state?.initial ?? "");
    // Present once per prompt: presenting again snaps the sheet back down under the keyboard.
    if (props.state) sheet.current?.present();
  }, [props.state]);
  if (!props.state) return null;
  return (
    <BottomSheetModal ref={sheet} {...sheetProps} onDismiss={() => props.done(null)}>
      <BottomSheetScrollView contentContainerStyle={styles.sheet}>
        <Text style={styles.title}>{props.state.title}</Text>
        <BottomSheetTextInput value={value} onChangeText={setValue} autoFocus style={styles.reply} placeholderTextColor={C.faint} />
        <Pressable onPress={() => props.done(value.trim())} style={({ pressed }) => [styles.option, styles.optionPrimary, pressed && { opacity: 0.8 }]}>
          <Text style={[styles.optionText, { color: "#fff", fontFamily: F.semibold }]}>Save</Text>
        </Pressable>
      </BottomSheetScrollView>
    </BottomSheetModal>
  );
}

const styles = StyleSheet.create({
  sheet: { paddingHorizontal: 20, paddingTop: 6, paddingBottom: 34, gap: 12 },
  head: { flexDirection: "row", alignItems: "center", gap: 14, marginBottom: 4 },
  warn: { width: 52, height: 52, borderRadius: 16, backgroundColor: C.blockedBg, alignItems: "center", justifyContent: "center" },
  title: { fontFamily: F.bold, fontSize: 21, color: C.text },
  sub: { fontFamily: F.regular, fontSize: 14, color: C.muted, marginTop: 2 },
  preview: { backgroundColor: C.terminal, borderColor: C.line, borderWidth: 1, borderRadius: R.lg, padding: 14, gap: 4 },
  previewText: { fontFamily: F.mono, fontSize: 13, color: C.text },
  option: { flexDirection: "row", alignItems: "center", gap: 14, minHeight: 56, borderRadius: R.lg, borderWidth: 1, borderColor: C.line2, backgroundColor: C.surface2, paddingHorizontal: 18 },
  optionPrimary: { backgroundColor: C.accentStrong, borderColor: C.accentStrong },
  optionNegative: { backgroundColor: C.dangerBg, borderColor: C.dangerLine },
  optionNum: { fontFamily: F.mono, fontSize: 14, color: C.muted },
  optionText: { flex: 1, fontFamily: F.medium, fontSize: 16, color: C.text },
  replyRow: { flexDirection: "row", alignItems: "center", gap: 10, marginTop: 6 },
  reply: { flex: 1, minHeight: 52, borderRadius: R.lg, borderWidth: 1, borderColor: C.line2, backgroundColor: C.ground, paddingHorizontal: 16, color: C.text, fontFamily: F.regular, fontSize: 16 },
  send: { width: 52, height: 52, borderRadius: 26, backgroundColor: C.accentStrong, alignItems: "center", justifyContent: "center" },
  map: { backgroundColor: C.terminal, borderRadius: R.lg, borderWidth: 1, borderColor: C.line },
  mapPane: { position: "absolute", borderRadius: R.sm, borderWidth: 1, borderColor: C.line2, backgroundColor: C.surface, padding: 8, gap: 4 },
  mapPaneCurrent: { borderColor: C.accent, backgroundColor: C.accentTint },
  mapLabel: { fontFamily: F.semibold, fontSize: 14, color: C.text },
  mapAgent: { flexDirection: "row", alignItems: "center", gap: 5 },
  mapSub: { fontFamily: F.mono, fontSize: 11, color: C.muted, flexShrink: 1 },
  actions: { flexDirection: "row", gap: 10 },
  action: { flex: 1, flexDirection: "row", alignItems: "center", gap: 10, height: 50, borderRadius: R.lg, borderWidth: 1, borderColor: C.line2, backgroundColor: C.surface2, paddingHorizontal: 14 },
  actionDanger: { backgroundColor: C.dangerBg, borderColor: C.dangerLine },
  actionText: { fontFamily: F.medium, fontSize: 15, color: C.text },
});
