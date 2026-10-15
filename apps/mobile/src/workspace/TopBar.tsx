import { tabName, type Agent, type Pane, type Tab, type Workspace } from "@corral/core";
import { ChevronDown, History, LayoutGrid, Menu, Plus } from "lucide-react-native";
import { useState } from "react";
import { Pressable, View } from "react-native";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Icon } from "@/components/ui/icon";
import { Text } from "@/components/ui/text";
import { cn } from "@/lib/utils";
import { useOverTerminal } from "../lib/overlay";
import { useApp, type ConnState } from "../lib/store";
import { Chip, IconButton, StatusGlyph } from "../ui/kit";

export function shortCwd(path?: string): string {
  if (!path) return "";
  const home = path.match(/^\/(home|Users)\/[^/]+/);
  const p = home ? "~" + path.slice(home[0].length) : path;
  const parts = p.split("/");
  return parts.length > 3 ? `…/${parts.slice(-2).join("/")}` : p;
}

export function TopBar(props: {
  workspace?: Workspace;
  tab?: Tab;
  tabs: Tab[];
  pane?: Pane;
  agent?: Agent;
  paneIndex: number;
  paneCount: number;
  blockedElsewhere: number;
  conn: ConnState;
  historyMode: boolean;
  onMenu(): void;
  onOpenTab(tabId: string): void;
  onNewTab(): void;
  onHistory(): void;
  onPaneMap(): void;
}) {
  const title = props.agent ? (props.agent.name ?? props.agent.agent) : shortCwd(props.pane?.foreground_cwd ?? props.pane?.cwd) || "terminal";
  const [tabsOpen, setTabsOpen] = useState(false);
  useOverTerminal(tabsOpen);
  return (
    <View className="flex-row items-center gap-2 px-2.5 py-1.5">
      <View>
        <IconButton icon={Menu} label="Open sidebar" onPress={props.onMenu} />
        {props.blockedElsewhere > 0 && <View className="absolute right-0.5 top-0.5 size-2.5 rounded-full border-2 border-background bg-warning" />}
      </View>
      <DropdownMenu onOpenChange={setTabsOpen}>
        <DropdownMenuTrigger asChild disabled={!props.workspace}>
          <Pressable className="flex-1 rounded-md px-1.5 py-0.5 active:bg-accent">
            <View className="flex-row items-center gap-[5px]">
              {/* On narrow screens the workspace name gives way first; the tab name is the useful part. */}
              {props.workspace && (
                <Text className="shrink text-xs text-muted-foreground" numberOfLines={1}>
                  {props.workspace.label}
                </Text>
              )}
              {props.workspace && props.tab && <Text className="text-xs text-muted-foreground">·</Text>}
              {props.tab && (
                <Text className="max-w-[140px] shrink-0 text-xs text-muted-foreground" numberOfLines={1}>
                  {tabName(props.tab)}
                </Text>
              )}
              {props.workspace && <Icon as={ChevronDown} size={13} className="text-faint" />}
            </View>
            <View className="flex-row items-center gap-[5px]">
              {props.agent && props.agent.agent_status !== "unknown" && <StatusGlyph status={props.agent.agent_status} size={11} />}
              <Text className="shrink font-semibold text-base" numberOfLines={1}>
                {title}
              </Text>
            </View>
          </Pressable>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" sideOffset={6} className="min-w-[200px] rounded-lg border-border bg-card py-1.5">
          {props.tabs.map((t) => {
            const current = t.tab_id === props.tab?.tab_id;
            return (
              <DropdownMenuItem key={t.tab_id} onPress={() => props.onOpenTab(t.tab_id)} className="h-[46px] gap-3 px-3.5">
                <View className="w-4 items-center">{t.agent_status !== "unknown" && <StatusGlyph status={t.agent_status} size={12} />}</View>
                <Text className={cn("flex-1 text-[15px]", current ? "font-semibold text-foreground" : "text-muted-foreground")}>{tabName(t)}</Text>
                {current && <View className="size-1.5 rounded-full bg-brand" />}
              </DropdownMenuItem>
            );
          })}
          <DropdownMenuSeparator className="my-1 bg-border" />
          <DropdownMenuItem onPress={props.onNewTab} className="h-[46px] gap-3 px-3.5">
            <View className="w-4 items-center">
              <Icon as={Plus} size={16} className="text-muted-foreground" />
            </View>
            <Text className="flex-1 text-[15px] text-foreground">New tab</Text>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <LinkIndicator conn={props.conn} />
      <IconButton icon={History} label="History" size={36} active={props.historyMode} onPress={props.onHistory} />
      <Chip label={`${props.paneIndex}/${props.paneCount}`} onPress={props.onPaneMap} height={36} tone="muted" icon={LayoutGrid} />
    </View>
  );
}

/** Reads the link itself: its latency changes often, and only this needs to redraw for it. */
export function LinkIndicator({ conn }: { conn: ConnState }) {
  const link = useApp((s) => s.link);
  let dot = "bg-idle";
  let label = "…";
  if (conn.kind === "reconnecting" || conn.kind === "connecting") {
    dot = "bg-warning";
    label = conn.kind === "connecting" ? "…" : "ssh…";
  } else if (link?.closed) {
    dot = "bg-destructive";
    label = "closed";
  } else if (link?.stale) {
    dot = "bg-warning";
    label = link.heardAgoSecs !== null ? `${link.heardAgoSecs}s` : "…";
  } else if (link?.rttMs !== null && link?.rttMs !== undefined) {
    dot = "bg-success";
    label = `${link.rttMs} ms`;
  } else if (link) {
    dot = "bg-success";
    label = "mosh";
  }
  return (
    <View className="flex-row items-center gap-[5px]">
      <View className={cn("size-[7px] rounded-full", dot)} />
      <Text className="font-mono text-[11px] text-muted-foreground">{label}</Text>
    </View>
  );
}
