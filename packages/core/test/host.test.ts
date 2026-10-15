import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { HerdrApi } from "../src/herdr/api.ts";
import { HostLink } from "../src/host/link.ts";
import { posix, quote } from "../src/host/shell.ts";
import { MoshClient } from "../src/mosh/client.ts";
import { Sealer } from "../src/mosh/crypto.ts";
import { nodeUdp } from "../src/node/udp.ts";
import type { Screen } from "../src/term/screen.ts";
import { localShell, sshShell, startTestSshd } from "./support/shells.ts";

const KEY = "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIC0rRAL0oNe0ONlYt3sT0mR4nd0mK3yZZ0Tt8vYqYHnB corral@test-phone";

describe("shell commands", () => {
  it("quotes anything without backslashes, and posix() runs it through sh", async () => {
    const tricky = `it's "fine" $HOME ; echo injected $(id -un) \`id\``;
    expect(quote(tricky)).not.toContain("\\");
    const r = await localShell().exec(posix(`printf %s ${quote(tricky)}`));
    expect(r.stdout).toBe(tricky);
    expect(() => posix("echo a\\nb")).toThrow();
  });

  it("adds the phone's key once, keeping the file's last line intact", async () => {
    const home = mkdtempSync(join(tmpdir(), "corral-home-"));
    const link = new HostLink(localShell({ HOME: home }));
    await link.installKey(KEY);
    await link.installKey(KEY);
    const file = join(home, ".ssh", "authorized_keys");
    expect(readFileSync(file, "utf8")).toBe(`${KEY}\n`);
    expect(execFileSync("stat", ["-c", "%a", join(home, ".ssh")]).toString().trim()).toBe("700");

    writeFileSync(file, "ssh-ed25519 AAAAexisting other@laptop");
    await link.installKey(KEY);
    expect(readFileSync(file, "utf8")).toBe(`ssh-ed25519 AAAAexisting other@laptop\n${KEY}\n`);
    await expect(link.installKey("ssh-ed25519 AAAA'; echo injected #")).rejects.toThrow();
  });
});

/**
 * End to end against the real herdr and mosh-server on this machine, over a throwaway sshd on
 * loopback, in an isolated herdr session (default "scratch", override with CORRAL_TEST_SESSION).
 * Skipped when that session isn't running.
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

describe.skipIf(!sessionRunning)("HostLink over SSH", () => {
  let sshd: Awaited<ReturnType<typeof startTestSshd>>;
  let link: HostLink;
  const tag = `test${process.pid}`;

  beforeAll(async () => {
    sshd = await startTestSshd();
    if (sshd) link = new HostLink(sshShell(sshd.port, sshd.key));
  });

  afterAll(async () => {
    if (link) await link.endMoshSessions(tag);
    sshd?.stop();
  });

  it("checks what the computer has", async (ctx) => {
    if (!sshd) return ctx.skip();
    const c = await link.check();
    expect(c.user).toBe(execFileSync("id", ["-un"]).toString().trim());
    expect(c.hostname.length).toBeGreaterThan(0);
    expect(c.herdr).toMatch(/herdr$/);
    expect(c.herdrVersion).toMatch(/^\d+\.\d+/);
    expect(c.bridge).toBe(true);
    expect(c.mosh).toMatch(/mosh-server$/);
    expect(c.sessions.find((s) => s.name === SESSION)?.running).toBe(true);
  });

  it("lists sessions and calls herdr through its bridge", async (ctx) => {
    if (!sshd) return ctx.skip();
    expect((await link.sessions()).map((s) => s.name)).toContain(SESSION);
    const api = new HerdrApi(link.herdr(SESSION));
    expect(await api.ping()).toMatch(/^\d+\.\d+/);
    const snap = await api.snapshot();
    expect(snap.panes.length).toBeGreaterThan(0);
    await expect(api.closePane("w999:p999")).rejects.toMatchObject({ code: expect.any(String) });
    await expect(new HerdrApi(link.herdr("corral-no-such-session")).ping()).rejects.toMatchObject({ code: "herdr_unavailable" });
  });

  it("streams herdr events while watching", async (ctx) => {
    if (!sshd) return ctx.skip();
    const api = new HerdrApi(link.herdr(SESSION));
    const snap = await api.snapshot();
    const tab = snap.tabs[0];
    let got: (e: Record<string, unknown>) => void = () => {};
    const event = new Promise<Record<string, unknown>>((resolve) => (got = resolve));
    let ended = "";
    const watch = await link.watch(SESSION, snap.panes.map((p) => p.pane_id), (e) => got(e), (r) => (ended = r));
    await api.renameTab(tab.tab_id, `corral-test-${Date.now() % 1000}`);
    expect(String((await event).event)).toMatch(/^tab_/);
    await api.renameTab(tab.tab_id, tab.label);
    watch.close();
    expect(ended).toBe("");
  });

  it("attaches a terminal over mosh, then ends it", async (ctx) => {
    if (!sshd) return ctx.skip();
    const pane = (await new HerdrApi(link.herdr(SESSION)).snapshot()).panes[0];
    const m = await link.startMosh(SESSION, pane.terminal_id, tag);
    expect(m.pid).toBeGreaterThan(0);
    const client = new MoshClient({ host: "127.0.0.1", port: m.port, key: Sealer.decodeKey(m.key), cols: 50, rows: 16, transport: nodeUdp });
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
    expect(isAlive(m.pid)).toBe(true);
    await link.stopMosh(m.pid, tag);
    await sleep(800);
    expect(isAlive(m.pid)).toBe(false);
    await client.close(300);
  });

  it("ends the mosh-servers a killed app left behind, and only those", async (ctx) => {
    if (!sshd) return ctx.skip();
    // Two different panes: attaching one terminal twice would end the first viewer.
    const panes = (await new HerdrApi(link.herdr(SESSION)).snapshot()).panes;
    if (panes.length < 2) return ctx.skip();
    const mine = await link.startMosh(SESSION, panes[0].terminal_id, tag);
    const other = await link.startMosh(SESSION, panes[1].terminal_id, `${tag}other`);
    // Someone else's server is never signalled.
    await link.stopMosh(other.pid, tag);
    await sleep(500);
    expect(isAlive(other.pid)).toBe(true);
    // A server no phone has reached yet is two processes (its command starts on first contact).
    expect(await link.endMoshSessions(tag)).toBeGreaterThan(0);
    await sleep(300);
    expect(isAlive(mine.pid)).toBe(false);
    expect(isAlive(other.pid)).toBe(true);
    expect(await link.endMoshSessions(`${tag}other`)).toBeGreaterThan(0);
  });
});

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
