/**
 * herdr's session model, with herdr's own JSON field names so snapshots pass straight through
 * the agent to the app. Only the fields Moshlet uses are typed.
 */

export type AgentStatus = "idle" | "working" | "blocked" | "done" | "unknown";

/** Lower sorts first: the things that need you go on top. */
export const urgency = (s: AgentStatus): number => ({ blocked: 0, done: 1, working: 2, idle: 3, unknown: 4 })[s] ?? 4;

export interface Workspace {
  workspace_id: string;
  label: string;
  number: number;
  agent_status: AgentStatus;
  tab_count: number;
  pane_count: number;
  active_tab_id?: string;
  focused: boolean;
}

export interface Tab {
  tab_id: string;
  workspace_id: string;
  label: string;
  number: number;
  pane_count: number;
  agent_status: AgentStatus;
  focused: boolean;
}

export interface PaneScroll {
  max_offset_from_bottom: number;
  offset_from_bottom: number;
  viewport_rows: number;
}

export interface Pane {
  pane_id: string;
  tab_id: string;
  workspace_id: string;
  terminal_id: string;
  cwd?: string;
  foreground_cwd?: string;
  agent?: string;
  agent_status: AgentStatus;
  terminal_title_stripped?: string;
  focused: boolean;
  revision: number;
  scroll?: PaneScroll;
}

export interface Agent {
  agent: string;
  name?: string;
  pane_id: string;
  tab_id: string;
  workspace_id: string;
  terminal_id?: string;
  agent_status: AgentStatus;
  cwd?: string;
  terminal_title_stripped?: string;
  focused: boolean;
}

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface Layout {
  tab_id: string;
  workspace_id: string;
  area: Rect;
  panes: { pane_id: string; rect: Rect; focused: boolean }[];
  focused_pane_id?: string;
  zoomed: boolean;
}

export interface Snapshot {
  workspaces: Workspace[];
  tabs: Tab[];
  panes: Pane[];
  agents: Agent[];
  layouts: Layout[];
  focused_workspace_id?: string;
  focused_tab_id?: string;
  focused_pane_id?: string;
  version?: string;
}

export type ReadSource = "visible" | "recent" | "recent_unwrapped" | "detection";
export type SplitDirection = "right" | "down";

// ---- lookups

export const tabsOf = (s: Snapshot, workspaceId: string): Tab[] =>
  s.tabs.filter((t) => t.workspace_id === workspaceId).sort((a, b) => a.number - b.number);

export const panesOf = (s: Snapshot, tabId: string): Pane[] => s.panes.filter((p) => p.tab_id === tabId);

export const agentIn = (s: Snapshot, paneId: string): Agent | undefined => s.agents.find((a) => a.pane_id === paneId);

/** The pane a tab would show first: its focused pane, else its first. */
export function primaryPane(s: Snapshot, tabId: string): Pane | undefined {
  const focused = s.layouts.find((l) => l.tab_id === tabId)?.focused_pane_id;
  const panes = panesOf(s, tabId);
  return panes.find((p) => p.pane_id === focused) ?? panes[0];
}

/** A tab's panes in reading order (top-left first), for swiping between them. */
export function orderedPanes(s: Snapshot, tabId: string): Pane[] {
  const rects = new Map((s.layouts.find((l) => l.tab_id === tabId)?.panes ?? []).map((p) => [p.pane_id, p.rect]));
  return panesOf(s, tabId).sort((a, b) => {
    const ra = rects.get(a.pane_id);
    const rb = rects.get(b.pane_id);
    if (!ra || !rb) return 0;
    return ra.y - rb.y || ra.x - rb.x;
  });
}

/** herdr labels new tabs with their number; show those as "Tab N". */
export const tabName = (t: Tab): string => (t.label.trim() === "" || t.label === String(t.number) ? `Tab ${t.number}` : t.label);

/** Its name in herdr, else its kind ("claude"); herdr leaves the kind out when it can't tell. */
export const agentName = (a: Agent): string => a.name || a.agent || "agent";

/** "p3" from "w2:p3". */
export const shortPaneId = (id: string): string => id.slice(id.indexOf(":") + 1);

/**
 * herdr holds no history for the pane: a full-screen app (Claude Code, an editor) keeps its own,
 * and herdr hands wheel events to it instead of scrolling.
 */
export const appOwnsScroll = (p: Pane): boolean => p.scroll?.max_offset_from_bottom === 0;
