import { agentName, panesOf, tabName, tabsOf, urgency, type SessionInfo, type Snapshot } from "@moshlet/core";
import { ChevronDown, ChevronRight, ChevronsUpDown, LayoutGrid, Monitor, Plus, Search } from "lucide-react-native";
import { useMemo, useState } from "react";
import { Pressable, ScrollView, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Badge } from "@/components/ui/badge";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Icon } from "@/components/ui/icon";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import { Text } from "@/components/ui/text";
import { cn } from "@/lib/utils";
import type { ConnState } from "../lib/store";
import { AgentLogo } from "../ui/AgentLogo";
import { Pill, SectionLabel, StatusGlyph, statusLabel } from "../ui/kit";
import { LinkIndicator, shortCwd } from "./TopBar";

export function Sidebar(props: {
  hostName: string;
  session: string;
  sessions: SessionInfo[];
  snapshot: Snapshot | null;
  paneId: string | null;
  conn: ConnState;
  onOpenPane(paneId: string): void;
  onOpenTab(tabId: string): void;
  onNewTab(workspaceId: string): void;
  onNewWorkspace(): void;
  onSwitchSession(name: string): void;
  /** The switcher opened: fetch which sessions are running now. */
  onRefreshSessions(): void;
  onHosts(): void;
}) {
  const insets = useSafeAreaInsets();
  const [query, setQuery] = useState("");
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const snap = props.snapshot;
  const currentPane = snap?.panes.find((p) => p.pane_id === props.paneId);
  const q = query.trim().toLowerCase();

  const agents = useMemo(() => {
    if (!snap) return [];
    return [...snap.agents]
      .filter((a) => {
        if (!q) return true;
        const ws = snap.workspaces.find((w) => w.workspace_id === a.workspace_id);
        return `${agentName(a)} ${a.terminal_title_stripped ?? ""} ${ws?.label ?? ""}`.toLowerCase().includes(q);
      })
      .sort((a, b) => urgency(a.agent_status) - urgency(b.agent_status));
  }, [snap, q]);

  const workspaces = useMemo(
    () => (snap ? [...snap.workspaces].sort((a, b) => a.number - b.number).filter((w) => !q || w.label.toLowerCase().includes(q)) : []),
    [snap, q],
  );

  return (
    <View
      className="flex-1 gap-3.5 rounded-r-[20px] bg-sidebar px-4"
      style={{ paddingTop: insets.top + 12, paddingBottom: insets.bottom + 10, paddingLeft: insets.left + 16 }}
    >
      <DropdownMenu onOpenChange={(open) => open && props.onRefreshSessions()}>
        <DropdownMenuTrigger asChild>
          <Pressable className="flex-row items-center gap-3 active:opacity-80">
            <View className="size-[46px] items-center justify-center rounded-[14px] bg-primary">
              <Text className="-mt-0.5 font-bold text-[22px] text-primary-foreground">{props.hostName.slice(0, 1).toLowerCase()}</Text>
            </View>
            <View className="flex-1">
              <Text className="font-semibold text-lg" numberOfLines={1}>
                {props.hostName}
              </Text>
              <Text className="text-sm text-muted-foreground">{props.session} session</Text>
            </View>
            <View className="size-10 items-center justify-center rounded-md border border-border-strong bg-secondary">
              <Icon as={ChevronsUpDown} size={18} className="text-foreground" />
            </View>
          </Pressable>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" sideOffset={8} className="min-w-[240px] rounded-xl border-border-strong bg-card py-2.5">
          <DropdownMenuLabel className="px-[18px] py-2 font-semibold text-[13px] tracking-[0.5px] text-muted-foreground">herdr sessions on {props.hostName}</DropdownMenuLabel>
          {props.sessions.map((s) => (
            <DropdownMenuItem key={s.name} disabled={!s.running} onPress={() => props.onSwitchSession(s.name)} className="px-[18px] py-3.5">
              <Text className={cn("text-base", s.name === props.session ? "font-semibold text-brand" : s.running ? "text-foreground" : "text-idle")}>
                {s.name}
                {s.default && s.name !== "default" ? " (default)" : ""}
                {!s.running ? " · stopped" : ""}
              </Text>
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>

      <View className="justify-center">
        <Input
          value={query}
          onChangeText={setQuery}
          placeholder="Jump to…"
          placeholderTextColorClassName="accent-faint"
          autoCorrect={false}
          autoCapitalize="none"
          className="h-[46px] rounded-lg border-border-strong bg-transparent pl-10 text-[15px]"
        />
        <View className="absolute left-3.5" pointerEvents="none">
          <Icon as={Search} size={16} className="text-faint" />
        </View>
      </View>

      <ScrollView className="flex-1" contentContainerClassName="gap-1.5 pb-3">
        <SectionLabel right={<Text className="text-xs text-faint">needs-you first</Text>}>{`Agents ${agents.length}`}</SectionLabel>
        {agents.length === 0 && <Text className="px-1 py-2 text-[15px] text-muted-foreground">{q ? "No agents match." : "No agents running."}</Text>}
        {agents.map((a) => {
          const ws = snap?.workspaces.find((w) => w.workspace_id === a.workspace_id);
          const tab = snap?.tabs.find((t) => t.tab_id === a.tab_id);
          const here = a.pane_id === props.paneId;
          return (
            <Pressable
              key={a.pane_id}
              onPress={() => props.onOpenPane(a.pane_id)}
              className={cn("flex-row items-center gap-3 rounded-lg p-3 active:opacity-80", here && "bg-secondary")}
            >
              <StatusGlyph status={a.agent_status} size={16} />
              <View className="flex-1 gap-0.5">
                <View className="flex-row items-center gap-1.5">
                  <AgentLogo kind={a.agent} size={15} />
                  <Text className="shrink font-semibold text-base" numberOfLines={1}>
                    {agentName(a)}
                  </Text>
                </View>
                {!!a.terminal_title_stripped && (
                  <Text className="text-[13px] text-muted-foreground" numberOfLines={1}>
                    {a.terminal_title_stripped}
                  </Text>
                )}
                <Text className="text-xs text-faint" numberOfLines={1}>
                  {ws?.label} · {tab ? tabName(tab) : ""}
                </Text>
              </View>
              {a.agent_status === "blocked" && (
                <Badge variant="secondary" className="bg-warning-muted px-2.5 py-1">
                  <Text className="font-semibold text-xs text-warning">{statusLabel("blocked")}</Text>
                </Badge>
              )}
            </Pressable>
          );
        })}

        <Separator className="my-2 bg-border" />
        <SectionLabel
          right={
            <Pressable onPress={props.onNewWorkspace} hitSlop={10} accessibilityLabel="New workspace">
              <Icon as={Plus} size={20} className="text-muted-foreground" />
            </Pressable>
          }
        >{`Workspaces ${workspaces.length}`}</SectionLabel>
        {workspaces.map((w) => {
          const isHere = currentPane?.workspace_id === w.workspace_id;
          const open = expanded[w.workspace_id] ?? isHere;
          const tabs = snap ? tabsOf(snap, w.workspace_id) : [];
          return (
            <View key={w.workspace_id}>
              <Pressable className="flex-row items-center gap-2.5 px-1 py-2.5" onPress={() => setExpanded({ ...expanded, [w.workspace_id]: !open })}>
                <Icon as={open ? ChevronDown : ChevronRight} size={18} className="text-muted-foreground" />
                <View className="flex-1">
                  <Text className={cn("font-semibold text-base", isHere && "text-brand")}>{w.label}</Text>
                  <Text className="text-[13px] text-muted-foreground">
                    {w.tab_count} tab{w.tab_count === 1 ? "" : "s"} · {w.pane_count} pane{w.pane_count === 1 ? "" : "s"}
                    {isHere ? " · you are here" : ""}
                  </Text>
                </View>
                {w.agent_status !== "unknown" && <StatusGlyph status={w.agent_status} size={18} />}
              </Pressable>
              {open && (
                <View className="ml-[26px] gap-0.5">
                  {tabs.map((t) => {
                    const tabHere = currentPane?.tab_id === t.tab_id;
                    const agent = snap?.agents.find((a) => a.tab_id === t.tab_id);
                    const firstPane = snap ? panesOf(snap, t.tab_id)[0] : undefined;
                    return (
                      <Pressable
                        key={t.tab_id}
                        onPress={() => props.onOpenTab(t.tab_id)}
                        className={cn("flex-row items-center gap-3 rounded-lg px-3.5 py-[11px] active:opacity-80", tabHere && "bg-secondary")}
                      >
                        <Text className="min-w-[54px] font-medium text-[15px]">{tabName(t)}</Text>
                        <Text className="flex-1 font-mono text-xs text-faint" numberOfLines={1}>
                          {agent ? `${agentName(agent)} · ${statusLabel(agent.agent_status) || "agent"}` : shortCwd(firstPane?.foreground_cwd ?? firstPane?.cwd)}
                        </Text>
                        {t.pane_count > 1 && <Icon as={LayoutGrid} size={16} className="text-faint" />}
                      </Pressable>
                    );
                  })}
                  <Pressable className="flex-row items-center gap-2.5 px-3.5 py-2.5 active:opacity-80" onPress={() => props.onNewTab(w.workspace_id)}>
                    <Icon as={Plus} size={16} className="text-muted-foreground" />
                    <Text className="text-[15px] text-muted-foreground">New tab</Text>
                  </Pressable>
                </View>
              )}
            </View>
          );
        })}
      </ScrollView>

      <View className="flex-row items-center gap-2.5">
        <LinkIndicator conn={props.conn} />
        <View className="flex-1" />
        <Pill label="Computers" onPress={props.onHosts} height={40} icon={Monitor} />
      </View>
    </View>
  );
}
