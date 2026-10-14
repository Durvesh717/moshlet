import { HerdrError, type HerdrCall } from "../herdr/api.ts";
import type { Push, Request, Response } from "./protocol.ts";

export class AgentError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.code = code;
  }
}

/**
 * One WebSocket connection to a corral-agent. Uses the platform WebSocket (React Native, Node 22+).
 * Reconnecting is the caller's job: create a new connection and say hello again.
 */
export class AgentConnection {
  private readonly ws: WebSocket;
  private nextId = 1;
  private readonly pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();
  private readonly listeners = new Set<(p: Push) => void>();
  private readonly closeListeners = new Set<(reason: string) => void>();
  private closedReason: string | null = null;

  private constructor(ws: WebSocket) {
    this.ws = ws;
    ws.onmessage = (ev) => this.onMessage(typeof ev.data === "string" ? ev.data : String(ev.data));
    ws.onclose = (ev) => this.onClosed(ev.reason || `closed (${ev.code})`);
    ws.onerror = () => this.onClosed("connection error");
  }

  static open(url: string, timeoutMs = 8000): Promise<AgentConnection> {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(url);
      const timer = setTimeout(() => {
        ws.close();
        reject(new AgentError("unreachable", `no answer from ${url}`));
      }, timeoutMs);
      ws.onopen = () => {
        clearTimeout(timer);
        resolve(new AgentConnection(ws));
      };
      ws.onerror = () => {
        clearTimeout(timer);
        reject(new AgentError("unreachable", `couldn't connect to ${url}`));
      };
    });
  }

  get closed(): string | null {
    return this.closedReason;
  }

  call<T = unknown>(method: string, params?: Record<string, unknown>, timeoutMs = 15_000): Promise<T> {
    if (this.closedReason) return Promise.reject(new AgentError("closed", this.closedReason));
    const id = this.nextId++;
    const req: Request = params ? { id, method, params } : { id, method };
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new AgentError("timeout", `${method} timed out`));
      }, timeoutMs);
      this.pending.set(id, {
        resolve: (v) => {
          clearTimeout(timer);
          resolve(v as T);
        },
        reject: (e) => {
          clearTimeout(timer);
          reject(e);
        },
      });
      this.ws.send(JSON.stringify(req));
    });
  }

  /** A HerdrCall bound to one session, for HerdrApi. */
  herdr(session: string): HerdrCall {
    return async (method, params) => {
      try {
        return await this.call<Record<string, unknown>>("herdr.call", { session, method, ...(params ? { params } : {}) });
      } catch (e) {
        if (e instanceof AgentError && e.code === "herdr_error") {
          const [code, ...rest] = e.message.split(": ");
          throw new HerdrError(rest.length ? code : "error", rest.length ? rest.join(": ") : e.message);
        }
        throw e;
      }
    };
  }

  onPush(cb: (p: Push) => void): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  onClose(cb: (reason: string) => void): () => void {
    this.closeListeners.add(cb);
    return () => this.closeListeners.delete(cb);
  }

  close(): void {
    this.ws.close();
    this.onClosed("closed by us");
  }

  private onMessage(text: string): void {
    let msg: Response & Partial<Push>;
    try {
      msg = JSON.parse(text);
    } catch {
      return;
    }
    if (typeof msg.event === "string") {
      for (const cb of this.listeners) cb({ event: msg.event, data: msg.data });
      return;
    }
    const p = this.pending.get(msg.id);
    if (!p) return;
    this.pending.delete(msg.id);
    if (msg.error) p.reject(new AgentError(msg.error.code, msg.error.message));
    else p.resolve(msg.result);
  }

  private onClosed(reason: string): void {
    if (this.closedReason) return;
    this.closedReason = reason;
    for (const p of this.pending.values()) p.reject(new AgentError("closed", reason));
    this.pending.clear();
    for (const cb of this.closeListeners) cb(reason);
  }
}
