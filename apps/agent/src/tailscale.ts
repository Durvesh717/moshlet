import { execFile } from "node:child_process";
import { promisify } from "node:util";

const run = promisify(execFile);

export interface TailscaleSelf {
  ips: string[];
  userId: number;
  hostName: string;
}

export interface Peer {
  userId: number;
  login: string;
  node: string;
}

/** This machine's Tailscale addresses and owner, from `tailscale status --json`. */
export async function tailscaleSelf(): Promise<TailscaleSelf> {
  const { stdout } = await run("tailscale", ["status", "--json"], { timeout: 5000 });
  const st = JSON.parse(stdout) as { BackendState?: string; Self?: { TailscaleIPs?: string[]; UserID?: number; HostName?: string } };
  if (st.BackendState !== "Running" || !st.Self?.TailscaleIPs?.length) throw new Error("Tailscale isn't running on this machine");
  return { ips: st.Self.TailscaleIPs, userId: st.Self.UserID ?? -1, hostName: st.Self.HostName ?? "" };
}

const cache = new Map<string, { peer: Peer | null; at: number }>();

/** Who is behind a tailnet address, from `tailscale whois`. Cached for a minute. */
export async function whois(ip: string): Promise<Peer | null> {
  const addr = ip.replace(/^::ffff:/, "");
  const hit = cache.get(addr);
  if (hit && Date.now() - hit.at < 60_000) return hit.peer;
  let peer: Peer | null = null;
  try {
    const { stdout } = await run("tailscale", ["whois", "--json", addr], { timeout: 5000 });
    const w = JSON.parse(stdout) as { Node?: { Name?: string; User?: number }; UserProfile?: { LoginName?: string } };
    if (w.Node?.User !== undefined) {
      peer = { userId: w.Node.User, login: w.UserProfile?.LoginName ?? "", node: (w.Node.Name ?? "").replace(/\.$/, "") };
    }
  } catch {
    peer = null;
  }
  cache.set(addr, { peer, at: Date.now() });
  return peer;
}
