import { describe, expect, it } from "vitest";
import { decodePane, decodeSnapshot } from "../src/herdr/decode.ts";
import { agentName } from "../src/herdr/model.ts";
import { HostLink } from "../src/host/link.ts";
import type { Shell } from "../src/host/shell.ts";

const full = {
  version: "0.9.4",
  focused_pane_id: "w1:p1",
  workspaces: [{ workspace_id: "w1", label: "playground", number: 1, agent_status: "blocked", tab_count: 1, pane_count: 2, focused: true }],
  tabs: [{ tab_id: "w1:t1", workspace_id: "w1", label: "1", number: 1, pane_count: 2, agent_status: "blocked", focused: true }],
  panes: [
    { pane_id: "w1:p1", tab_id: "w1:t1", workspace_id: "w1", terminal_id: "term_1", cwd: "/home", agent_status: "unknown", focused: true, revision: 3 },
    { pane_id: "w1:p2", tab_id: "w1:t1", workspace_id: "w1", terminal_id: "term_2", agent: "claude", agent_status: "blocked", focused: false, revision: 0 },
  ],
  agents: [{ agent: "claude", name: "claude", pane_id: "w1:p2", tab_id: "w1:t1", workspace_id: "w1", agent_status: "blocked", focused: false }],
  layouts: [
    {
      tab_id: "w1:t1",
      workspace_id: "w1",
      area: { x: 0, y: 0, width: 200, height: 50 },
      panes: [{ pane_id: "w1:p1", rect: { x: 0, y: 0, width: 100, height: 50 }, focused: true }],
      focused_pane_id: "w1:p1",
      zoomed: false,
    },
  ],
};

describe("decoding herdr's snapshot", () => {
  it("passes a complete snapshot through unchanged", () => {
    expect(decodeSnapshot(structuredClone(full))).toEqual(full);
  });

  it("gives missing lists, names and statuses defaults instead of failing", () => {
    expect(decodeSnapshot(undefined)).toEqual({ workspaces: [], tabs: [], panes: [], agents: [], layouts: [] });
    const s = decodeSnapshot({ agents: [{ name: "gemini", pane_id: "w1:p4", tab_id: "w1:t3", workspace_id: "w1" }], tabs: [{ tab_id: "w1:t3", workspace_id: "w1", agent_status: "napping" }] });
    expect(s.panes).toEqual([]);
    expect(s.agents[0]).toMatchObject({ agent: "", agent_status: "unknown", focused: false });
    expect(agentName(s.agents[0])).toBe("gemini");
    expect(agentName({ ...s.agents[0], name: undefined })).toBe("agent");
    expect(s.tabs[0]).toMatchObject({ label: "", number: 0, pane_count: 0, agent_status: "unknown" });
  });

  it("drops entries without their ids", () => {
    const s = decodeSnapshot({ panes: [{ tab_id: "t", workspace_id: "w" }, "w1:p1", null, full.panes[0]], layouts: [{ panes: "none" }, { tab_id: "t", panes: [{ rect: {} }, { pane_id: "p" }] }] });
    expect(s.panes.map((p) => p.pane_id)).toEqual(["w1:p1"]);
    expect(s.layouts).toEqual([{ tab_id: "t", workspace_id: "", area: { x: 0, y: 0, width: 0, height: 0 }, panes: [{ pane_id: "p", rect: { x: 0, y: 0, width: 0, height: 0 }, focused: false }], zoomed: false }]);
    expect(decodePane({ pane_id: 3 })).toBeUndefined();
  });
});

describe("herdr's replies", () => {
  const replying = (stdout: string): Shell => ({
    exec: async () => ({ status: 0, stdout, stderr: "" }),
    stream: async () => ({ close() {} }),
  });

  it("turns an unreadable reply into a HerdrError", async () => {
    await expect(new HostLink(replying("Warning: something\n")).herdr("scratch")("ping")).rejects.toMatchObject({ code: "bad_reply" });
  });

  it("reads the session list, skipping entries without a name", async () => {
    const link = new HostLink(replying(JSON.stringify({ sessions: [{ name: "scratch", running: true, default: true }, { running: true }] })));
    expect(await link.sessions()).toEqual([{ name: "scratch", running: true, default: true }]);
    await expect(new HostLink(replying("not json")).sessions()).rejects.toMatchObject({ code: "herdr_failed" });
  });
});
