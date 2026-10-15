import { tabName, type Agent, type Pane, type Tab, type Workspace } from "@corral/core";
import { ChevronDown, History, LayoutGrid, Menu, Plus } from "lucide-react-native";
import { useState } from "react";
import { Modal, Pressable, StyleSheet, Text, View } from "react-native";
import { useApp, type ConnState } from "../lib/store";
import { C, F, R } from "../theme";
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
  const [tabsOpen, setTabsOpen] = useState(false);
  const title = props.agent ? (props.agent.name ?? props.agent.agent) : shortCwd(props.pane?.foreground_cwd ?? props.pane?.cwd) || "terminal";
  return (
    <View style={styles.bar}>
      <View>
        <IconButton icon={Menu} label="Open sidebar" onPress={props.onMenu} />
        {props.blockedElsewhere > 0 && <View style={styles.badge} />}
      </View>
      <Pressable style={styles.titleBox} onPress={() => props.workspace && setTabsOpen(true)}>
        <View style={styles.row}>
          {/* On narrow screens the workspace name gives way first; the tab name is the useful part. */}
          {props.workspace && (
            <Text style={styles.crumb} numberOfLines={1}>
              {props.workspace.label}
            </Text>
          )}
          {props.workspace && props.tab && <Text style={styles.crumbTab}>·</Text>}
          {props.tab && (
            <Text style={styles.crumbTab} numberOfLines={1}>
              {tabName(props.tab)}
            </Text>
          )}
          {props.workspace && <ChevronDown size={13} color={C.faint} />}
        </View>
        <View style={styles.row}>
          {props.agent && props.agent.agent_status !== "unknown" && <StatusGlyph status={props.agent.agent_status} size={11} />}
          <Text style={styles.title} numberOfLines={1}>
            {title}
          </Text>
        </View>
      </Pressable>
      <LinkIndicator conn={props.conn} />
      <IconButton icon={History} label="History" size={36} active={props.historyMode} onPress={props.onHistory} />
      <Chip
        label={`${props.paneIndex}/${props.paneCount}`}
        onPress={props.onPaneMap}
        height={36}
        background={C.surface}
        border={C.line}
        color={C.muted}
        leading={<LayoutGrid size={15} color={C.muted} />}
      />

      <Modal visible={tabsOpen} transparent animationType="fade" onRequestClose={() => setTabsOpen(false)}>
        <Pressable style={StyleSheet.absoluteFill} onPress={() => setTabsOpen(false)}>
          <View style={styles.menu}>
            {props.tabs.map((t) => {
              const current = t.tab_id === props.tab?.tab_id;
              return (
                <Pressable
                  key={t.tab_id}
                  style={({ pressed }) => [styles.menuItem, pressed && { backgroundColor: C.surface2 }]}
                  onPress={() => {
                    setTabsOpen(false);
                    props.onOpenTab(t.tab_id);
                  }}
                >
                  <View style={styles.menuIcon}>{t.agent_status !== "unknown" && <StatusGlyph status={t.agent_status} size={12} />}</View>
                  <Text style={[styles.menuText, current && styles.menuCurrent]}>{tabName(t)}</Text>
                  {current && <View style={styles.dot} />}
                </Pressable>
              );
            })}
            <View style={styles.divider} />
            <Pressable
              style={({ pressed }) => [styles.menuItem, pressed && { backgroundColor: C.surface2 }]}
              onPress={() => {
                setTabsOpen(false);
                props.onNewTab();
              }}
            >
              <View style={styles.menuIcon}>
                <Plus size={16} color={C.muted} />
              </View>
              <Text style={[styles.menuText, { color: C.text }]}>New tab</Text>
            </Pressable>
          </View>
        </Pressable>
      </Modal>
    </View>
  );
}

/** Reads the link itself: its latency changes often, and only this needs to redraw for it. */
export function LinkIndicator({ conn }: { conn: ConnState }) {
  const link = useApp((s) => s.link);
  let dot: string = C.idle;
  let label = "…";
  if (conn.kind === "reconnecting" || conn.kind === "connecting") {
    dot = C.blocked;
    label = conn.kind === "connecting" ? "…" : "agent…";
  } else if (link?.closed) {
    dot = C.danger;
    label = "closed";
  } else if (link?.stale) {
    dot = C.blocked;
    label = link.heardAgoSecs !== null ? `${link.heardAgoSecs}s` : "…";
  } else if (link?.rttMs !== null && link?.rttMs !== undefined) {
    dot = C.done;
    label = `${link.rttMs} ms`;
  } else if (link) {
    dot = C.done;
    label = "mosh";
  }
  return (
    <View style={styles.link}>
      <View style={[styles.linkDot, { backgroundColor: dot }]} />
      <Text style={styles.linkText}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  bar: { flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 10, paddingTop: 6, paddingBottom: 6 },
  badge: { position: "absolute", top: 2, right: 2, width: 10, height: 10, borderRadius: 5, backgroundColor: C.blocked, borderWidth: 2, borderColor: C.ground },
  titleBox: { flex: 1, paddingHorizontal: 6, paddingVertical: 2, borderRadius: R.md },
  row: { flexDirection: "row", alignItems: "center", gap: 5 },
  crumb: { fontFamily: F.regular, fontSize: 12, color: C.muted, flexShrink: 1 },
  crumbTab: { fontFamily: F.regular, fontSize: 12, color: C.muted, flexShrink: 0, maxWidth: 140 },
  title: { fontFamily: F.semibold, fontSize: 16, color: C.text, flexShrink: 1 },
  link: { flexDirection: "row", alignItems: "center", gap: 5 },
  linkDot: { width: 7, height: 7, borderRadius: 4 },
  linkText: { fontFamily: F.mono, fontSize: 11, color: C.muted },
  menu: {
    position: "absolute",
    top: 96,
    left: 62,
    minWidth: 200,
    backgroundColor: C.surface,
    borderColor: C.line,
    borderWidth: 1,
    borderRadius: R.lg,
    paddingVertical: 6,
  },
  menuItem: { flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 14, height: 46 },
  menuIcon: { width: 16, alignItems: "center" },
  menuText: { fontFamily: F.regular, fontSize: 15, color: C.muted, flex: 1 },
  menuCurrent: { fontFamily: F.semibold, color: C.text },
  dot: { width: 6, height: 6, borderRadius: 3, backgroundColor: C.accent },
  divider: { height: 1, backgroundColor: C.line, marginVertical: 4 },
});
