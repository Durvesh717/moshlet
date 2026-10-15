import { isNegative, parseApproval, type ApprovalPrompt, type Layout, type Pane, type Snapshot } from "@corral/core";
import { BottomSheetBackdrop, BottomSheetModal, BottomSheetScrollView, BottomSheetTextInput, type BottomSheetBackdropProps } from "@gorhom/bottom-sheet";
import { Bot, Columns2, Pencil, Rows2, Send, Trash2, type LucideIcon } from "lucide-react-native";
import { forwardRef, useCallback, useEffect, useRef, useState } from "react";
import { ActivityIndicator, Pressable, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import { Text } from "@/components/ui/text";
import { useColors } from "@/lib/colors";
import { cn } from "@/lib/utils";
import { confirm } from "../ui/Confirm";
import { StatusGlyph } from "../ui/kit";

const backdrop = (p: BottomSheetBackdropProps) => <BottomSheetBackdrop {...p} appearsOnIndex={0} disappearsOnIndex={-1} opacity={0.6} />;

/** Sheets stop below the status bar when they grow (to their content, or above the keyboard). */
function useSheetProps() {
  const insets = useSafeAreaInsets();
  const c = useColors();
  return {
    backdropComponent: backdrop,
    backgroundStyle: { backgroundColor: c.card, borderTopLeftRadius: 28, borderTopRightRadius: 28 },
    handleIndicatorStyle: { backgroundColor: c.borderStrong, width: 44 },
    enableDynamicSizing: true,
    keyboardBehavior: "interactive" as const,
    keyboardBlurBehavior: "restore" as const,
    topInset: insets.top,
  };
}

const SHEET = { paddingHorizontal: 20, paddingTop: 6, paddingBottom: 34, gap: 12 };

/** gorhom's text input takes style objects, so its colors come from the theme here. */
function useSheetInputStyle() {
  const c = useColors();
  return {
    style: { flex: 1, minHeight: 52, borderRadius: 14, borderWidth: 1, borderColor: c.borderStrong, backgroundColor: c.background, paddingHorizontal: 16, color: c.foreground, fontFamily: "Geist-Regular", fontSize: 16 },
    placeholderTextColor: c.faint,
  };
}

/** The agent's approval dialog, read off its screen, as big buttons; plus a reply box. */
export const ApprovalSheet = forwardRef<
  BottomSheetModal,
  { agentName: string; where: string; read(): Promise<string>; onChoose(keys: string[]): void; onReply(text: string): void }
>(function ApprovalSheet(props, ref) {
  const sheetProps = useSheetProps();
  const input = useSheetInputStyle();
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
      <BottomSheetScrollView contentContainerStyle={SHEET}>
        <View className="mb-1 flex-row items-center gap-3.5">
          <View className="size-[52px] items-center justify-center rounded-2xl bg-warning-muted">
            <StatusGlyph status="blocked" size={22} />
          </View>
          <View className="flex-1">
            <Text className="font-bold text-[21px]">{props.agentName} needs approval</Text>
            <Text className="mt-0.5 text-sm text-muted-foreground">{props.where}</Text>
          </View>
        </View>
        {!prompt ? (
          <ActivityIndicator colorClassName="accent-brand" className="m-6" />
        ) : (
          <>
            {prompt.question.length > 0 && (
              <View className="gap-1 rounded-lg border border-border bg-terminal p-3.5">
                {prompt.question.map((l, i) => (
                  <Text key={i} className="font-mono text-[13px]" numberOfLines={2}>
                    {l}
                  </Text>
                ))}
              </View>
            )}
            {prompt.options.map((o, i) => {
              const primary = i === 0;
              const negative = isNegative(o);
              return (
                <Button
                  key={`${i}-${o.label}`}
                  variant={primary ? "default" : "secondary"}
                  onPress={() => props.onChoose(o.keys)}
                  className={cn(
                    "min-h-14 justify-start gap-3.5 rounded-lg border px-[18px] active:opacity-80",
                    primary ? "border-primary" : negative ? "border-destructive-border bg-destructive-muted" : "border-border-strong",
                  )}
                >
                  {o.number && <Text className={cn("font-mono text-sm", primary ? "text-primary-foreground" : "text-muted-foreground")}>{o.number}</Text>}
                  <Text
                    className={cn(
                      "flex-1 text-base",
                      primary ? "font-semibold text-primary-foreground" : negative ? "font-medium text-destructive" : "font-medium text-foreground",
                    )}
                  >
                    {o.label}
                  </Text>
                </Button>
              );
            })}
          </>
        )}
        <View className="mt-1.5 flex-row items-center gap-2.5">
          <BottomSheetTextInput value={reply} onChangeText={setReply} placeholder={`Reply to ${props.agentName}`} {...input} />
          <Button
            accessibilityLabel="Send reply"
            size="icon"
            onPress={() => {
              if (!reply.trim()) return;
              props.onReply(reply);
              setReply("");
            }}
            className="size-[52px] rounded-full active:opacity-80"
          >
            <Icon as={Send} size={20} className="text-primary-foreground" />
          </Button>
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
  const sheetProps = useSheetProps();
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
      <BottomSheetScrollView contentContainerStyle={SHEET}>
        <Text className="font-bold text-[21px]">Panes</Text>
        <View className="rounded-lg border border-border bg-terminal" style={{ height: mapHeight }} onLayout={(e) => setWidth(e.nativeEvent.layout.width)}>
          {scale > 0 &&
            (layout?.panes ?? []).map((lp, i) => {
              const pane = panes.find((p) => p.pane_id === lp.pane_id);
              const agent = agentOf(lp.pane_id);
              const current = lp.pane_id === props.paneId;
              return (
                <Pressable
                  key={lp.pane_id}
                  onPress={() => props.onOpen(lp.pane_id)}
                  className={cn("absolute gap-1 rounded-sm border p-2", current ? "border-brand bg-accent" : "border-border-strong bg-card")}
                  style={{
                    left: (lp.rect.x - area.x) * scale + 2,
                    top: (lp.rect.y - area.y) * sy + 2,
                    width: lp.rect.width * scale - 4,
                    height: lp.rect.height * sy - 4,
                  }}
                >
                  <Text className={cn("font-semibold text-sm", current && "text-brand")}>{i + 1}</Text>
                  {agent ? (
                    <View className="flex-row items-center gap-[5px]">
                      <StatusGlyph status={agent.agent_status} size={11} />
                      <Text className="shrink font-mono text-[11px] text-muted-foreground" numberOfLines={1}>
                        {agent.name ?? agent.agent}
                      </Text>
                    </View>
                  ) : (
                    <Text className="shrink font-mono text-[11px] text-muted-foreground" numberOfLines={1}>
                      {pane?.foreground_cwd?.split("/").pop() ?? ""}
                    </Text>
                  )}
                </Pressable>
              );
            })}
        </View>
        <View className="flex-row gap-2.5">
          <Action icon={Columns2} label="Split right" onPress={() => props.onSplit("right")} />
          <Action icon={Rows2} label="Split down" onPress={() => props.onSplit("down")} />
        </View>
        <View className="flex-row gap-2.5">
          <Action icon={Bot} label="Start claude" onPress={() => props.onStartAgent("claude")} />
          <Action icon={Bot} label="Start codex" onPress={() => props.onStartAgent("codex")} />
        </View>
        <View className="flex-row gap-2.5">
          <Action icon={Pencil} label="Rename tab" onPress={props.onRename} />
          <Action
            icon={Trash2}
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

function Action(props: { icon: LucideIcon; label: string; onPress(): void; danger?: boolean }) {
  return (
    <Button
      variant="secondary"
      onPress={props.onPress}
      className={cn(
        "h-[50px] flex-1 justify-start gap-2.5 rounded-lg border px-3.5 active:opacity-80",
        props.danger ? "border-destructive-border bg-destructive-muted" : "border-border-strong",
      )}
    >
      <Icon as={props.icon} size={18} className={props.danger ? "text-destructive" : "text-foreground"} />
      <Text className={cn("font-medium text-[15px]", props.danger ? "text-destructive" : "text-foreground")}>{props.label}</Text>
    </Button>
  );
}

/** A small text prompt (rename tab, new workspace). */
export function useTextPrompt() {
  const [state, setState] = useState<{ title: string; initial: string; resolve: (v: string | null) => void } | null>(null);
  const ask = (title: string, initial = "") => new Promise<string | null>((resolve) => setState({ title, initial, resolve }));
  return { state, ask, done: (v: string | null) => (state?.resolve(v), setState(null)) };
}

export function TextPromptSheet(props: { state: { title: string; initial: string } | null; done(v: string | null): void }) {
  const sheetProps = useSheetProps();
  const input = useSheetInputStyle();
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
      <BottomSheetScrollView contentContainerStyle={SHEET}>
        <Text className="font-bold text-[21px]">{props.state.title}</Text>
        <BottomSheetTextInput value={value} onChangeText={setValue} autoFocus {...input} />
        <Button onPress={() => props.done(value.trim())} className="min-h-14 rounded-lg active:opacity-80">
          <Text className="font-semibold text-base text-primary-foreground">Save</Text>
        </Button>
      </BottomSheetScrollView>
    </BottomSheetModal>
  );
}
