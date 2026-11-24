import {
  answerDialog,
  isNegative,
  isPlaceholder,
  parseApproval,
  type ApprovalOption,
  type ApprovalPrompt,
  type DialogIO,
  type DialogStep,
  type Layout,
  type Pane,
  type Snapshot,
} from "@moshlet/core";
import { BottomSheetBackdrop, BottomSheetModal, BottomSheetScrollView, BottomSheetTextInput, type BottomSheetBackdropProps } from "@gorhom/bottom-sheet";
import { Bot, Check, ChevronLeft, ChevronRight, Circle, CircleDot, Columns2, MessageCircle, Pencil, Rows2, Send, Square, SquareCheck, Trash2, type LucideIcon } from "lucide-react-native";
import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
import { ActivityIndicator, Pressable, type TextInput, View } from "react-native";
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

export interface ApprovalSheetHandle {
  /** Reads the dialog, then shows the sheet; already showing, it reads it again. */
  open(): void;
  close(): void;
  /** Showing, or about to once its read lands. */
  isOpen(): boolean;
  /** Answering: keys are going to the pane. */
  busy(): boolean;
}

/** Past this, a slow read opens the sheet loading rather than not at all. */
const SLOW_READ_MS = 500;

const isForm = (p: ApprovalPrompt | null) => p?.kind === "form" || p?.kind === "review";

/**
 * The agent's approval dialog or question, read off its screen, as big buttons; plus a reply box.
 * It reads before it opens, so it slides up once at its final height (sized to the content, it
 * would grow as the read landed, and showed the last dialog's buttons until then).
 *
 * Answering goes through answerDialog: keys go to the pane the dialog was read from, and only
 * while it still reads the same, a digit, an arrow or the typed text at a time. A numbered or
 * arrow dialog is done with one pick and the sheet closes. A question form takes several steps
 * (tabs, ticks, typed answers, the review), so the sheet stays and shows each new state.
 */
export const ApprovalSheet = forwardRef<
  ApprovalSheetHandle,
  {
    agentName: string;
    where: string;
    paneId: string | undefined;
    /** The pane's screen, with its colours. */
    read(paneId: string): Promise<string>;
    keys(paneId: string, keys: string[]): Promise<void>;
    type(paneId: string, text: string): Promise<void>;
    /** The dialog is answered (or gone): close. */
    onDone(): void;
    onReply(text: string): void;
  }
>(function ApprovalSheet(props, ref) {
  const sheetProps = useSheetProps();
  const input = useSheetInputStyle();
  const [prompt, setPrompt] = useState<ApprovalPrompt | null>(null);
  const [checking, setChecking] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [reply, setReply] = useState("");
  const sheet = useRef<BottomSheetModal>(null);
  const replyBox = useRef<TextInput>(null);
  const shown = useRef(false);
  const active = useRef(false);
  const working = useRef(false);
  const reads = useRef(0);
  /** The pane the shown dialog was read from. */
  const target = useRef<string | undefined>(undefined);
  const latest = useRef(props);
  latest.current = props;

  const readPrompt = (paneId: string | undefined): Promise<ApprovalPrompt> =>
    paneId ? latest.current.read(paneId).then(parseApproval, () => parseApproval("")) : Promise.resolve(parseApproval(""));

  const run = (step: DialogStep) => {
    const paneId = target.current;
    const shownPrompt = prompt;
    if (!paneId || !shownPrompt || checking) return;
    const n = reads.current;
    const p = latest.current;
    const io: DialogIO = {
      read: () => p.read(paneId),
      keys: (k) => p.keys(paneId, k),
      type: (t) => p.type(paneId, t),
      sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
    };
    setChecking(true);
    working.current = true;
    setNotice(null);
    void answerDialog(io, shownPrompt, step)
      .then(
        (r) => {
          if (n !== reads.current) return; // closed, or read again, meanwhile
          if (!r.ok) {
            setPrompt(r.prompt);
            setNotice(
              r.why === "changed"
                ? "This changed on the computer. Check it again before choosing."
                : "The dialog didn't move as expected, so nothing more was sent. Check it again.",
            );
          } else if (isForm(shownPrompt) && isForm(r.prompt)) {
            setPrompt(r.prompt);
            if (step.do === "type") setReply("");
          } else if (shownPrompt.stays && r.prompt.stays) {
            // omp's ask: a pick only marks the choice; the sheet stays until Submit.
            setPrompt(r.prompt);
          } else latest.current.onDone();
        },
        () => n === reads.current && setNotice("Couldn't reach the computer, so nothing more was sent."),
      )
      .finally(() => {
        working.current = false;
        setChecking(false);
      });
  };

  /** "Type something": the answer comes from the reply box. */
  const typeAnswer = (option: number) => {
    if (reply.trim() === "") {
      setNotice("Write your answer in the box below, then tap it again.");
      replyBox.current?.focus();
      return;
    }
    run({ do: "type", option, text: reply });
  };

  useImperativeHandle(ref, () => ({
    open() {
      active.current = true;
      const n = ++reads.current;
      const show = () => {
        if (n !== reads.current || shown.current) return;
        shown.current = true;
        sheet.current?.present();
      };
      target.current = latest.current.paneId;
      setNotice(null);
      if (!shown.current) setPrompt(null);
      const slow = setTimeout(show, SLOW_READ_MS);
      void readPrompt(target.current).then((p) => {
        clearTimeout(slow);
        if (n !== reads.current) return;
        setPrompt(p);
        show();
      });
    },
    close() {
      active.current = false;
      reads.current++;
      sheet.current?.dismiss();
    },
    isOpen: () => active.current,
    busy: () => working.current,
  }));

  const form = prompt?.kind === "form";
  const typedAt = form ? prompt.options.findIndex((o) => o.typed) : -1;
  const title =
    prompt?.kind === "review"
      ? `Send your answers to ${props.agentName}?`
      : form
        ? `${props.agentName} has ${(prompt.tabs?.filter((t) => !t.submit).length ?? 1) > 1 ? "questions" : "a question"}`
        : `${props.agentName} needs approval`;

  return (
    <BottomSheetModal
      ref={sheet}
      {...sheetProps}
      onDismiss={() => {
        shown.current = false;
        active.current = false;
      }}
    >
      <BottomSheetScrollView contentContainerStyle={SHEET} keyboardShouldPersistTaps="handled">
        <View className="mb-1 flex-row items-center gap-3.5">
          <View className="size-[52px] items-center justify-center rounded-2xl bg-warning-muted">
            {checking ? <ActivityIndicator colorClassName="accent-warning" /> : <StatusGlyph status="blocked" size={22} />}
          </View>
          <View className="flex-1">
            <Text className="font-bold text-[21px]">{title}</Text>
            <Text className="mt-0.5 text-sm text-muted-foreground">{props.where}</Text>
          </View>
        </View>
        {!prompt ? (
          <ActivityIndicator colorClassName="accent-brand" className="m-6" />
        ) : (
          <>
            {notice && (
              <View className="rounded-lg bg-warning-muted px-3.5 py-3">
                <Text className="text-sm leading-5 text-foreground">{notice}</Text>
              </View>
            )}
            {isForm(prompt) ? (
              <FormView prompt={prompt} disabled={checking} onStep={run} onType={typeAnswer} />
            ) : (
              <>
                {prompt.question.length > 0 && (
                  <View className="gap-1 rounded-lg border border-border bg-terminal p-3.5">
                    {prompt.question.map((l, i) => (
                      <Text key={i} className="font-mono text-[13px] text-term-fg" numberOfLines={2}>
                        {l}
                      </Text>
                    ))}
                  </View>
                )}
                {prompt.stays && (
                  <Text className="text-sm text-muted-foreground">{prompt.multi ? "Pick or tick your answers, then Submit." : "Pick an answer, then Submit."}</Text>
                )}
                {prompt.options.map((o, i) => (
                  <Choice
                    key={`${i}-${o.label}`}
                    option={o}
                    primary={
                      prompt.stays ? !!o.submit : prompt.kind === "arrows" ? i === prompt.options.findIndex((x) => !isNegative(x)) : i === 0
                    }
                    disabled={checking}
                    onPress={() => run({ do: "choose", option: i })}
                  />
                ))}
              </>
            )}
          </>
        )}
        {prompt?.kind !== "review" && (
          <View className="mt-1.5 flex-row items-center gap-2.5">
            <BottomSheetTextInput
              ref={replyBox as never}
              value={reply}
              onChangeText={setReply}
              placeholder={typedAt >= 0 ? "Your own answer" : `Reply to ${props.agentName}`}
              {...input}
            />
            <Button
              accessibilityLabel={typedAt >= 0 ? "Answer with this" : "Send reply"}
              size="icon"
              disabled={checking}
              onPress={() => {
                if (!reply.trim()) return;
                if (typedAt >= 0) return typeAnswer(typedAt);
                props.onReply(reply);
                setReply("");
              }}
              className="size-[52px] rounded-full active:opacity-80"
            >
              <Icon as={Send} size={20} className="text-primary-foreground" />
            </Button>
          </View>
        )}
      </BottomSheetScrollView>
    </BottomSheetModal>
  );
});

/** One choice of a numbered or arrow dialog. */
function Choice(props: { option: ApprovalOption; primary: boolean; disabled: boolean; onPress(): void }) {
  const { option: o, primary } = props;
  const negative = isNegative(o);
  return (
    <Button
      variant={primary ? "default" : "secondary"}
      onPress={props.onPress}
      disabled={props.disabled}
      className={cn(
        "h-auto min-h-14 justify-start gap-3.5 rounded-lg border px-[18px] py-3 active:opacity-80",
        primary ? "border-primary" : negative ? "border-destructive-border bg-destructive-muted" : "border-border-strong",
        props.disabled && "opacity-60",
      )}
    >
      {o.number && <Text className={cn("font-mono text-sm", primary ? "text-primary-foreground" : "text-muted-foreground")}>{o.number}</Text>}
      {o.checked !== undefined && (
        <Icon
          as={o.toggle ? (o.checked ? SquareCheck : Square) : o.checked ? CircleDot : Circle}
          size={20}
          className={o.checked ? "text-primary" : "text-muted-foreground"}
        />
      )}
      <Text
        className={cn("flex-1 text-base", primary ? "font-semibold text-primary-foreground" : negative ? "font-medium text-destructive" : "font-medium text-foreground")}
      >
        {o.label}
      </Text>
    </Button>
  );
}

/**
 * Claude Code's question form: its tabs, the open question with its options (tick-boxes when
 * several may be picked), the row for an answer of one's own, Back and Next; or the review.
 */
function FormView(props: { prompt: ApprovalPrompt; disabled: boolean; onStep(step: DialogStep): void; onType(option: number): void }) {
  const { prompt: p, disabled } = props;
  const tabs = p.tabs ?? [];
  const tab = p.tab ?? -1;
  const known = tab >= 0;
  const row = "h-auto min-h-14 justify-start gap-3.5 rounded-lg border px-[18px] py-3 active:opacity-80";
  return (
    <>
      {tabs.length > 1 && (
        <View className="flex-row flex-wrap gap-2">
          {tabs.map((t, i) => {
            const open = i === tab;
            return (
              <Pressable
                key={`${i}-${t.label}`}
                disabled={disabled || !known || open}
                onPress={() => props.onStep({ do: "tab", to: i })}
                className={cn("h-9 flex-row items-center gap-1.5 rounded-full border px-3.5", open ? "border-primary bg-primary" : "border-border-strong bg-secondary")}
              >
                {(t.answered || t.submit) && <Icon as={t.submit ? Send : Check} size={14} className={open ? "text-primary-foreground" : "text-muted-foreground"} />}
                <Text className={cn("font-medium text-sm", open ? "text-primary-foreground" : "text-foreground")}>{t.label}</Text>
              </Pressable>
            );
          })}
        </View>
      )}

      {p.kind === "review" ? (
        <>
          <View className="gap-3 rounded-lg border border-border bg-background p-3.5">
            {(p.answers ?? []).map((a, i) => (
              <View key={i} className="gap-0.5">
                <Text className="text-sm text-muted-foreground">{a.question}</Text>
                <Text className="font-semibold text-base text-foreground">{a.answer || "—"}</Text>
              </View>
            ))}
          </View>
          {p.options.map((o, i) => (
            <Choice key={`${i}-${o.label}`} option={o} primary={i === 0} disabled={disabled} onPress={() => props.onStep({ do: "choose", option: i })} />
          ))}
        </>
      ) : (
        <>
          <View className="gap-1">
            <Text className="font-semibold text-[17px] leading-6 text-foreground">{p.question.join(" ")}</Text>
            {p.multi && <Text className="text-sm text-muted-foreground">Tick any, then Submit.</Text>}
          </View>
          {p.options.map((o, i) => {
            if (o.submit) {
              return (
                <Button key="submit" onPress={() => props.onStep({ do: "choose", option: i })} disabled={disabled} className={cn(row, "border-primary", disabled && "opacity-60")}>
                  <Icon as={Send} size={18} className="text-primary-foreground" />
                  <Text className="flex-1 font-semibold text-base text-primary-foreground">Submit</Text>
                </Button>
              );
            }
            if (o.extra) {
              return (
                <Button key={`${i}-extra`} variant="ghost" onPress={() => props.onStep({ do: "choose", option: i })} disabled={disabled} className="h-11 justify-start gap-2.5 rounded-lg px-[18px]">
                  <Icon as={MessageCircle} size={18} className="text-muted-foreground" />
                  <Text className="font-medium text-[15px] text-muted-foreground">{o.label}</Text>
                </Button>
              );
            }
            const own = o.typed === true;
            const blank = own && isPlaceholder(o);
            return (
              <Button
                key={`${i}-${o.label}`}
                variant="secondary"
                onPress={() => (own ? props.onType(i) : props.onStep({ do: "choose", option: i }))}
                disabled={disabled}
                className={cn(row, o.checked ? "border-primary" : "border-border-strong", blank && "border-dashed", disabled && "opacity-60")}
              >
                {p.multi ? (
                  <Icon as={o.checked ? SquareCheck : Square} size={20} className={o.checked ? "text-primary" : "text-muted-foreground"} />
                ) : own ? (
                  <Icon as={Pencil} size={16} className="text-muted-foreground" />
                ) : (
                  <Text className="font-mono text-sm text-muted-foreground">{o.number}</Text>
                )}
                <View className="flex-1 gap-0.5">
                  <Text className="font-medium text-base text-foreground">{blank ? "Your own answer" : o.label}</Text>
                  {(blank || o.detail) && (
                    <Text className="text-sm leading-5 text-muted-foreground">{blank ? "Write it in the box below, then tap here" : o.detail}</Text>
                  )}
                </View>
                {!p.multi && o.checked && <Icon as={Check} size={18} className="text-primary" />}
              </Button>
            );
          })}
          {known && tabs.length > 1 && (
            <View className="flex-row gap-2.5">
              {tab > 0 && (
                <Button variant="secondary" onPress={() => props.onStep({ do: "tab", to: tab - 1 })} disabled={disabled} className="h-12 flex-1 gap-1.5 rounded-lg border border-border-strong">
                  <Icon as={ChevronLeft} size={18} className="text-foreground" />
                  <Text className="font-medium text-[15px] text-foreground">Back</Text>
                </Button>
              )}
              {tab < tabs.length - 1 && (
                <Button variant="secondary" onPress={() => props.onStep({ do: "tab", to: tab + 1 })} disabled={disabled} className="h-12 flex-1 gap-1.5 rounded-lg border border-border-strong">
                  <Text className="font-medium text-[15px] text-foreground">{tabs[tab + 1]?.submit ? "Review" : "Next"}</Text>
                  <Icon as={ChevronRight} size={18} className="text-foreground" />
                </Button>
              )}
            </View>
          )}
        </>
      )}
    </>
  );
}

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
        <View className="rounded-lg border border-border bg-background" style={{ height: mapHeight }} onLayout={(e) => setWidth(e.nativeEvent.layout.width)}>
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
