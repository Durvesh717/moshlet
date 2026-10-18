import type { Cell, Link, MoshClient, SessionInfo, Snapshot } from "@moshlet/core";
import { create } from "zustand";
import { FONT_SIZE, type TerminalFont } from "../theme";
import type { HostKey } from "../../modules/moshlet-native/ssh";
import type { Host } from "./hosts";

export type ConnState =
  | { kind: "idle" }
  | { kind: "connecting" }
  | { kind: "online" }
  | { kind: "reconnecting"; reason: string }
  /**
   * `fix`: what the button offers: unlock the key, trust a changed host key, set the computer up
   * again, or retry. With "trust", `presented` is the new key: trusting saves exactly that one.
   */
  | { kind: "failed"; reason: string; fix: "unlock" | "trust" | "setup" | "retry"; presented?: HostKey };

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
  termFont: TerminalFont;
  /** Approval alerts (Settings): notify when an agent needs you while Moshlet is in the background. */
  alerts: boolean;
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
  fontSize: FONT_SIZE.default,
  termFont: "JetBrains Mono",
  alerts: false,
  toast: null,
}));

let toastId = 0;
export function toast(text: string): void {
  useApp.setState({ toast: { id: ++toastId, text } });
}
