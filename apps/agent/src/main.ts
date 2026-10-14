#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { hostname } from "node:os";
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

const [cmd, ...rest] = process.argv.slice(2);
const commands: Record<string, () => Promise<void>> = {
  serve: () => serve(rest),
  pair,
  devices,
  revoke: () => revoke(rest[0]),
};
const run = commands[cmd ?? ""];
if (cmd === "--version") console.log(VERSION);
else if (!run) process.stdout.write(USAGE);
else
  run().catch((e: Error) => {
    console.error(e.message);
    process.exit(1);
  });
