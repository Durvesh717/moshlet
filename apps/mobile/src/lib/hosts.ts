import * as SecureStore from "expo-secure-store";

/** A computer running herdr that this device signs in to over SSH with its own key. */
export interface Host {
  id: string;
  name: string;
  /** Tailscale name or address. */
  address: string;
  port: number;
  user: string;
  /** The computer's SSH host key as first seen ("SHA256:..."), and its type: a different key is refused. */
  hostKey: string;
  keyType: string;
  /** herdr session last used on this host. */
  session: string;
  /** Pane last open, per session. */
  lastPane: Record<string, string>;
  addedAt: number;
  lastUsedAt?: number;
}

const LIST_KEY = "corral.hosts";

export async function loadHosts(): Promise<Host[]> {
  try {
    const raw = await SecureStore.getItemAsync(LIST_KEY);
    // Entries without a user predate SSH sign-in; they need setting up again.
    return raw ? (JSON.parse(raw) as Host[]).filter((h) => typeof h.user === "string" && typeof h.hostKey === "string") : [];
  } catch {
    return [];
  }
}

export async function saveHosts(hosts: Host[]): Promise<void> {
  await SecureStore.setItemAsync(LIST_KEY, JSON.stringify(hosts));
}

export const newHostId = (): string => Math.random().toString(36).slice(2, 10) + Date.now().toString(36);

/** "user@name" plus the port when it isn't 22. */
export const hostLabel = (h: Pick<Host, "address" | "port" | "user">): string => `${h.user}@${h.address}${h.port === 22 ? "" : `:${h.port}`}`;
