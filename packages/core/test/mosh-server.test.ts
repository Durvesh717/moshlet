import { execFileSync, spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { utf8Encode } from "../src/bytes.ts";
import { MoshClient } from "../src/mosh/client.ts";
import { Sealer } from "../src/mosh/crypto.ts";
import { nodeUdp } from "../src/node/udp.ts";
import type { Screen } from "../src/term/screen.ts";
import { rgb } from "../src/term/style.ts";

/** End-to-end against the real mosh-server on this machine, over loopback. Skipped without one. */
const haveMosh = existsSync("/usr/bin/mosh-server");

function startServer(...command: string[]): Promise<{ port: number; key: Uint8Array }> {
  return new Promise((resolve, reject) => {
    const proc = spawn("mosh-server", ["new", "-i", "127.0.0.1", "-p", "60500:60599", "-c", "256", "-l", "LANG=en_US.UTF-8", "--", ...command], {
      env: { ...process.env, MOSH_SERVER_NETWORK_TMOUT: "30" },
    });
    let out = "";
    const onData = (b: Buffer) => {
      out += b.toString();
      const m = /MOSH CONNECT (\d+) (\S+)/.exec(out);
      if (m) resolve({ port: Number(m[1]), key: Sealer.decodeKey(m[2]) });
    };
    proc.stdout.on("data", onData);
    proc.stderr.on("data", onData);
    proc.on("error", reject);
  });
}

function until(client: MoshClient, what: string, pred: (s: Screen) => boolean, ms = 8000): Promise<Screen> {
  if (pred(client.screen)) return Promise.resolve(client.screen);
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => {
      off();
      reject(new Error(`timed out waiting for ${what}; screen:\n${client.screen.text()}`));
    }, ms);
    const off = client.onScreen((s) => {
      if (pred(s)) {
        clearTimeout(t);
        off();
        resolve(s);
      }
    });
  });
}

describe.skipIf(!haveMosh)("MoshClient against mosh-server", () => {
  it("types, runs, resizes and sees colored output, then ends with the remote command", async () => {
    const { port, key } = await startServer("/usr/bin/env", "PS1=$ ", "/bin/sh");
    const client = new MoshClient({ host: "127.0.0.1", port, key, cols: 60, rows: 20, transport: nodeUdp });

    const first = await until(client, "prompt", (s) => s.text().includes("$"));
    expect([first.cols, first.rows]).toEqual([60, 20]);

    client.write(utf8Encode("echo hello$((40+2))\r"));
    await until(client, "echo output", (s) => s.text().includes("hello42"));

    client.resize(44, 12);
    client.write(utf8Encode("stty size\r"));
    await until(client, "new size", (s) => s.text().includes("12 44"));

    client.write(utf8Encode("printf '\\033[38;2;1;2;3mRGB\\033[0m\\n'\r"));
    const colored = await until(client, "truecolor", (s) => Array.from({ length: s.rows }, (_, y) => s.rowText(y)).includes("RGB"));
    const row = Array.from({ length: colored.rows }, (_, y) => colored.rowText(y)).indexOf("RGB");
    expect(colored.cell(0, row).style.fg).toBe(rgb(1, 2, 3));
    expect(client.link.rttMs ?? 999).toBeLessThan(200);

    const ended = new Promise<string | null>((resolve) => client.onLink((l) => l.closed && resolve(l.closed)));
    client.write(utf8Encode("exit\r"));
    expect(await ended).toBe("session-ended");
  });

  it("keeps the session across a network change (hop to a fresh socket)", async () => {
    const { port, key } = await startServer("/usr/bin/env", "PS1=$ ", "/bin/sh");
    const client = new MoshClient({ host: "127.0.0.1", port, key, cols: 60, rows: 20, transport: nodeUdp });
    await until(client, "prompt", (s) => s.text().includes("$"));
    client.networkChanged();
    client.write(utf8Encode("echo roamed$((1+1))\r"));
    await until(client, "output after the hop", (s) => s.text().includes("roamed2"));
    await client.close();
  });

  it("reports input as echoed once its output is on the screen", async () => {
    const { port, key } = await startServer("/usr/bin/env", "PS1=$ ", "/bin/sh");
    const client = new MoshClient({ host: "127.0.0.1", port, key, cols: 60, rows: 20, transport: nodeUdp });
    await until(client, "prompt", (s) => s.text().includes("$"));
    client.write(utf8Encode("echo echoed$((40+2))\r"));
    const sent = client.inputEvents;
    expect(client.echoedInputs).toBeLessThan(sent);
    const s = await until(client, "echo ack", () => client.echoedInputs >= sent);
    expect(s.text()).toContain("echoed42");
    await client.close();
  });

  it("reassembles large multi-fragment screens", async () => {
    const { port, key } = await startServer("/usr/bin/env", "PS1=$ ", "/bin/sh");
    const client = new MoshClient({ host: "127.0.0.1", port, key, cols: 200, rows: 60, transport: nodeUdp });
    await until(client, "prompt", (s) => s.text().includes("$"));
    // A full screen of distinct, colored rows compresses poorly: several fragments per instruction.
    client.write(utf8Encode("for i in $(seq 1 300); do printf '\\033[3%dm%s %04d\\033[0m\\n' $((i%7+1)) $(head -c 60 /dev/urandom | base64 -w0) $i; done; echo done-$((6*7))\r"));
    const s = await until(client, "big output", (sc) => sc.text().includes("done-42"), 15_000);
    expect(s.text()).toMatch(/ 0300/);
    await client.close();
  });

  it("closing from the client stops the server", async () => {
    const { port, key } = await startServer("/usr/bin/env", "PS1=$ ", "/bin/sh");
    const client = new MoshClient({ host: "127.0.0.1", port, key, cols: 40, rows: 10, transport: nodeUdp });
    await until(client, "prompt", (s) => s.text().includes("$"));
    await client.close();
    expect(client.link.closed).toBe("closed-by-us");
    await new Promise((r) => setTimeout(r, 500));
    const listening = execFileSync("ss", ["-ulnp"]).toString();
    expect(listening.includes(`127.0.0.1:${port} `)).toBe(false);
  });
});
