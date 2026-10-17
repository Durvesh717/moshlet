import {
  HerdrApi,
  HostLink,
  ShellError,
  historyAbove,
  layoutScrollback,
  linkNeverHeard,
  MoshClient,
  Sealer,
  STALE_AFTER_MS,
  agentIn,
  agentName,
  parseApproval,
  primaryPane,
  tabName,
  tabsOf,
  type Link,
  type Snapshot,
  type SplitDirection,
} from "@moshlet/core";
import { AppState, type AppStateStatus } from "react-native";
import * as Network from "expo-network";
import { alerts, nativeUdp, setLowLatencyWifi } from "../../modules/moshlet-native";
import type { SshConnection } from "../../modules/moshlet-native/ssh";
import { saveHosts, type Host } from "./hosts";
import { deviceIdentity, signIn, SignInError } from "./ssh";
import { toast, useApp, type LinkUi } from "./store";

const SNAPSHOT_EVERY_MS = 5000;
const STALE_REATTACH_MS = 20_000;
/** A quick command that proves the SSH link still works (after sleep, or a network change). */
const PROBE_TIMEOUT_MS = 5000;
const SCROLLBACK_LINES = 3000;
/** Wheel-down, to put a pane we scrolled back at its bottom before leaving it (herdr keeps the position). */
const WHEEL_DOWN = "\x1b[<65;1;1M";

/** A snapshot minus panes' scroll positions, which change with every wheel step and aren't shown. */
const snapshotKey = (s: Snapshot | null) => JSON.stringify(s, (k, v) => (k === "offset_from_bottom" ? undefined : v));

const set = useApp.setState;
const get = useApp.getState;

/**
 * One computer: the SSH connection (reconnecting with backoff), the herdr session's snapshot and
 * events, and the one attached terminal. Writes everything the UI needs into the store. The
 * terminal runs over mosh, so it keeps going while SSH reconnects.
 */
export class HostSession {
  readonly host: Host;
  private conn: SshConnection | null = null;
  private link: HostLink | null = null;
  /** Marks this device's mosh-servers on the computer (from its key's fingerprint). */
  private tag = "";
  private firstConnect = true;
  private connecting = false;
  private watch: { close(): void } | null = null;
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
  private terminalPid = 0;
  private offLink: (() => void) | null = null;
  private healthTimer: ReturnType<typeof setInterval> | null = null;
  private lastAutoReattach = 0;
  private foreground = AppState.currentState === "active";
  private subs: { remove(): void }[] = [];
  /** Approval notifications showing, by key, with their panes. */
  private alerted = new Map<string, string>();
  /** Wheel notches the live pane is scrolled up by (reported by the terminal view). */
  remoteNotches = 0;

  constructor(host: Host) {
    this.host = host;
    set({ activeHostId: host.id, session: host.session, snapshot: null, paneId: null, terminal: null, sessions: [], conn: { kind: "connecting" } });
    this.subs.push(AppState.addEventListener("change", (s) => this.onAppState(s)));
    this.subs.push(Network.addNetworkStateListener(() => this.networkChanged()));
    const tick = alerts.onTick(() => this.onWatchTick());
    if (tick) this.subs.push(tick);
    this.syncWatch();
    this.healthTimer = setInterval(() => this.checkTerminalHealth(), 5000);
    if (this.foreground) setLowLatencyWifi(true);
    void this.connect();
  }

  // ---------------------------------------------------------------- connection

  private async connect(): Promise<void> {
    if (this.closed || this.connecting) return;
    this.connecting = true;
    try {
      await this.connectOnce();
    } finally {
      this.connecting = false;
    }
  }

  private async connectOnce(): Promise<void> {
    let conn: SshConnection;
    try {
      const identity = await deviceIdentity();
      if (!identity) {
        set({ conn: { kind: "failed", reason: "This device's key is locked.", fix: "unlock" } });
        return;
      }
      this.tag = identity.fingerprint.replace(/^SHA256:/, "");
      conn = await signIn(this.host);
    } catch (e) {
      if (e instanceof SignInError && e.problem === "network") return this.retry(e.message);
      const fix = e instanceof SignInError ? ({ locked: "unlock", host_key: "trust", rejected: "setup", network: "retry" } as const)[e.problem] : "retry";
      set({ conn: { kind: "failed", reason: (e as Error).message, fix } });
      return;
    }
    if (this.closed) return conn.close();
    const link = new HostLink(conn);
    let sessions;
    try {
      // A fresh start has no terminals yet, so any of this device's mosh-servers are leftovers from a killed app.
      if (this.firstConnect) await link.endMoshSessions(this.tag).catch(() => 0);
      sessions = await link.sessions();
    } catch (e) {
      conn.close();
      set({ conn: { kind: "failed", reason: (e as Error).message, fix: "retry" } });
      return;
    }
    this.firstConnect = false;
    this.conn = conn;
    this.link = link;
    this.attempt = 0;
    const onLost = (reason: string) => {
      if (this.conn !== conn) return;
      this.dropLink();
      this.retry(reason);
    };
    conn.onClose(onLost);
    if (conn.closed) return onLost(conn.closed);
    const session = sessions.some((s) => s.name === get().session && s.running)
      ? get().session
      : (sessions.find((s) => s.default)?.name ?? sessions[0]?.name ?? "default");
    set({ sessions, session, conn: { kind: "online" } });
    // The saved session may be gone; remember the one actually in use.
    if (session !== this.host.session) this.persist({ session });
    await this.refresh();
    if (!this.pollTimer) this.pollTimer = setInterval(() => this.refreshSoon(), SNAPSHOT_EVERY_MS);
    // First connect: open the last pane. Reconnect: the mosh session may still be fine; health checks reattach if not.
    if (!get().paneId) this.openPane(this.initialPane());
  }

  private dropLink(): void {
    this.watch?.close();
    this.watch = null;
    this.watchKey = "";
    this.conn = null;
    this.link = null;
  }

  /** The fix button on a failed connection: unlock, trust a changed host key, or simply try again. */
  async reconnect(trustNewHostKey = false): Promise<void> {
    if (this.closed) return;
    if (trustNewHostKey) this.persist({ hostKey: "", keyType: "" });
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.attempt = 0;
    set({ conn: { kind: "connecting" } });
    await this.connect();
    // Trusting again: remember the key it presented this time.
    if (trustNewHostKey && this.conn) this.persist({ hostKey: this.conn.hostKey, keyType: this.conn.keyType });
  }

  /** A command that timed out may mean a dead link that SSH hasn't noticed yet. */
  private callFailed(e: unknown): void {
    if (e instanceof ShellError && e.code === "timeout") void this.probe();
  }

  /** Checks the SSH link with a quick command; a link that doesn't answer is replaced. */
  private async probe(): Promise<void> {
    const conn = this.conn;
    if (!conn) return;
    try {
      await conn.exec("true", { timeoutMs: PROBE_TIMEOUT_MS });
    } catch {
      if (this.conn !== conn) return;
      conn.close();
      this.dropLink();
      if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
      this.attempt = 0;
      set({ conn: { kind: "reconnecting", reason: "the connection stopped answering" } });
      void this.connect();
    }
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
    if (!this.link) throw new Error(`Not connected to ${this.host.name}`);
    return new HerdrApi(this.link.herdr(get().session));
  }

  /** herdr's sessions, fresh (the session switcher shows whether each is running). */
  async refreshSessions(): Promise<void> {
    try {
      if (this.link) set({ sessions: await this.link.sessions() });
    } catch {
      // Keep the list we have.
    }
  }

  async close(): Promise<void> {
    this.closed = true;
    alerts.unwatch();
    this.clearAlerts();
    for (const s of this.subs) s.remove();
    for (const t of [this.reconnectTimer, this.refreshTimer]) if (t) clearTimeout(t);
    for (const t of [this.pollTimer, this.healthTimer]) if (t) clearInterval(t);
    setLowLatencyWifi(false);
    await this.releaseTerminal();
    const conn = this.conn;
    this.dropLink();
    conn?.close();
    set({ activeHostId: null, conn: { kind: "idle" }, snapshot: null, paneId: null, terminal: null, link: null, scrollback: [], historyMode: false });
  }

  // ---------------------------------------------------------------- snapshot + events

  /** In the background timers don't run (refreshSoon would wait until the app is back), so fetch straight away. */
  private refreshNow(): void {
    if (this.foreground) this.refreshSoon();
    else void this.refresh();
  }

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
      void this.alertApprovals(before, snapshot);
      await this.ensureWatch(snapshot.panes.map((p) => p.pane_id));
    } catch (e) {
      // The reconnect loop handles a dead link; a failed poll isn't worth surfacing.
      this.callFailed(e);
    } finally {
      this.refreshing = false;
      if (this.refreshAgain) {
        this.refreshAgain = false;
        this.refreshNow();
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
    const link = this.link;
    if (!link || key === this.watchKey) return;
    this.watchKey = key;
    this.watch?.close();
    this.watch = null;
    try {
      const w = await link.watch(
        get().session,
        panes,
        () => this.refreshNow(),
        () => {
          if (this.watch !== w) return;
          this.watch = null;
          this.watchKey = "";
          setTimeout(() => this.refreshSoon(), 2000);
        },
      );
      if (this.link !== link || this.watchKey !== key) w.close();
      else this.watch = w;
    } catch {
      if (this.watchKey === key) this.watchKey = "";
    }
  }

  switchSession(name: string): void {
    if (name === get().session) return;
    void this.releaseTerminal();
    set({ session: name, snapshot: null, paneId: null });
    this.watch?.close();
    this.watch = null;
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
    const conn = this.conn;
    const link = this.link;
    if (!conn || !link || !this.foreground) return;
    set({ attaching: true, attachError: null });
    const [cols, rows] = this.grid[0] > 0 ? this.grid : [60, 30];
    try {
      const m = await link.startMosh(get().session, pane.terminal_id, this.tag);
      if (seq !== this.attachSeq) {
        void link.stopMosh(m.pid, this.tag).catch(() => {});
        return;
      }
      const client = new MoshClient({ host: conn.address, port: m.port, key: Sealer.decodeKey(m.key), cols, rows, transport: nativeUdp });
      this.terminalPid = m.pid;
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
   * session, and makes sure its mosh-server is gone so the pane gets its desktop size back.
   */
  private async releaseTerminal(clear = true): Promise<void> {
    const client = get().terminal;
    this.offLink?.();
    this.offLink = null;
    if (clear) set({ terminal: null, link: null });
    else set({ terminal: null });
    if (!client) return;
    const pid = this.terminalPid;
    this.terminalPid = 0;
    if (this.remoteNotches > 0) {
      client.write(new TextEncoder().encode(WHEEL_DOWN.repeat(this.remoteNotches + 2)));
      this.remoteNotches = 0;
      await sleep(400);
    }
    void client.close(800);
    // It quits when the client says goodbye; in case that gets lost, end it from here too (it
    // takes the first signal as a polite goodbye). Failing both, it times out on its own.
    void this.link?.stopMosh(pid, this.tag).catch(() => {});
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

  /** If the terminal went silent (mosh-server timed out or ended) while we're online, reattach. */
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
    if (this.closed) return;
    if (this.conn) {
      void this.probe();
    } else if (get().conn.kind !== "failed") {
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
      // Back in the app, which shows who needs you.
      this.clearAlerts();
      this.networkChanged();
      this.refreshSoon();
      const id = get().paneId;
      if (id && !get().terminal) void this.attach(id);
    }
  }

  // ---------------------------------------------------------------- approval alerts

  /** With approval alerts on, keep running in the background while this computer is open. */
  syncWatch(): void {
    if (this.closed) return;
    if (get().alerts) alerts.watch(`Watching agents on ${this.host.name}`, "You'll get a notification when one needs you.");
    else {
      alerts.unwatch();
      this.clearAlerts();
    }
  }

  /** The watch service's tick, in the background: poll herdr, or reconnect if a retry is waiting. */
  private onWatchTick(): void {
    if (this.foreground || this.closed || this.connecting) return;
    if (this.link) void this.refresh();
    else if (get().conn.kind === "reconnecting") {
      if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
      void this.connect();
    }
  }

  /** An agent that has just started needing you, while Moshlet is in the background: a notification that opens its pane. */
  private async alertApprovals(before: Snapshot | null, after: Snapshot): Promise<void> {
    // Answered (here or on the computer) or gone: its notification goes too.
    for (const [key, pane] of this.alerted) {
      if (after.agents.some((a) => a.pane_id === pane && a.agent_status === "blocked")) continue;
      alerts.cancel(key);
      this.alerted.delete(key);
    }
    if (!get().alerts || this.foreground || !before) return;
    for (const a of after.agents) {
      if (a.agent_status !== "blocked") continue;
      if (before.agents.find((b) => b.pane_id === a.pane_id)?.agent_status === "blocked") continue;
      const key = `${this.host.id}|${get().session}|${a.pane_id}`;
      if (this.alerted.has(key)) continue;
      this.alerted.set(key, a.pane_id);
      const ws = after.workspaces.find((w) => w.workspace_id === a.workspace_id);
      const tab = after.tabs.find((t) => t.tab_id === a.tab_id);
      const where = [this.host.name, ws?.label, tab && tabName(tab)].filter(Boolean).join(" · ");
      // What it's asking, read off its screen, if its dialog is one parseApproval recognises.
      const question = await this.readVisible(a.pane_id)
        .then((text) => {
          const prompt = parseApproval(text);
          return prompt.parsed ? prompt.question.join(" ").replace(/\s+/g, " ").slice(0, 400) : "";
        })
        .catch(() => "");
      if (!this.alerted.has(key)) continue;
      alerts.notify(key, `${agentName(a)} needs you`, question || a.terminal_title_stripped || "Waiting for your approval", where, this.host.id, a.pane_id);
    }
  }

  private clearAlerts(): void {
    for (const key of this.alerted.keys()) alerts.cancel(key);
    this.alerted.clear();
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
        this.callFailed(e);
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
