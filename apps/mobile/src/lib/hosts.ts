import * as SecureStore from "expo-secure-store";

/** A computer running corral-agent that this device is paired with. */
export interface Host {
  id: string;
  name: string;
  /** Tailscale address (or MagicDNS name) of the agent. */
  address: string;
  port: number;
  deviceId: string;
  /** herdr session last used on this host. */
  session: string;
  /** Pane last open, per session. */
  lastPane: Record<string, string>;
  addedAt: number;
  lastUsedAt?: number;
}

const LIST_KEY = "corral.hosts";
const tokenKey = (id: string) => `corral.token.${id}`;

export async function loadHosts(): Promise<Host[]> {
  try {
    const raw = await SecureStore.getItemAsync(LIST_KEY);
    return raw ? (JSON.parse(raw) as Host[]) : [];
  } catch {
    return [];
  }
}

export async function saveHosts(hosts: Host[]): Promise<void> {
  await SecureStore.setItemAsync(LIST_KEY, JSON.stringify(hosts));
}

/** The pairing token never leaves secure storage except to say hello to its own agent. */
export async function saveToken(hostId: string, token: string): Promise<void> {
  await SecureStore.setItemAsync(tokenKey(hostId), token, { keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY });
}

export async function loadToken(hostId: string): Promise<string | null> {
  return SecureStore.getItemAsync(tokenKey(hostId));
}

export async function deleteToken(hostId: string): Promise<void> {
  await SecureStore.deleteItemAsync(tokenKey(hostId));
}

export const agentUrl = (h: Pick<Host, "address" | "port">): string =>
  `ws://${h.address.includes(":") && !h.address.startsWith("[") ? `[${h.address}]` : h.address}:${h.port}`;
