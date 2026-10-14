/**
 * The app <-> corral-agent wire protocol: JSON text frames over a WebSocket on the Tailscale
 * address. Requests carry an id and get exactly one response; the agent also pushes events.
 *
 * A connection's first request must be `hello` (a paired device) or `pair` (a new device with a
 * one-time code from `corral-agent pair`). Everything else is refused until then.
 */

export const AGENT_PORT = 7337;
export const AGENT_PROTOCOL = 1;

export interface Request {
  id: number;
  method: string;
  params?: Record<string, unknown>;
}

export interface Response {
  id: number;
  result?: unknown;
  error?: { code: string; message: string };
}

export interface Push {
  event: string;
  data: unknown;
}

export interface HostInfo {
  name: string;
  agentVersion: string;
  protocol: number;
}

export interface SessionInfo {
  name: string;
  running: boolean;
  default: boolean;
}

export interface PairParams {
  code: string;
  deviceName: string;
}

export interface PairResult {
  deviceId: string;
  token: string;
  host: HostInfo;
}

export interface HelloParams {
  deviceId: string;
  token: string;
}

export interface HelloResult {
  host: HostInfo;
  sessions: SessionInfo[];
}

/** Proxy one herdr API request to a session's socket. */
export interface HerdrCallParams {
  session: string;
  method: string;
  params?: Record<string, unknown>;
}

/** Stream a session's herdr events to this connection (replaces any earlier watch). */
export interface WatchParams {
  session: string;
  statusPanes: string[];
}

/** Pushed as { event: "herdr", data } while a watch is active. */
export interface HerdrEventPush {
  session: string;
  event: Record<string, unknown>;
}

/**
 * Start a mosh-server running `herdr terminal attach <terminalId> --takeover`. The agent first
 * ends this device's other terminals: one attached pane per device, so a phone that vanished
 * can never leave panes stuck at its size.
 */
export interface AttachParams {
  session: string;
  terminalId: string;
  cols: number;
  rows: number;
}

export interface AttachResult {
  host: string;
  port: number;
  key: string;
}

/** End terminals this device attached: one by port, or all of them. */
export interface ReleaseParams {
  port?: number;
}

export type ErrorCode =
  | "unauthenticated"
  | "bad_request"
  | "unknown_method"
  | "pairing_failed"
  | "herdr_error"
  | "herdr_unavailable"
  | "mosh_failed"
  | "internal";
