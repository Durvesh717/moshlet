#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir, hostname } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { AGENT_PORT } from "@corral/core";
import { control, startControl, type ControlInfo } from "./control.ts";
import { DeviceStore, type Device } from "./devices.ts";
import { agentHost, startAgent } from "./server.ts";
import { tailscaleSelf, whois } from "./tailscale.ts";

const VERSION = (JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as { version: string }).version;

const USAGE = `corral-agent ${VERSION}: lets Corral on your phone reach herdr on this computer, over Tailscale.

  corral-agent serve [--port N]   run the service (listens on this machine's Tailscale addresses only)
  corral-agent pair               show a one-time code to pair a phone or tablet
  corral-agent devices            list paired devices
  corral-agent revoke <id>        unpair a device
  corral-agent install            run it as a systemd user service (starts now and at login)
  corral-agent uninstall          remove that service
`;

const log = (msg: string) => console.log(`${new Date().toTimeString().slice(0, 8)} ${msg}`);

async function serve(args: string[]): Promise<void> {
  const portArg = args.indexOf("--port");
  const port = portArg >= 0 ? Number(args[portArg + 1]) : Number(process.env.CORRAL_AGENT_PORT ?? AGENT_PORT);
  const self = await tailscaleSelf();
  const store = new DeviceStore();
  const host = agentHost(self.hostName || hostname(), VERSION);
  const agent = await startAgent({
    listen: self.ips,
    port,
    store,
    host,
    log,
    // Only devices signed in to the same Tailscale account as this machine may connect at all.
    identify: async (ip) => {
      const peer = await whois(ip);
      return peer && peer.userId === self.userId ? peer : null;
    },
  });
  const info: ControlInfo = { addresses: self.ips, port, hostName: host.name };
  const ctl = await startControl(store, info);
  log(`corral-agent ${VERSION} ready for ${host.name}; ${store.list().length} paired device(s)`);
  const stop = async () => {
    log("stopping");
    ctl.close();
    await agent.close();
    process.exit(0);
  };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
}

async function pair(): Promise<void> {
  const r = await control<{ code: string; expiresAt: number } & ControlInfo>({ cmd: "pair" });
  const v4 = r.addresses.find((a) => !a.includes(":")) ?? r.addresses[0];
  console.log(`\n  Pairing code:  ${r.code}\n`);
  console.log(`  In Corral, add a computer: ${r.hostName} (${v4}), then enter the code.`);
  console.log(`  It works once and expires at ${new Date(r.expiresAt).toLocaleTimeString()}.\n`);
}

async function devices(): Promise<void> {
  const { devices } = await control<{ devices: Omit<Device, "tokenSha256">[] }>({ cmd: "devices" });
  if (devices.length === 0) return console.log("No paired devices. Pair one with `corral-agent pair`.");
  const when = (iso: string) => {
    const d = new Date(iso);
    return `${d.toLocaleDateString("en-CA")} ${d.toTimeString().slice(0, 5)}`;
  };
  for (const d of devices) {
    console.log(`${d.id}  ${d.name.padEnd(24)} paired ${when(d.createdAt)}  last seen ${d.lastSeenAt ? when(d.lastSeenAt) : "never"}${d.node ? `  (${d.node})` : ""}`);
  }
}

async function revoke(id: string | undefined): Promise<void> {
  if (!id) throw new Error("usage: corral-agent revoke <id>");
  const { revoked } = await control<{ revoked: boolean }>({ cmd: "revoke", id });
  console.log(revoked ? `Revoked ${id}.` : `No device ${id}.`);
}

const UNIT = "corral-agent.service";
const unitPath = () => join(process.env.XDG_CONFIG_HOME ?? join(homedir(), ".config"), "systemd/user", UNIT);

async function install(): Promise<void> {
  const main = fileURLToPath(new URL("./main.ts", import.meta.url));
  const unit = [
    "[Unit]",
    "Description=Corral agent: herdr for the Corral app, over Tailscale",
    "After=network-online.target",
    "",
    "[Service]",
    `ExecStart=${process.execPath} ${main} serve`,
    // The service needs the same herdr, mosh-server and tailscale this shell finds.
    `Environment=PATH=${process.env.PATH ?? "/usr/bin:/bin"}`,
    `Environment=LANG=${process.env.LANG ?? "C.UTF-8"}`,
    "Restart=on-failure",
    "RestartSec=5",
    "",
    "[Install]",
    "WantedBy=default.target",
    "",
  ].join("\n");
  mkdirSync(dirname(unitPath()), { recursive: true });
  writeFileSync(unitPath(), unit);
  execFileSync("systemctl", ["--user", "daemon-reload"]);
  execFileSync("systemctl", ["--user", "enable", "--now", UNIT]);
  console.log(`Installed and started ${unitPath()}.\nLogs: journalctl --user -u corral-agent -f\nNext: corral-agent pair`);
}

async function uninstall(): Promise<void> {
  try {
    execFileSync("systemctl", ["--user", "disable", "--now", UNIT]);
  } catch {
    // not enabled
  }
  rmSync(unitPath(), { force: true });
  execFileSync("systemctl", ["--user", "daemon-reload"]);
  console.log("Removed the corral-agent service. Paired devices are kept; delete ~/.config/corral-agent to forget them.");
}

const [cmd, ...rest] = process.argv.slice(2);
const commands: Record<string, () => Promise<void>> = {
  serve: () => serve(rest),
  pair,
  devices,
  revoke: () => revoke(rest[0]),
  install,
  uninstall,
};
const run = commands[cmd ?? ""];
if (cmd === "--version") console.log(VERSION);
else if (!run) process.stdout.write(USAGE);
else
  run().catch((e: Error) => {
    console.error(e.message);
    process.exit(1);
  });
