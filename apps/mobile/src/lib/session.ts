import {
  AgentConnection,
  AgentError,
  HerdrApi,
  historyAbove,
  layoutScrollback,
  linkNeverHeard,
  MoshClient,
  Sealer,
  STALE_AFTER_MS,
  agentIn,
  primaryPane,
  tabsOf,
  type AttachResult,
  type HelloResult,
  type Link,
  type Snapshot,
  type SplitDirection,
} from "@corral/core";
import { AppState, type AppStateStatus } from "react-native";
import * as Network from "expo-network";
import { nativeUdp, setLowLatencyWifi } from "../../modules/corral-native";
import { agentUrl, loadToken, saveHosts, type Host } from "./hosts";
import { toast, useApp, type LinkUi } from "./store";

const SNAPSHOT_EVERY_MS = 5000;
const STALE_REATTACH_MS = 20_000;
const SCROLLBACK_LINES = 3000;
/** Wheel-down, to put a pane we scrolled back at its bottom before leaving it (herdr keeps the position). */
const WHEEL_DOWN = "\x1b[<65;1;1M";

/** A snapshot minus panes' scroll positions, which change with every wheel step and aren't shown. */
const snapshotKey = (s: Snapshot | null) => JSON.stringify(s, (k, v) => (k === "offset_from_bottom" ? undefined : v));

const set = useApp.setState;
const get = useApp.getState;

/**
 * One computer: the agent connection (reconnecting with backoff), the herdr session's snapshot
 * and events, and the one attached terminal. Writes everything the UI needs into the store.
 */
export class HostSession {
  readonly host: Host;
  private conn: AgentConnection | null = null;
  private closed = false;
  private attempt = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private refreshTimer: ReturnType<typeof setTimeout> | null = null;
  private refreshing = false;
  private refreshAgain = false;
  private watchKey = "";
  private grid: [number, number] = [0, 0];
  private attachSeq = 0;
  private terminalPort = 0;
  private offLink: (() => void) | null = null;
  private healthTimer: ReturnType<typeof setInterval> | null = null;
  private lastAutoReattach = 0;
  private foreground = AppState.currentState === "active";
  private subs: { remove(): void }[] = [];
  /** Wheel notches the live pane is scrolled up by (reported by the terminal view). */
  remoteNotches = 0;

  constructor(host: Host) {
    this.host = host;
    set({ activeHostId: host.id, session: host.session, snapshot: null, paneId: null, terminal: null, sessions: [], conn: { kind: "connecting" } });
    this.subs.push(AppState.addEventListener("change", (s) => this.onAppState(s)));
    this.subs.push(Network.addNetworkStateListener(() => this.networkChanged()));
    this.healthTimer = setInterval(() => this.checkTerminalHealth(), 5000);
    if (this.foreground) setLowLatencyWifi(true);
    void this.connect();
  }

  // ---------------------------------------------------------------- connection

  private async connect(): Promise<void> {
    if (this.closed) return;
    const token = await loadToken(this.host.id);
    if (!token) {
      set({ conn: { kind: "failed", reason: "This device isn't paired with that computer anymore.", unpaired: true } });
      return;
    }
    let conn: AgentConnection;
    try {
      conn = await AgentConnection.open(agentUrl(this.host));
    } catch (e) {
      return this.retry((e as Error).message);
    }
    if (this.closed) return conn.close();
    let hello: HelloResult;
    try {
      hello = await conn.call<HelloResult>("hello", { deviceId: this.host.deviceId, token });
    } catch (e) {
      conn.close();
      if (e instanceof AgentError && e.code === "unauthenticated") {
        set({ conn: { kind: "failed", reason: e.message, unpaired: true } });
        return;
      }
      return this.retry((e as Error).message);
    }
    this.conn = conn;
    this.attempt = 0;
    conn.onClose((reason) => {
      if (this.conn !== conn) return;
      this.conn = null;
      this.watchKey = "";
      this.retry(reason);
    });
    conn.onPush((p) => {
      if (p.event === "herdr") this.refreshSoon();
      else if (p.event === "herdr.watchEnded") {
        this.watchKey = "";
        setTimeout(() => this.refreshSoon(), 2000);
      }
    });
    const sessions = hello.sessions;
    const session = sessions.some((s) => s.name === get().session && s.running)
      ? get().session
      : (sessions.find((s) => s.default)?.name ?? sessions[0]?.name ?? "default");
    set({ sessions, session, conn: { kind: "online" } });
    // The saved session may be gone (or not offered); remember the one actually in use.
    if (session !== this.host.session) this.persist({ session });
    await this.refresh();
    if (!this.pollTimer) this.pollTimer = setInterval(() => this.refreshSoon(), SNAPSHOT_EVERY_MS);
    // First connect: open the last pane. Reconnect: the mosh session may still be fine; health checks reattach if not.
    if (!get().paneId) this.openPane(this.initialPane());
  }

  private retry(reason: string): void {
    if (this.closed) return;
    this.attempt++;
    set({ conn: { kind: "reconnecting", reason } });
    const delay = Math.min(10_000, 500 * 2 ** Math.min(this.attempt, 5));
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = setTimeout(() => void this.connect(), delay);
  }

  private herdr(): HerdrApi {
    if (!this.conn) throw new Error(`Not connected to ${this.host.name}`);
    return new HerdrApi(this.conn.herdr(get().session));
  }

  async close(): Promise<void> {
    this.closed = true;
    for (const s of this.subs) s.remove();
    for (const t of [this.reconnectTimer, this.refreshTimer]) if (t) clearTimeout(t);
    for (const t of [this.pollTimer, this.healthTimer]) if (t) clearInterval(t);
    setLowLatencyWifi(false);
    await this.releaseTerminal();
    this.conn?.close();
    this.conn = null;
    set({ activeHostId: null, conn: { kind: "idle" }, snapshot: null, paneId: null, terminal: null, link: null, scrollback: [], historyMode: false });
  }

  // ---------------------------------------------------------------- snapshot + events

  refreshSoon(): void {
    if (this.refreshTimer) return;
    this.refreshTimer = setTimeout(() => {
      this.refreshTimer = null;
      void this.refresh();
    }, 120);
  }

  /** Never cancels an in-flight fetch (a steady event stream would starve it); later requests collapse into one follow-up. */
  private async refresh(): Promise<void> {
    if (this.refreshing) {
      this.refreshAgain = true;
      return;
    }
    this.refreshing = true;
    try {
      const before = get().snapshot;
      const snapshot = await this.herdr().snapshot();
      // Polls mostly return what we already have; replacing it would redraw every screen that reads it.
      if (snapshotKey(before) !== snapshotKey(snapshot)) set({ snapshot });
      this.followClosedPane(before, snapshot);
      await this.ensureWatch(snapshot.panes.map((p) => p.pane_id));
    } catch {
      // The reconnect loop handles a dead link; a failed poll isn't worth surfacing.
    } finally {
      this.refreshing = false;
      if (this.refreshAgain) {
        this.refreshAgain = false;
        this.refreshSoon();
      }
    }
  }

  /** When the open pane closes (from here or on the computer), move to its neighbour instead of a dead screen. */
  private followClosedPane(before: Snapshot | null, after: Snapshot): void {
    const current = get().paneId;
    if (!current || after.panes.some((p) => p.pane_id === current)) return;
    const gone = before?.panes.find((p) => p.pane_id === current);
    if (!gone) return;
    const next =
      primaryPane(after, gone.tab_id) ??
      tabsOf(after, gone.workspace_id)
        .map((t) => primaryPane(after, t.tab_id))
        .find((p) => p !== undefined) ??
      after.panes[0];
    if (next) this.openPane(next.pane_id);
  }

  /** herdr's agent-status events are per pane, so re-subscribe when the set of panes changes. */
  private async ensureWatch(panes: string[]): Promise<void> {
    const key = `${get().session}|${[...panes].sort().join(",")}`;
    if (!this.conn || key === this.watchKey) return;
    this.watchKey = key;
    try {
      await this.conn.call("herdr.watch", { session: get().session, statusPanes: panes });
    } catch {
      this.watchKey = "";
    }
  }

  switchSession(name: string): void {
    if (name === get().session) return;
    void this.releaseTerminal();
    set({ session: name, snapshot: null, paneId: null });
    this.watchKey = "";
    this.persist({ session: name });
    void this.refresh().then(() => this.openPane(this.initialPane()));
  }

  private initialPane(): string | null {
    const snap = get().snapshot;
    if (!snap) return null;
    const last = this.host.lastPane[get().session];
    return (
      snap.panes.find((p) => p.pane_id === last)?.pane_id ??
      snap.panes.find((p) => p.pane_id === snap.focused_pane_id)?.pane_id ??
      snap.panes[0]?.pane_id ??
      null
    );
  }

  // ---------------------------------------------------------------- terminal

  setGrid(cols: number, rows: number): void {
    if (cols === this.grid[0] && rows === this.grid[1]) return;
    if (cols !== this.grid[0]) set({ scrollback: [], historyMode: false });
    this.grid = [cols, rows];
    get().terminal?.resize(cols, rows);
  }

  openPane(paneId: string | null, fresh = false): void {
    if (!paneId) return;
    const prev = get().paneId;
    set({ paneId, scrollback: [], historyMode: false, attachError: null });
    this.persist({ lastPane: { ...this.host.lastPane, [get().session]: paneId } });
    if (prev !== paneId || fresh || !get().terminal) void this.attach(paneId);
  }

  private async attach(paneId: string): Promise<void> {
    const seq = ++this.attachSeq;
    const pane = get().snapshot?.panes.find((p) => p.pane_id === paneId);
    if (!pane) {
      set({ attachError: "That pane is gone." });
      return;
    }
    await this.releaseTerminal(false);
    if (!this.conn || !this.foreground) return;
    set({ attaching: true, attachError: null });
    const [cols, rows] = this.grid[0] > 0 ? this.grid : [60, 30];
    try {
      const r = await this.conn.call<AttachResult>("terminal.attach", { session: get().session, terminalId: pane.terminal_id, cols, rows });
      if (seq !== this.attachSeq) return;
      const client = new MoshClient({ host: r.host, port: r.port, key: Sealer.decodeKey(r.key), cols, rows, transport: nativeUdp });
      this.terminalPort = r.port;
      if (this.grid[0] > 0) client.resize(this.grid[0], this.grid[1]);
      this.offLink = client.onLink((l) => this.publishLink(l));
      set({ terminal: client });
    } catch (e) {
      if (seq === this.attachSeq) set({ attachError: (e as Error).message });
    } finally {
      if (seq === this.attachSeq) set({ attaching: false });
    }
  }

  retryAttach(): void {
    const id = get().paneId;
    if (id) void this.attach(id);
  }

  /**
   * Lets go of the terminal: scrolls it back to the bottom if we scrolled it, ends the mosh
   * session and tells the agent, which ends the mosh-server so the pane gets its desktop size back.
   */
  private async releaseTerminal(clear = true): Promise<void> {
    const client = get().terminal;
    this.offLink?.();
    this.offLink = null;
    if (clear) set({ terminal: null, link: null });
    else set({ terminal: null });
    if (!client) return;
    const port = this.terminalPort;
    if (this.remoteNotches > 0) {
      client.write(new TextEncoder().encode(WHEEL_DOWN.repeat(this.remoteNotches + 2)));
      this.remoteNotches = 0;
      await sleep(400);
    }
    void client.close(800);
    try {
      await this.conn?.call("terminal.release", { port });
    } catch {
      // The agent ends it anyway when we disconnect.
    }
  }

  private publishLink(l: Link): void {
    const stale = l.closed === null && (l.heardAgoMs === null || l.heardAgoMs > STALE_AFTER_MS);
    const next: LinkUi = {
      rttMs: l.rttMs === null ? null : Math.round(l.rttMs / 5) * 5,
      stale,
      heardAgoSecs: stale && l.heardAgoMs !== null ? Math.floor(l.heardAgoMs / 1000) : null,
      closed: l.closed,
      neverHeard: linkNeverHeard(l),
    };
    const cur = get().link;
    if (!cur || JSON.stringify(cur) !== JSON.stringify(next)) set({ link: next });
  }

  /** If the terminal went silent (mosh-server timed out, agent released it) while we're online, reattach. */
  private checkTerminalHealth(): void {
    const t = get().terminal;
    if (!t || !this.conn || !this.foreground) return;
    const l = t.link;
    const silent = l.closed !== null || (l.heardAgoMs ?? l.ageMs) > STALE_REATTACH_MS;
    if (silent && Date.now() - this.lastAutoReattach > STALE_REATTACH_MS) {
      this.lastAutoReattach = Date.now();
      this.retryAttach();
    }
  }

  write(bytes: Uint8Array): void {
    get().terminal?.write(bytes);
  }

  nudge(): void {
    get().terminal?.nudge();
  }

  private networkChanged(): void {
    get().terminal?.networkChanged();
    if (!this.conn && !this.closed) {
      if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
      this.attempt = 0;
      void this.connect();
    }
  }

  /** Leaving the screen: let the pane go right away (no grace: the app may be killed from the switcher). */
  private onAppState(s: AppStateStatus): void {
    const fg = s === "active";
    if (fg === this.foreground) return;
    this.foreground = fg;
    setLowLatencyWifi(fg);
    if (!fg) {
      void this.releaseTerminal(false);
    } else {
      this.networkChanged();
      this.refreshSoon();
      const id = get().paneId;
      if (id && !get().terminal) void this.attach(id);
    }
  }

  // ---------------------------------------------------------------- history

  /** The History button: herdr's history above the screen, read at one content revision and laid out locally. */
  async openHistory(cols: number): Promise<void> {
    const paneId = get().paneId;
    if (!paneId || cols <= 0) return;
    try {
      const api = this.herdr();
      let lines: string[] = [];
      for (let i = 0; i < 3; i++) {
        const [visible, recent] = await Promise.all([
          api.readPane(paneId, "visible", { ansi: true }),
          api.readPane(paneId, "recent", { lines: SCROLLBACK_LINES, ansi: true }),
        ]);
        lines = historyAbove(recent.text, visible.text);
        if (visible.revision === recent.revision) break;
      }
      if (get().paneId !== paneId) return;
      if (lines.length === 0) {
        toast("No history outside the app here. Drag the terminal to scroll the app itself.");
        return;
      }
      set({ scrollback: layoutScrollback(lines, cols), historyMode: true });
    } catch (e) {
      toast((e as Error).message);
    }
  }

  closeHistory(): void {
    set({ historyMode: false });
  }

  // ---------------------------------------------------------------- actions

  private act(label: string, fn: (api: HerdrApi) => Promise<unknown>): void {
    void (async () => {
      try {
        await fn(this.herdr());
        this.refreshSoon();
      } catch (e) {
        toast(`${label}: ${(e as Error).message}`);
      }
    })();
  }

  sendKeys(paneId: string, keys: string[]): void {
    this.act("Keys", (api) => api.sendKeys(paneId, keys));
  }

  /** A prompt goes through herdr's agent API when the pane has an agent, else as a typed line. */
  submit(text: string): void {
    const paneId = get().paneId;
    const snap = get().snapshot;
    if (!paneId || !snap) return;
    const agent = agentIn(snap, paneId);
    this.act("Send", (api) => (agent ? api.promptAgent(paneId, text) : api.sendText(paneId, text, true)));
  }

  split(paneId: string, direction: SplitDirection): void {
    this.act("Split", async (api) => {
      const pane = await api.splitPane(paneId, direction);
      await this.refresh();
      this.openPane(pane.pane_id);
    });
  }

  closePane(paneId: string): void {
    this.act("Close", (api) => api.closePane(paneId));
  }

  newTab(workspaceId: string): void {
    this.act("New tab", async (api) => {
      const pane = await api.createTab(workspaceId);
      await this.refresh();
      if (pane) this.openPane(pane.pane_id);
    });
  }

  newWorkspace(label?: string): void {
    this.act("New workspace", async (api) => {
      const pane = await api.createWorkspace(label);
      await this.refresh();
      if (pane) this.openPane(pane.pane_id);
    });
  }

  renameTab(tabId: string, label: string): void {
    this.act("Rename", (api) => api.renameTab(tabId, label));
  }

  startAgent(paneId: string, kind: string): void {
    const taken = new Set((get().snapshot?.agents ?? []).map((a) => a.name ?? a.agent));
    let name = kind;
    for (let i = 2; taken.has(name); i++) name = `${kind}-${i}`;
    this.act(`Start ${kind}`, (api) => api.startAgent(name, kind, paneId));
  }

  readVisible(paneId: string): Promise<string> {
    return this.herdr().readPane(paneId, "visible").then((r) => r.text);
  }

  private persist(patch: Partial<Host>): void {
    Object.assign(this.host, patch);
    const hosts = get().hosts.map((h) => (h.id === this.host.id ? { ...this.host } : h));
    set({ hosts });
    void saveHosts(hosts);
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

let current: HostSession | null = null;

export function openHost(host: Host): HostSession {
  if (current && current.host.id === host.id) return current;
  void current?.close();
  current = new HostSession(host);
  return current;
}

export function activeSession(): HostSession | null {
  return current;
}

export async function closeHost(): Promise<void> {
  const s = current;
  current = null;
  await s?.close();
}
