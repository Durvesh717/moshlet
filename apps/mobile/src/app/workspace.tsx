import { agentIn, appOwnsScroll, orderedPanes, primaryPane, tabName, tabsOf } from "@corral/core";
import type { BottomSheetModal } from "@gorhom/bottom-sheet";
import { Redirect, useRouter } from "expo-router";
import { ChevronDown } from "lucide-react-native";
import { useEffect, useRef, useState } from "react";
import { ActivityIndicator, BackHandler, Keyboard, KeyboardAvoidingView, View } from "react-native";
import { Drawer } from "react-native-drawer-layout";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useCSSVariable } from "uniwind";
import { Text } from "@/components/ui/text";
import { cn } from "@/lib/utils";
import { activeSession, closeHost } from "../lib/session";
import { useShallow } from "zustand/react/shallow";
import { useApp } from "../lib/store";
import { TerminalView, type TerminalViewHandle } from "../terminal/TerminalView";
import { confirm } from "../ui/Confirm";
import { Pill, StatusGlyph } from "../ui/kit";
import { Composer, KeyBar } from "../workspace/KeyBar";
import { ApprovalSheet, PaneMapSheet, TextPromptSheet, useTextPrompt } from "../workspace/Sheets";
import { Sidebar } from "../workspace/Sidebar";
import { TopBar } from "../workspace/TopBar";

export default function WorkspaceScreen() {
  const session = activeSession();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const scrim = useCSSVariable("--color-scrim") as string;
  // Only what this screen shows: the link's latency changes many times a second, so the two small
  // indicators that display it read it themselves rather than re-rendering the whole workspace.
  const s = useApp(
    useShallow((st) => ({
      session: st.session,
      sessions: st.sessions,
      snapshot: st.snapshot,
      paneId: st.paneId,
      conn: st.conn,
      terminal: st.terminal,
      historyMode: st.historyMode,
      scrollback: st.scrollback,
      fontSize: st.fontSize,
      attaching: st.attaching,
      attachError: st.attachError,
      linkClosed: st.link?.closed ?? null,
      linkNeverHeard: !!st.link?.neverHeard,
    })),
  );
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [composing, setComposing] = useState(false);
  const [ctrl, setCtrl] = useState(false);
  const [alt, setAlt] = useState(false);
  const [termFocused, setTermFocused] = useState(false);
  const [keyboardUp, setKeyboardUp] = useState(false);
  const [scrolledUp, setScrolledUp] = useState(false);
  const term = useRef<TerminalViewHandle>(null);
  const approval = useRef<BottomSheetModal>(null);
  const paneMap = useRef<BottomSheetModal>(null);
  const prompt = useTextPrompt();

  useEffect(() => {
    const show = Keyboard.addListener("keyboardDidShow", () => setKeyboardUp(true));
    const hide = Keyboard.addListener("keyboardDidHide", () => setKeyboardUp(false));
    return () => {
      show.remove();
      hide.remove();
    };
  }, []);

  // Android back: close the prompt box, then the drawer; otherwise open the drawer.
  useEffect(() => {
    const sub = BackHandler.addEventListener("hardwareBackPress", () => {
      if (composing) setComposing(false);
      else setDrawerOpen(!drawerOpen);
      return true;
    });
    return () => sub.remove();
  }, [composing, drawerOpen]);

  const snap = s.snapshot;
  const pane = snap?.panes.find((p) => p.pane_id === s.paneId);
  const tab = pane && snap?.tabs.find((t) => t.tab_id === pane.tab_id);
  const ws = pane && snap?.workspaces.find((w) => w.workspace_id === pane.workspace_id);
  const agent = snap && pane ? agentIn(snap, pane.pane_id) : undefined;
  const panesInTab = snap && tab ? orderedPanes(snap, tab.tab_id) : [];
  const paneIndex = panesInTab.findIndex((p) => p.pane_id === s.paneId) + 1;
  const blockedElsewhere = snap?.agents.filter((a) => a.agent_status === "blocked" && a.pane_id !== s.paneId).length ?? 0;

  // Open the approval sheet once when the pane on screen starts needing approval.
  const lastStatus = useRef<string | undefined>(undefined);
  useEffect(() => {
    const st = agent?.agent_status;
    if (st === "blocked" && lastStatus.current !== undefined && lastStatus.current !== "blocked") approval.current?.present();
    lastStatus.current = st;
  }, [agent?.agent_status, s.paneId]);

  if (!session) return <Redirect href="/" />;

  const openPane = (id: string) => {
    session.openPane(id);
    setDrawerOpen(false);
  };
  const openTab = (tabId: string) => {
    const p = snap && primaryPane(snap, tabId);
    if (p) openPane(p.pane_id);
  };
  const swipe = (dir: 1 | -1) => {
    if (panesInTab.length < 2) return;
    const next = panesInTab[(paneIndex - 1 + dir + panesInTab.length) % panesInTab.length];
    session.openPane(next.pane_id);
  };

  const typing = termFocused && keyboardUp;
  const conn = s.conn;

  return (
    <Drawer
      open={drawerOpen}
      onOpen={() => setDrawerOpen(true)}
      onClose={() => setDrawerOpen(false)}
      swipeEnabled={drawerOpen}
      drawerStyle={{ backgroundColor: "transparent", width: 320 }}
      overlayStyle={{ backgroundColor: scrim }}
      renderDrawerContent={() => (
        <Sidebar
          hostName={session.host.name}
          session={s.session}
          sessions={s.sessions}
          snapshot={snap}
          paneId={s.paneId}
          conn={conn}
          onOpenPane={openPane}
          onOpenTab={(id) => {
            openTab(id);
            setDrawerOpen(false);
          }}
          onNewTab={(wsId) => {
            session.newTab(wsId);
            setDrawerOpen(false);
          }}
          onNewWorkspace={() => {
            void prompt.ask("New workspace").then((name) => {
              if (name !== null) {
                session.newWorkspace(name || undefined);
                setDrawerOpen(false);
              }
            });
          }}
          onSwitchSession={(name) => session.switchSession(name)}
          onRefreshSessions={() => void session.refreshSessions()}
          onHosts={() => {
            setDrawerOpen(false);
            void closeHost();
            router.replace("/");
          }}
        />
      )}
    >
      {/* Padding, not height: resizing itself makes the view re-measure against the keyboard and
          flip between sizes on some Android versions. It owns the bottom padding, so the
          navigation bar's inset is a spacer below. */}
      <KeyboardAvoidingView className="flex-1 bg-background" style={{ paddingTop: insets.top, paddingLeft: insets.left, paddingRight: insets.right }} behavior="padding">
        <TopBar
          workspace={ws}
          tab={tab}
          tabs={snap && ws ? tabsOf(snap, ws.workspace_id) : []}
          pane={pane}
          agent={agent}
          paneIndex={paneIndex}
          paneCount={panesInTab.length}
          blockedElsewhere={blockedElsewhere}
          conn={conn}
          historyMode={s.historyMode}
          onMenu={() => {
            Keyboard.dismiss();
            setDrawerOpen(true);
          }}
          onOpenTab={openTab}
          onNewTab={() => ws && session.newTab(ws.workspace_id)}
          onHistory={() => (s.historyMode ? session.closeHistory() : void session.openHistory(term.current?.cols() ?? 0))}
          onPaneMap={() => paneMap.current?.present()}
        />

        <View className="mx-1.5 flex-1 overflow-hidden rounded-lg border border-terminal-border bg-terminal px-1 py-1.5">
          <TerminalView
            ref={term}
            client={s.terminal}
            paneKey={s.paneId}
            history={s.scrollback}
            historyMode={s.historyMode}
            fontSize={s.fontSize}
            rowsPerNotch={pane && appOwnsScroll(pane) ? 1 : 3}
            ctrl={ctrl}
            alt={alt}
            onModifiersUsed={() => {
              setCtrl(false);
              setAlt(false);
            }}
            onInput={(b) => session.write(b)}
            onGrid={(c, r) => session.setGrid(c, r)}
            onSwipe={swipe}
            onLongPress={() => paneMap.current?.present()}
            onFontSize={(size) => useApp.setState({ fontSize: size })}
            onLeaveHistory={() => session.closeHistory()}
            onRemoteScroll={(n) => {
              session.remoteNotches = n;
              setScrolledUp(n > 0);
            }}
            onTouchStart={() => session.nudge()}
            onFocusChange={setTermFocused}
          />
          {agent?.agent_status === "blocked" && (
            <Pill
              label="Needs approval"
              onPress={() => approval.current?.present()}
              height={34}
              tone="warning"
              leading={<StatusGlyph status="blocked" size={12} />}
              className="absolute bottom-2.5 left-2.5"
            />
          )}
          {(s.historyMode || scrolledUp) && (
            <Pill
              label="Live"
              onPress={() => (s.historyMode ? session.closeHistory() : term.current?.wheelToBottom())}
              height={34}
              tone="brand"
              icon={ChevronDown}
              className="absolute bottom-2.5 right-2.5"
            />
          )}
          <Overlay
            conn={conn}
            onFix={() => {
              if (conn.kind !== "failed") return;
              if (conn.fix === "setup") router.push({ pathname: "/add", params: { host: session.host.id } });
              else if (conn.fix === "trust") {
                void confirm({
                  title: "Trust the new key?",
                  message: `Only if you know why ${session.host.name}'s SSH key changed (a reinstall, or a new SSH server). Otherwise something else may be answering at its address.`,
                  action: "Trust it",
                  danger: true,
                }).then((ok) => ok && void session.reconnect(true));
              } else void session.reconnect();
            }}
            attaching={s.attaching}
            error={s.attachError}
            noPane={!pane && !!snap}
            closed={s.linkClosed}
            neverHeard={s.linkNeverHeard}
            onRetry={() => session.retryAttach()}
            onPick={() => setDrawerOpen(true)}
          />
        </View>

        {composing ? (
          <Composer
            placeholder={agent ? `Prompt ${agent.name ?? agent.agent}…` : "Run a command…"}
            onSend={(t) => {
              session.submit(t);
              setComposing(false);
              Keyboard.dismiss();
            }}
            onClose={() => setComposing(false)}
          />
        ) : (
          <KeyBar
            typing={typing}
            ctrl={ctrl}
            alt={alt}
            onCtrl={() => setCtrl(!ctrl)}
            onAlt={() => setAlt(!alt)}
            onKey={(b) => session.write(b)}
            onKeyboard={() => term.current?.focus()}
            onCompose={() => {
              term.current?.blur();
              setComposing(true);
            }}
          />
        )}
        <View style={{ height: keyboardUp ? 0 : insets.bottom }} />
      </KeyboardAvoidingView>

      <ApprovalSheet
        ref={approval}
        agentName={agent ? (agent.name ?? agent.agent) : "agent"}
        where={[ws?.label, tab && tabName(tab)].filter(Boolean).join(" · ")}
        read={() => (pane ? session.readVisible(pane.pane_id) : Promise.resolve(""))}
        onChoose={(keys) => {
          if (pane) session.sendKeys(pane.pane_id, keys);
          approval.current?.dismiss();
        }}
        onReply={(text) => {
          session.submit(text);
          approval.current?.dismiss();
        }}
      />
      <PaneMapSheet
        ref={paneMap}
        snapshot={snap}
        tabId={tab?.tab_id}
        paneId={s.paneId}
        onOpen={(id) => {
          session.openPane(id);
          paneMap.current?.dismiss();
        }}
        onSplit={(dir) => {
          if (pane) session.split(pane.pane_id, dir);
          paneMap.current?.dismiss();
        }}
        onClose={() => {
          if (pane) session.closePane(pane.pane_id);
          paneMap.current?.dismiss();
        }}
        onStartAgent={(kind) => {
          if (pane) session.startAgent(pane.pane_id, kind);
          paneMap.current?.dismiss();
        }}
        onRename={() => {
          paneMap.current?.dismiss();
          if (tab) void prompt.ask("Rename tab", tabName(tab)).then((name) => name && session.renameTab(tab.tab_id, name));
        }}
      />
      <TextPromptSheet state={prompt.state} done={prompt.done} />
    </Drawer>
  );
}

function Overlay(props: {
  conn: ReturnType<typeof useApp.getState>["conn"];
  attaching: boolean;
  error: string | null;
  noPane: boolean;
  closed: string | null;
  neverHeard: boolean;
  onRetry(): void;
  onPick(): void;
  onFix(): void;
}) {
  let message: string | null = null;
  if (props.conn.kind === "failed") message = props.conn.reason;
  else if (props.conn.kind === "reconnecting") message = `Reconnecting to the computer… (${props.conn.reason})`;
  else if (props.error) message = props.error;
  else if (props.noPane) message = "This pane isn't there anymore.";
  else if (props.closed === "session-ended") message = "This pane's terminal ended.";
  else if (props.closed === "error") message = "The mosh session failed.";
  else if (props.neverHeard) message = "mosh-server started but nothing comes back over UDP. A firewall on the computer may be blocking UDP 60000-61000 on its Tailscale interface.";
  if (!message && (props.attaching || props.conn.kind === "connecting")) {
    return (
      <View className={OVERLAY} pointerEvents="none">
        <ActivityIndicator colorClassName="accent-brand" size="large" />
      </View>
    );
  }
  if (!message) return null;
  return (
    <View className={cn(OVERLAY, "bg-dim")}>
      <Text className="text-center text-[15px] leading-[22px]">{message}</Text>
      {props.conn.kind === "failed" && (
        <View className="flex-row gap-2.5">
          <Pill label={FIX_LABEL[props.conn.fix]} onPress={props.onFix} />
        </View>
      )}
      {props.conn.kind === "online" && (
        <View className="flex-row gap-2.5">
          {!props.noPane && <Pill label="Reattach" onPress={props.onRetry} />}
          <Pill label="Pick a pane" onPress={props.onPick} />
        </View>
      )}
    </View>
  );
}

const FIX_LABEL = { unlock: "Unlock", trust: "Trust the new key…", setup: "Set up again", retry: "Try again" } as const;

const OVERLAY = "absolute bottom-0 left-0 right-0 top-0 items-center justify-center gap-3.5 p-6";
