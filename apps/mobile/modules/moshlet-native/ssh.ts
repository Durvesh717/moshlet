import { ShellError, type ExecResult, type Shell } from "@moshlet/core";
import { requireOptionalNativeModule, type EventSubscription } from "expo-modules-core";

interface MoshletSshModule {
  publicKey(): string | null;
  loadIdentity(comment: string): Promise<{ publicKey: string; fingerprint: string }>;
  forgetIdentity(): void;
  connect(
    host: string,
    port: number,
    knownHostKey: string | null,
    knownKeyType: string | null,
  ): Promise<{ id: number; hostKey: string; keyType: string; address: string } | { changed: { expected: string } & HostKey }>;
  authKey(id: number, user: string): Promise<boolean>;
  authPassword(id: number, user: string, password: string): Promise<boolean>;
  exec(id: number, command: string, stdin: string | null, timeoutMs: number): Promise<{ status: number | null; stdout: string; stderr: string }>;
  stream(id: number, streamId: string, command: string, stdin: string): Promise<void>;
  closeStream(streamId: string): void;
  disconnect(id: number): void;
  addListener(event: "onSshClosed", cb: (e: { id: number; reason: string }) => void): EventSubscription;
  addListener(event: "onSshLine", cb: (e: { stream: string; line: string }) => void): EventSubscription;
  addListener(event: "onSshStreamEnd", cb: (e: { stream: string; reason: string }) => void): EventSubscription;
}

const native = requireOptionalNativeModule<MoshletSshModule>("MoshletSsh");

const closeHandlers = new Map<number, (reason: string) => void>();
const lineHandlers = new Map<string, { onLine: (line: string) => void; onEnd: (reason: string) => void }>();
native?.addListener("onSshClosed", (e) => closeHandlers.get(e.id)?.(e.reason));
native?.addListener("onSshLine", (e) => lineHandlers.get(e.stream)?.onLine(e.line));
native?.addListener("onSshStreamEnd", (e) => {
  const h = lineHandlers.get(e.stream);
  lineHandlers.delete(e.stream);
  h?.onEnd(e.reason);
});

const need = (): MoshletSshModule => {
  if (!native) throw new Error("SSH isn't available in this build");
  return native;
};

/** Expo prefixes native errors with "Call to function 'MoshletSsh.x' has been rejected. → Caused by:": keep the module's own message. */
async function call<T>(p: Promise<T>): Promise<T> {
  try {
    return await p;
  } catch (e) {
    if (e instanceof Error) e.message = e.message.replace(/^Call to function '[^']*' has been rejected\.\s*(?:→\s*)?Caused by:\s*/, "");
    throw e;
  }
}

/** A computer's SSH host key: its fingerprint ("SHA256:...") and type ("ssh-ed25519"). */
export interface HostKey {
  hostKey: string;
  keyType: string;
}

/** The computer presented a different host key from the one saved for it. */
export class HostKeyChangedError extends Error {
  readonly code = "ERR_HOST_KEY_CHANGED";
  readonly expected: string;
  /** What it presented instead: trusting it means saving exactly this. */
  readonly presented: HostKey;

  constructor(expected: string, presented: HostKey) {
    super(`The computer's SSH key changed: it was ${expected}, now it's ${presented.hostKey}.`);
    this.expected = expected;
    this.presented = presented;
  }
}

/** Errors carry a code: ERR_NEEDS_UNLOCK, ERR_NETWORK, ERR_TIMEOUT, ERR_CLOSED from the native side, ERR_HOST_KEY_CHANGED from HostKeyChangedError. */
export const errorCode = (e: unknown): string | undefined => (e as { code?: string } | null)?.code;

/** This device's public key line, if it has one yet (no unlock needed). */
export const devicePublicKey = (): string | null => native?.publicKey() ?? null;

/** Unlocks this device's SSH key (creating it the first time). Throws ERR_NEEDS_UNLOCK when a fingerprint/PIN check is due. */
export const loadIdentity = (comment: string) => call(need().loadIdentity(comment));

/** Drops the unlocked key from memory; the next use unlocks it again (asking for fingerprint/PIN if due). */
export const forgetDeviceKey = (): void => native?.forgetIdentity();

let streamSeq = 0;

/** One SSH connection to a computer. */
export class SshConnection implements Shell {
  readonly id: number;
  /** The key the computer presented ("SHA256:..."), and its type ("ssh-ed25519"). */
  readonly hostKey: string;
  readonly keyType: string;
  /** The IP the name resolved to: where mosh's UDP goes. */
  readonly address: string;
  private closedReason: string | null = null;
  private readonly closeListeners = new Set<(reason: string) => void>();
  private readonly streams = new Set<string>();

  private constructor(r: { id: number; hostKey: string; keyType: string; address: string }) {
    this.id = r.id;
    this.hostKey = r.hostKey;
    this.keyType = r.keyType;
    this.address = r.address;
    closeHandlers.set(r.id, (reason) => this.onClosed(reason));
  }

  /** Connects (no login yet), checking the host key against the one seen before, when given. Throws HostKeyChangedError on a mismatch. */
  static async open(host: string, port: number, known?: HostKey): Promise<SshConnection> {
    const r = await call(need().connect(host, port, known?.hostKey ?? null, known?.keyType ?? null));
    if ("changed" in r) throw new HostKeyChangedError(r.changed.expected, { hostKey: r.changed.hostKey, keyType: r.changed.keyType });
    return new SshConnection(r);
  }

  authKey(user: string): Promise<boolean> {
    return call(need().authKey(this.id, user));
  }

  authPassword(user: string, password: string): Promise<boolean> {
    return call(need().authPassword(this.id, user, password));
  }

  get closed(): string | null {
    return this.closedReason;
  }

  async exec(command: string, opts: { stdin?: string; timeoutMs?: number } = {}): Promise<ExecResult> {
    if (this.closedReason) throw new ShellError("closed", this.closedReason);
    try {
      return await call(need().exec(this.id, command, opts.stdin ?? null, opts.timeoutMs ?? 15_000));
    } catch (e) {
      const code = errorCode(e);
      throw new ShellError(code === "ERR_TIMEOUT" ? "timeout" : code === "ERR_CLOSED" ? "closed" : "ssh", (e as Error).message);
    }
  }

  async stream(command: string, stdin: string, onLine: (line: string) => void, onEnd: (reason: string) => void): Promise<{ close(): void }> {
    if (this.closedReason) throw new ShellError("closed", this.closedReason);
    const streamId = `s${++streamSeq}`;
    let open = true;
    lineHandlers.set(streamId, {
      onLine,
      onEnd: (reason) => {
        this.streams.delete(streamId);
        if (open) {
          open = false;
          onEnd(reason);
        }
      },
    });
    this.streams.add(streamId);
    const close = () => {
      if (!open) return;
      open = false;
      lineHandlers.delete(streamId);
      this.streams.delete(streamId);
      native?.closeStream(streamId);
    };
    try {
      await call(need().stream(this.id, streamId, command, stdin));
    } catch (e) {
      close();
      throw new ShellError("closed", (e as Error).message);
    }
    return { close };
  }

  onClose(cb: (reason: string) => void): () => void {
    this.closeListeners.add(cb);
    return () => this.closeListeners.delete(cb);
  }

  close(): void {
    native?.disconnect(this.id);
    this.onClosed("closed by us");
  }

  private onClosed(reason: string): void {
    if (this.closedReason) return;
    this.closedReason = reason;
    closeHandlers.delete(this.id);
    for (const s of this.streams) lineHandlers.get(s)?.onEnd(reason);
    for (const cb of this.closeListeners) cb(reason);
  }
}
