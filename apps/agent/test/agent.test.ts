import { execFileSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AgentConnection, AgentError, HerdrApi, MoshClient, Sealer, type AttachResult, type HelloResult, type PairResult, type Screen } from "@corral/core";
import { nodeUdp } from "@corral/core/node";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DeviceStore } from "../src/devices.ts";
import { isAlive } from "../src/mosh.ts";
import { agentHost, startAgent, type RunningAgent } from "../src/server.ts";

/**
 * End to end against the real herdr on this machine, in an isolated session (default "scratch",
 * override with CORRAL_TEST_SESSION). Skipped when that session isn't running.
 */
const SESSION = process.env.CORRAL_TEST_SESSION ?? "scratch";
const sessionRunning = (() => {
  try {
    return (JSON.parse(execFileSync("herdr", ["session", "list", "--json"]).toString()) as { sessions: { name: string; running: boolean }[] })
      .sessions.some((s) => s.name === SESSION && s.running);
  } catch {
    return false;
  }
})();

const peer = { userId: 1, login: "owner@example.com", node: "test-phone" };

describe.skipIf(!sessionRunning)("corral-agent", () => {
  let agent: RunningAgent;
  let store: DeviceStore;
  let url: string;
  let allow = true;

  beforeAll(async () => {
    store = new DeviceStore(join(mkdtempSync(join(tmpdir(), "corral-agent-")), "devices.json"));
    agent = await startAgent({
      listen: ["127.0.0.1"],
      port: 0,
      store,
      host: agentHost("test-host", "0.0.0"),
      identify: async () => (allow ? peer : null),
      releaseGraceMs: 300,
    });
    url = `ws://127.0.0.1:${agent.ports[0]}`;
  });

  afterAll(async () => {
    await agent?.close();
  });

  async function pairedConnection(): Promise<{ conn: AgentConnection; deviceId: string; token: string }> {
    const { code } = store.createPairingCode();
    const conn = await AgentConnection.open(url);
    const r = await conn.call<PairResult>("pair", { code, deviceName: "Test Phone" });
    return { conn, deviceId: r.deviceId, token: r.token };
  }

  it("pairs with a one-time code, refuses wrong codes and calls before hello", async () => {
    const conn = await AgentConnection.open(url);
    await expect(conn.call("sessions")).rejects.toMatchObject({ code: "unauthenticated" });
    await expect(conn.call("pair", { code: "AAAA-AAAA", deviceName: "x" })).rejects.toMatchObject({ code: "pairing_failed" });
    const { code } = store.createPairingCode();
    const r = await conn.call<PairResult>("pair", { code: code.toLowerCase().replace("-", ""), deviceName: "Test Phone" });
    expect(r.host.name).toBe("test-host");
    expect(r.token.length).toBeGreaterThan(30);
    // The code is spent.
    const again = await AgentConnection.open(url);
    await expect(again.call("pair", { code, deviceName: "y" })).rejects.toMatchObject({ code: "pairing_failed" });
    again.close();
    conn.close();
    expect(store.list().find((d) => d.id === r.deviceId)?.node).toBe("test-phone");
  });

  it("says hello with the token, lists sessions and proxies herdr", async () => {
    const { conn, deviceId, token } = await pairedConnection();
    conn.close();
    const c = await AgentConnection.open(url);
    await expect(c.call("hello", { deviceId, token: token + "x" })).rejects.toMatchObject({ code: "unauthenticated" });
    const hello = await c.call<HelloResult>("hello", { deviceId, token });
    expect(hello.sessions.map((s) => s.name)).toContain(SESSION);
    const api = new HerdrApi(c.herdr(SESSION));
    expect(await api.ping()).toMatch(/^\d+\.\d+/);
    const snap = await api.snapshot();
    expect(snap.panes.length).toBeGreaterThan(0);
    await expect(api.closePane("w999:p999")).rejects.toThrow();
    c.close();
  });

  it("streams herdr events while watching", async () => {
    const { conn } = await pairedConnection();
    const api = new HerdrApi(conn.herdr(SESSION));
    const snap = await api.snapshot();
    const tab = snap.tabs[0];
    const got = new Promise<Record<string, unknown>>((resolve) =>
      conn.onPush((p) => p.event === "herdr" && resolve((p.data as { event: Record<string, unknown> }).event)),
    );
    await conn.call("herdr.watch", { session: SESSION, statusPanes: snap.panes.map((p) => p.pane_id) });
    await api.renameTab(tab.tab_id, `corral-test-${Date.now() % 1000}`);
    const ev = await got;
    expect(String(ev.event)).toMatch(/^tab_/);
    await api.renameTab(tab.tab_id, tab.label);
    conn.close();
  });

  it("attaches a terminal over mosh, keeps one per device, and releases it", async () => {
    const { conn } = await pairedConnection();
    const api = new HerdrApi(conn.herdr(SESSION));
    const panes = (await api.snapshot()).panes;
    const attach = (terminalId: string) => conn.call<AttachResult>("terminal.attach", { session: SESSION, terminalId, cols: 50, rows: 16 });

    const a = await attach(panes[0].terminal_id);
    const client = new MoshClient({ host: a.host, port: a.port, key: Sealer.decodeKey(a.key), cols: 50, rows: 16, transport: nodeUdp });
    const screen = await new Promise<Screen>((resolve, reject) => {
      const t = setTimeout(() => reject(new Error("no screen from mosh")), 8000);
      const off = client.onScreen((s) => {
        if (s.text().trim() !== "") {
          clearTimeout(t);
          off();
          resolve(s);
        }
      });
    });
    expect([screen.cols, screen.rows]).toEqual([50, 16]);
    // herdr's attach turns on mouse reporting, which live scrolling relies on.
    expect(screen.mouseMode).toBeGreaterThan(0);
    const pidA = pidOf(a.port);
    expect(pidA).toBeGreaterThan(0);
    expect(isAlive(pidA)).toBe(true);

    if (panes.length > 1) {
      const b = await attach(panes[1].terminal_id);
      await sleep(300);
      expect(isAlive(pidA)).toBe(false);
      await conn.call("terminal.release", { port: b.port });
      await sleep(300);
      expect(pidOf(b.port)).toBe(0);
    } else {
      await conn.call("terminal.release", {});
      await sleep(300);
      expect(isAlive(pidA)).toBe(false);
    }
    await client.close(300);
    conn.close();
  });

  it("ends a vanished device's terminal after the grace period", async () => {
    const { conn } = await pairedConnection();
    const pane = (await new HerdrApi(conn.herdr(SESSION)).snapshot()).panes[0];
    const a = await conn.call<AttachResult>("terminal.attach", { session: SESSION, terminalId: pane.terminal_id, cols: 40, rows: 12 });
    const pid = pidOf(a.port);
    expect(pid).toBeGreaterThan(0);
    conn.close();
    await sleep(100);
    expect(isAlive(pid)).toBe(true);
    await sleep(500);
    expect(isAlive(pid)).toBe(false);
  });

  it("refuses peers that aren't the owner's devices", async () => {
    allow = false;
    try {
      const conn = await AgentConnection.open(url);
      const reason = await new Promise<string>((resolve) => conn.onClose(resolve));
      expect(reason).toMatch(/not allowed|4003/);
      await expect(conn.call("sessions")).rejects.toBeInstanceOf(AgentError);
    } finally {
      allow = true;
    }
  });
});

/** The pid of the mosh-server listening on a UDP port, or 0. */
function pidOf(port: number): number {
  const line = execFileSync("ss", ["-ulnp"]).toString().split("\n").find((l) => l.includes(`:${port} `));
  return Number(/mosh-server",pid=(\d+)/.exec(line ?? "")?.[1] ?? 0);
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
