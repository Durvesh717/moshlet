import type { Pane, ReadSource, Snapshot, SplitDirection } from "./model.ts";

/** Sends one request to herdr's socket API (over SSH on a phone, through herdr's stdio bridge). */
export type HerdrCall = (method: string, params?: Record<string, unknown>) => Promise<Record<string, unknown>>;

export class HerdrError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.code = code;
  }
}

/** Session-wide events worth a fresh snapshot. Agent status events need one subscription per pane. */
export const GLOBAL_EVENTS = [
  "workspace.created", "workspace.updated", "workspace.renamed", "workspace.closed", "workspace.reordered",
  "tab.created", "tab.closed", "tab.renamed", "tab.moved",
  "pane.created", "pane.closed", "pane.updated", "pane.moved", "pane.exited", "pane.agent_detected",
  "layout.updated",
] as const;

export function subscriptions(statusPanes: readonly string[]): Record<string, string>[] {
  return [
    ...GLOBAL_EVENTS.map((type) => ({ type })),
    ...statusPanes.map((pane_id) => ({ type: "pane.agent_status_changed", pane_id })),
  ];
}

export interface PaneText {
  text: string;
  revision: number;
}

/** Typed wrappers over herdr's API methods that Moshlet uses. */
export class HerdrApi {
  private readonly call: HerdrCall;

  constructor(call: HerdrCall) {
    this.call = call;
  }

  async ping(): Promise<string | undefined> {
    return (await this.call("ping")).version as string | undefined;
  }

  async snapshot(): Promise<Snapshot> {
    return (await this.call("session.snapshot")).snapshot as Snapshot;
  }

  /** A pane read plus herdr's content revision, so two reads can be matched up. */
  async readPane(paneId: string, source: ReadSource, opts: { lines?: number; ansi?: boolean } = {}): Promise<PaneText> {
    const read = (await this.call("pane.read", {
      pane_id: paneId,
      source,
      ...(opts.lines !== undefined ? { lines: opts.lines } : {}),
      format: opts.ansi ? "ansi" : "text",
      strip_ansi: !opts.ansi,
    })).read as { text?: string; revision?: number } | undefined;
    return { text: read?.text ?? "", revision: read?.revision ?? -1 };
  }

  /** Logical key names as herdr understands them: "enter", "esc", "ctrl+c", "1", "y"... */
  async sendKeys(paneId: string, keys: string[]): Promise<void> {
    await this.call("pane.send_keys", { pane_id: paneId, keys });
  }

  async sendText(paneId: string, text: string, thenEnter: boolean): Promise<void> {
    await this.call("pane.send_input", { pane_id: paneId, text, ...(thenEnter ? { keys: ["enter"] } : {}) });
  }

  /** Submits a prompt the way herdr does it for agents (bracketed-paste aware, then Enter). */
  async promptAgent(target: string, text: string): Promise<void> {
    await this.call("agent.prompt", { target, text });
  }

  async splitPane(paneId: string, direction: SplitDirection): Promise<Pane> {
    return (await this.call("pane.split", { target_pane_id: paneId, direction, focus: false })).pane as Pane;
  }

  async closePane(paneId: string): Promise<void> {
    await this.call("pane.close", { pane_id: paneId });
  }

  async createTab(workspaceId: string): Promise<Pane | undefined> {
    return (await this.call("tab.create", { workspace_id: workspaceId, focus: false })).root_pane as Pane | undefined;
  }

  async renameTab(tabId: string, label: string): Promise<void> {
    await this.call("tab.rename", { tab_id: tabId, label });
  }

  async createWorkspace(label?: string): Promise<Pane | undefined> {
    return (await this.call("workspace.create", { ...(label ? { label } : {}), focus: false })).root_pane as Pane | undefined;
  }

  async startAgent(name: string, kind: string, paneId: string): Promise<void> {
    await this.call("agent.start", { name, kind, pane_id: paneId });
  }
}
