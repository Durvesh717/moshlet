import { mkdtempSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { DeviceStore } from "../src/devices.ts";

const fresh = () => new DeviceStore(join(mkdtempSync(join(tmpdir(), "corral-devices-")), "devices.json"));

describe("DeviceStore", () => {
  it("pairs once per code, ignoring case and dashes, and persists hashed tokens (mode 600)", () => {
    const file = join(mkdtempSync(join(tmpdir(), "corral-devices-")), "devices.json");
    const store = new DeviceStore(file);
    const { code } = store.createPairingCode();
    const r = store.pair(code.toLowerCase().replace("-", " "), "  Nord  ", "nord.ts.net")!;
    expect(r.device.name).toBe("Nord");
    expect(store.pair(code, "again", undefined)).toBeNull();
    expect(statSync(file).mode & 0o777).toBe(0o600);
    const reloaded = new DeviceStore(file);
    expect(reloaded.verify(r.device.id, r.token)?.name).toBe("Nord");
    expect(JSON.stringify(reloaded.list())).not.toContain(r.token);
  });

  it("rejects wrong tokens, unknown devices and revoked devices", () => {
    const store = fresh();
    const r = store.pair(store.createPairingCode().code, "Phone", undefined)!;
    expect(store.verify(r.device.id, r.token + "x")).toBeNull();
    expect(store.verify("nope", r.token)).toBeNull();
    expect(store.revoke(r.device.id)).toBe(true);
    expect(store.verify(r.device.id, r.token)).toBeNull();
    expect(store.revoke(r.device.id)).toBe(false);
  });

  it("expires codes after ten minutes", () => {
    const store = fresh();
    const t0 = 1_000_000;
    const { code } = store.createPairingCode(t0);
    expect(store.pair(code, "late", undefined, t0 + 10 * 60_000 + 1)).toBeNull();
  });

  it("burns open codes after five wrong guesses", () => {
    const store = fresh();
    const { code } = store.createPairingCode();
    for (let i = 0; i < 5; i++) expect(store.pair("ZZZZ-ZZZZ", "guess", undefined)).toBeNull();
    expect(store.pair(code, "real", undefined)).toBeNull();
  });
});
