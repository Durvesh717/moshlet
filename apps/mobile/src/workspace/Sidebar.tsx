import { agentName, panesOf, tabName, tabsOf, urgency, type SessionInfo, type Snapshot } from "@corral/core";
import { ChevronDown, ChevronRight, ChevronsUpDown, LayoutGrid, Monitor, Plus, Search } from "lucide-react-native";
import { useMemo, useState } from "react";
import { Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import type { ConnState } from "../lib/store";
import { C, F, R } from "../theme";
import { Chip, SectionLabel, StatusGlyph, statusLabel } from "../ui/kit";
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
  const [sessionsOpen, setSessionsOpen] = useState(false);
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
    <View style={[styles.root, { paddingTop: insets.top + 12, paddingBottom: insets.bottom + 10, paddingLeft: insets.left + 16 }]}>
      <Pressable
        style={styles.header}
        onPress={() => {
          setSessionsOpen(true);
          props.onRefreshSessions();
        }}
      >
        <View style={styles.hostIcon}>
          <Text style={styles.hostLetter}>{props.hostName.slice(0, 1).toLowerCase()}</Text>
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.hostName} numberOfLines={1}>
            {props.hostName}
          </Text>
          <Text style={styles.sessionName}>{props.session} session</Text>
        </View>
        <View style={styles.switchBtn}>
          <ChevronsUpDown size={18} color={C.text} />
        </View>
      </Pressable>

      <View style={styles.search}>
        <Search size={16} color={C.faint} />
        <TextInput value={query} onChangeText={setQuery} placeholder="Jump to…" placeholderTextColor={C.faint} style={styles.searchInput} autoCorrect={false} autoCapitalize="none" />
      </View>

      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ gap: 6, paddingBottom: 12 }}>
        <SectionLabel right={<Text style={styles.sectionHint}>needs-you first</Text>}>{`Agents ${agents.length}`}</SectionLabel>
        {agents.length === 0 && <Text style={styles.empty}>{q ? "No agents match." : "No agents running."}</Text>}
        {agents.map((a) => {
          const ws = snap?.workspaces.find((w) => w.workspace_id === a.workspace_id);
          const tab = snap?.tabs.find((t) => t.tab_id === a.tab_id);
          const here = a.pane_id === props.paneId;
          return (
            <Pressable key={a.pane_id} onPress={() => props.onOpenPane(a.pane_id)} style={({ pressed }) => [styles.agent, here && styles.here, pressed && { opacity: 0.8 }]}>
              <StatusGlyph status={a.agent_status} size={16} />
              <View style={{ flex: 1, gap: 2 }}>
                <Text style={styles.agentName}>{agentName(a)}</Text>
                {!!a.terminal_title_stripped && (
                  <Text style={styles.agentDetail} numberOfLines={1}>
                    {a.terminal_title_stripped}
                  </Text>
                )}
                <Text style={styles.agentWhere} numberOfLines={1}>
                  {ws?.label} · {tab ? tabName(tab) : ""}
                </Text>
              </View>
              {a.agent_status === "blocked" && <Text style={styles.needs}>{statusLabel("blocked")}</Text>}
            </Pressable>
          );
        })}

        <View style={styles.divider} />
        <SectionLabel
          right={
            <Pressable onPress={props.onNewWorkspace} hitSlop={10} accessibilityLabel="New workspace">
              <Plus size={20} color={C.muted} />
            </Pressable>
          }
        >{`Workspaces ${workspaces.length}`}</SectionLabel>
        {workspaces.map((w) => {
          const isHere = currentPane?.workspace_id === w.workspace_id;
          const open = expanded[w.workspace_id] ?? isHere;
          const tabs = snap ? tabsOf(snap, w.workspace_id) : [];
          return (
            <View key={w.workspace_id}>
              <Pressable style={styles.ws} onPress={() => setExpanded({ ...expanded, [w.workspace_id]: !open })}>
                {open ? <ChevronDown size={18} color={C.muted} /> : <ChevronRight size={18} color={C.muted} />}
                <View style={{ flex: 1 }}>
                  <Text style={[styles.wsName, isHere && { color: C.accent }]}>{w.label}</Text>
                  <Text style={styles.wsMeta}>
                    {w.tab_count} tab{w.tab_count === 1 ? "" : "s"} · {w.pane_count} pane{w.pane_count === 1 ? "" : "s"}
                    {isHere ? " · you are here" : ""}
                  </Text>
                </View>
                {w.agent_status !== "unknown" && <StatusGlyph status={w.agent_status} size={18} />}
              </Pressable>
              {open && (
                <View style={styles.tabs}>
                  {tabs.map((t) => {
                    const tabHere = currentPane?.tab_id === t.tab_id;
                    const agent = snap?.agents.find((a) => a.tab_id === t.tab_id);
                    const firstPane = snap ? panesOf(snap, t.tab_id)[0] : undefined;
                    return (
                      <Pressable key={t.tab_id} onPress={() => props.onOpenTab(t.tab_id)} style={({ pressed }) => [styles.tab, tabHere && styles.tabHere, pressed && { opacity: 0.8 }]}>
                        <Text style={styles.tabName}>{tabName(t)}</Text>
                        <Text style={styles.tabDetail} numberOfLines={1}>
                          {agent ? `${agentName(agent)} · ${statusLabel(agent.agent_status) || "agent"}` : shortCwd(firstPane?.foreground_cwd ?? firstPane?.cwd)}
                        </Text>
                        {t.pane_count > 1 && <LayoutGrid size={16} color={C.faint} />}
                      </Pressable>
                    );
                  })}
                  <Pressable style={styles.newTab} onPress={() => props.onNewTab(w.workspace_id)}>
                    <Plus size={16} color={C.muted} />
                    <Text style={styles.newTabText}>New tab</Text>
                  </Pressable>
                </View>
              )}
            </View>
          );
        })}
      </ScrollView>

      <View style={styles.footer}>
        <LinkIndicator conn={props.conn} />
        <View style={{ flex: 1 }} />
        <Chip label="Computers" onPress={props.onHosts} height={40} leading={<Monitor size={16} color={C.text} />} />
      </View>

      <Modal visible={sessionsOpen} transparent animationType="fade" onRequestClose={() => setSessionsOpen(false)}>
        <Pressable style={styles.scrim} onPress={() => setSessionsOpen(false)}>
          <View style={styles.sessions}>
            <Text style={styles.sessionsTitle}>herdr sessions on {props.hostName}</Text>
            {props.sessions.map((s) => (
              <Pressable
                key={s.name}
                disabled={!s.running}
                onPress={() => {
                  setSessionsOpen(false);
                  props.onSwitchSession(s.name);
                }}
                style={({ pressed }) => [styles.sessionRow, pressed && { backgroundColor: C.surface2 }]}
              >
                <Text style={[styles.sessionRowText, s.name === props.session && { color: C.accent, fontFamily: F.semibold }, !s.running && { color: C.idle }]}>
                  {s.name}
                  {s.default ? " (default)" : ""}
                  {!s.running ? " · stopped" : ""}
                </Text>
              </Pressable>
            ))}
          </View>
        </Pressable>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: C.drawer, paddingHorizontal: 16, gap: 14, borderTopRightRadius: 20, borderBottomRightRadius: 20 },
  header: { flexDirection: "row", alignItems: "center", gap: 12 },
  hostIcon: { width: 46, height: 46, borderRadius: 14, backgroundColor: C.accentStrong, alignItems: "center", justifyContent: "center" },
  hostLetter: { fontFamily: F.bold, fontSize: 22, color: "#fff", marginTop: -2 },
  hostName: { fontFamily: F.semibold, fontSize: 18, color: C.text },
  sessionName: { fontFamily: F.regular, fontSize: 14, color: C.muted },
  switchBtn: { width: 40, height: 40, borderRadius: R.md, backgroundColor: C.surface2, borderColor: C.line2, borderWidth: 1, alignItems: "center", justifyContent: "center" },
  search: { flexDirection: "row", alignItems: "center", gap: 8, height: 46, borderRadius: R.lg, borderWidth: 1, borderColor: C.line2, paddingHorizontal: 14 },
  searchInput: { flex: 1, color: C.text, fontFamily: F.regular, fontSize: 15 },
  sectionHint: { fontFamily: F.regular, fontSize: 12, color: C.faint },
  empty: { fontFamily: F.regular, fontSize: 15, color: C.muted, paddingVertical: 8, paddingHorizontal: 4 },
  agent: { flexDirection: "row", alignItems: "center", gap: 12, padding: 12, borderRadius: R.lg },
  here: { backgroundColor: C.surface2 },
  agentName: { fontFamily: F.semibold, fontSize: 16, color: C.text },
  agentDetail: { fontFamily: F.regular, fontSize: 13, color: C.muted },
  agentWhere: { fontFamily: F.regular, fontSize: 12, color: C.faint },
  needs: { fontFamily: F.semibold, fontSize: 12, color: C.blocked, backgroundColor: C.blockedBg, paddingHorizontal: 10, paddingVertical: 4, borderRadius: R.pill, overflow: "hidden" },
  divider: { height: 1, backgroundColor: C.line, marginVertical: 8 },
  ws: { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 10, paddingHorizontal: 4 },
  wsName: { fontFamily: F.semibold, fontSize: 16, color: C.text },
  wsMeta: { fontFamily: F.regular, fontSize: 13, color: C.muted },
  tabs: { marginLeft: 26, gap: 2 },
  tab: { flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 11, paddingHorizontal: 14, borderRadius: R.lg },
  tabHere: { backgroundColor: C.surface2 },
  tabName: { fontFamily: F.medium, fontSize: 15, color: C.text, minWidth: 54 },
  tabDetail: { flex: 1, fontFamily: F.mono, fontSize: 12, color: C.faint },
  newTab: { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 10, paddingHorizontal: 14 },
  newTabText: { fontFamily: F.regular, fontSize: 15, color: C.muted },
  footer: { flexDirection: "row", alignItems: "center", gap: 10 },
  scrim: { flex: 1, backgroundColor: C.scrim, justifyContent: "center", padding: 28 },
  sessions: { backgroundColor: C.surface, borderRadius: R.xl, borderColor: C.line2, borderWidth: 1, paddingVertical: 10 },
  sessionsTitle: { fontFamily: F.semibold, fontSize: 13, color: C.muted, paddingHorizontal: 18, paddingVertical: 8, letterSpacing: 0.5 },
  sessionRow: { paddingHorizontal: 18, paddingVertical: 14 },
  sessionRowText: { fontFamily: F.regular, fontSize: 16, color: C.text },
});
