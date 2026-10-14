import { createHash, randomBytes, randomInt, timingSafeEqual } from "node:crypto";
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

export const STATE_DIR =
  process.env.CORRAL_AGENT_DIR ?? join(process.env.XDG_CONFIG_HOME ?? join(homedir(), ".config"), "corral-agent");

export interface Device {
  id: string;
  name: string;
  tokenSha256: string;
  createdAt: string;
  lastSeenAt?: string;
  /** Tailscale node the device paired from, for the device list. */
  node?: string;
}

interface Pairing {
  expiresAt: number;
  attempts: number;
}

const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const PAIRING_TTL_MS = 10 * 60_000;
const MAX_ATTEMPTS = 5;

/**
 * Paired devices, persisted as JSON (mode 600), and short-lived pairing codes, kept in memory.
 * A device proves itself with a random token; only its SHA-256 is stored.
 */
export class DeviceStore {
  private devices: Device[];
  private readonly pairings = new Map<string, Pairing>();
  private readonly file: string;

  constructor(file = join(STATE_DIR, "devices.json")) {
    this.file = file;
    try {
      this.devices = (JSON.parse(readFileSync(file, "utf8")) as { devices: Device[] }).devices ?? [];
    } catch {
      this.devices = [];
    }
  }

  list(): Device[] {
    return this.devices.map((d) => ({ ...d }));
  }

  /** A one-time code like "K7QM-3XRP", valid for ten minutes. */
  createPairingCode(now = Date.now()): { code: string; expiresAt: number } {
    let raw = "";
    for (let i = 0; i < 8; i++) raw += CODE_ALPHABET[randomInt(CODE_ALPHABET.length)];
    const code = `${raw.slice(0, 4)}-${raw.slice(4)}`;
    const expiresAt = now + PAIRING_TTL_MS;
    this.pairings.set(normalize(code), { expiresAt, attempts: 0 });
    return { code, expiresAt };
  }

  /** Spends a pairing code on a new device. Wrong guesses count against every open code. */
  pair(code: string, name: string, node: string | undefined, now = Date.now()): { device: Device; token: string } | null {
    for (const [c, p] of this.pairings) if (p.expiresAt <= now || p.attempts >= MAX_ATTEMPTS) this.pairings.delete(c);
    const key = normalize(code);
    if (!this.pairings.has(key)) {
      for (const p of this.pairings.values()) p.attempts++;
      return null;
    }
    this.pairings.delete(key);
    const token = randomBytes(32).toString("base64url");
    const device: Device = {
      id: randomBytes(6).toString("hex"),
      name: name.trim().slice(0, 64) || "device",
      tokenSha256: sha256(token),
      createdAt: new Date(now).toISOString(),
      ...(node ? { node } : {}),
    };
    this.devices.push(device);
    this.save();
    return { device, token };
  }

  verify(deviceId: string, token: string): Device | null {
    const d = this.devices.find((x) => x.id === deviceId);
    if (!d) return null;
    const a = Buffer.from(d.tokenSha256, "hex");
    const b = Buffer.from(sha256(token), "hex");
    return a.length === b.length && timingSafeEqual(a, b) ? d : null;
  }

  touch(deviceId: string, now = Date.now()): void {
    const d = this.devices.find((x) => x.id === deviceId);
    if (!d) return;
    d.lastSeenAt = new Date(now).toISOString();
    this.save();
  }

  revoke(deviceId: string): boolean {
    const before = this.devices.length;
    this.devices = this.devices.filter((d) => d.id !== deviceId);
    if (this.devices.length === before) return false;
    this.save();
    return true;
  }

  private save(): void {
    mkdirSync(dirname(this.file), { recursive: true, mode: 0o700 });
    const tmp = `${this.file}.tmp`;
    writeFileSync(tmp, JSON.stringify({ devices: this.devices }, null, 2) + "\n", { mode: 0o600 });
    renameSync(tmp, this.file);
  }
}

const normalize = (code: string): string => code.toUpperCase().replace(/[^A-Z0-9]/g, "");
const sha256 = (s: string): string => createHash("sha256").update(s).digest("hex");
