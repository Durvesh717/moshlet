import type { AgentStatus, Agent, Layout, Pane, Rect, Snapshot, Tab, Workspace } from "./model.ts";

/**
 * herdr's JSON, checked against what Moshlet's types promise. herdr is young and its output can
 * differ from them (an agent it can't identify comes without `agent`), and a screen that trusts a
 * cast breaks on the first missing list. Here a missing list is empty, an entry without its ids is
 * dropped, and a missing name, number or status gets a default. Other fields pass through as they are.
 */

type Json = Record<string, unknown>;

const isObject = (v: unknown): v is Json => typeof v === "object" && v !== null && !Array.isArray(v);
const objects = (v: unknown): Json[] => (Array.isArray(v) ? v.filter(isObject) : []);
const hasIds = (o: Json, ...keys: string[]): boolean => keys.every((k) => typeof o[k] === "string");
const text = (v: unknown): string => (typeof v === "string" ? v : "");
const count = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) ? v : 0);
const flag = (v: unknown): boolean => v === true;

const STATUSES: readonly string[] = ["idle", "working", "blocked", "done", "unknown"] satisfies AgentStatus[];
const status = (v: unknown): AgentStatus => (typeof v === "string" && STATUSES.includes(v) ? (v as AgentStatus) : "unknown");

const rect = (v: unknown): Rect => (isObject(v) ? { x: count(v.x), y: count(v.y), width: count(v.width), height: count(v.height) } : { x: 0, y: 0, width: 0, height: 0 });

function workspace(o: Json): Workspace | undefined {
  if (!hasIds(o, "workspace_id")) return undefined;
  return { ...o, label: text(o.label), number: count(o.number), agent_status: status(o.agent_status), tab_count: count(o.tab_count), pane_count: count(o.pane_count), focused: flag(o.focused) } as Workspace;
}

function tab(o: Json): Tab | undefined {
  if (!hasIds(o, "tab_id", "workspace_id")) return undefined;
  return { ...o, label: text(o.label), number: count(o.number), pane_count: count(o.pane_count), agent_status: status(o.agent_status), focused: flag(o.focused) } as Tab;
}

export function decodePane(o: unknown): Pane | undefined {
  if (!isObject(o) || !hasIds(o, "pane_id", "tab_id", "workspace_id")) return undefined;
  return { ...o, terminal_id: text(o.terminal_id), agent_status: status(o.agent_status), focused: flag(o.focused), revision: count(o.revision) } as Pane;
}

function agent(o: Json): Agent | undefined {
  if (!hasIds(o, "pane_id", "tab_id", "workspace_id")) return undefined;
  return { ...o, agent: text(o.agent), agent_status: status(o.agent_status), focused: flag(o.focused) } as Agent;
}

function layout(o: Json): Layout | undefined {
  if (!hasIds(o, "tab_id")) return undefined;
  const panes = objects(o.panes)
    .filter((p) => hasIds(p, "pane_id"))
    .map((p) => ({ ...p, pane_id: p.pane_id as string, rect: rect(p.rect), focused: flag(p.focused) }));
  return { ...o, workspace_id: text(o.workspace_id), area: rect(o.area), panes, zoomed: flag(o.zoomed) } as Layout;
}

const keep = <T>(list: Json[], decode: (o: Json) => T | undefined): T[] => list.map(decode).filter((x): x is T => x !== undefined);

export function decodeSnapshot(raw: unknown): Snapshot {
  const s = isObject(raw) ? raw : {};
  return {
    ...s,
    workspaces: keep(objects(s.workspaces), workspace),
    tabs: keep(objects(s.tabs), tab),
    panes: keep(objects(s.panes), decodePane),
    agents: keep(objects(s.agents), agent),
    layouts: keep(objects(s.layouts), layout),
  } as Snapshot;
}
