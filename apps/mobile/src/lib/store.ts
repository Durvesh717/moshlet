import type { Cell, Link, MoshClient, SessionInfo, Snapshot } from "@corral/core";
import { create } from "zustand";
import type { Host } from "./hosts";

export type ConnState =
  | { kind: "idle" }
  | { kind: "connecting" }
  | { kind: "online" }
  | { kind: "reconnecting"; reason: string }
  | { kind: "failed"; reason: string; unpaired?: boolean };

/** What the UI shows about the mosh link: coarse, so it changes rarely. */
export interface LinkUi {
  rttMs: number | null;
  stale: boolean;
  heardAgoSecs: number | null;
  closed: Link["closed"];
  neverHeard: boolean;
}

export interface AppState {
  hosts: Host[];
  hostsLoaded: boolean;
  activeHostId: string | null;
  conn: ConnState;
  sessions: SessionInfo[];
  session: string;
  snapshot: Snapshot | null;
  paneId: string | null;
  terminal: MoshClient | null;
  attaching: boolean;
  attachError: string | null;
  link: LinkUi | null;
  /** herdr's history above the live screen, laid out for the current width (History button). */
  scrollback: (readonly Cell[])[];
  historyMode: boolean;
  fontSize: number;
  toast: { id: number; text: string } | null;
}

export const useApp = create<AppState>(() => ({
  hosts: [],
  hostsLoaded: false,
  activeHostId: null,
  conn: { kind: "idle" },
  sessions: [],
  session: "default",
  snapshot: null,
  paneId: null,
  terminal: null,
  attaching: false,
  attachError: null,
  link: null,
  scrollback: [],
  historyMode: false,
  fontSize: 12,
  toast: null,
}));

let toastId = 0;
export function toast(text: string): void {
  useApp.setState({ toast: { id: ++toastId, text } });
}
