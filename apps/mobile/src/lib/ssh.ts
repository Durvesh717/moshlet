import * as Device from "expo-device";
import { errorCode, loadIdentity, SshConnection } from "../../modules/corral-native/ssh";
import type { Host } from "./hosts";
import { unlock } from "./unlock";

/** The comment on this device's public key, so it's recognisable in authorized_keys. */
export const keyComment = (): string =>
  `corral@${(Device.modelName ?? Device.deviceName ?? "phone").toLowerCase().replace(/[^a-z0-9._-]+/g, "-").replace(/^-|-$/g, "")}`;

/**
 * This device's SSH key, unlocked: asks for fingerprint/PIN if the key is locked (it stays usable
 * for a few minutes after). Null when the user cancels.
 */
export async function deviceIdentity(): Promise<{ publicKey: string; fingerprint: string } | null> {
  try {
    return await loadIdentity(keyComment());
  } catch (e) {
    if (errorCode(e) !== "ERR_NEEDS_UNLOCK") throw e;
  }
  if (!(await unlock("Unlock this device's SSH key", true))) return null;
  return loadIdentity(keyComment());
}

export type SignInProblem = "locked" | "host_key" | "rejected" | "network";

export class SignInError extends Error {
  readonly problem: SignInProblem;

  constructor(problem: SignInProblem, message: string) {
    super(message);
    this.problem = problem;
  }
}

/** Connects to a saved computer and signs in with this device's key. */
export async function signIn(host: Host): Promise<SshConnection> {
  let conn: SshConnection;
  try {
    conn = await SshConnection.open(host.address, host.port, host.hostKey ? { hostKey: host.hostKey, keyType: host.keyType } : undefined);
  } catch (e) {
    if (errorCode(e) === "ERR_HOST_KEY_CHANGED") throw new SignInError("host_key", (e as Error).message);
    throw new SignInError("network", (e as Error).message);
  }
  try {
    const ok = await conn.authKey(host.user);
    if (!ok) throw new SignInError("rejected", `${host.name} didn't accept this device's key for ${host.user}. Set it up again to add the key.`);
    return conn;
  } catch (e) {
    conn.close();
    if (e instanceof SignInError) throw e;
    if (errorCode(e) === "ERR_NEEDS_UNLOCK") throw new SignInError("locked", "Unlock to use this device's key.");
    throw new SignInError("network", (e as Error).message);
  }
}
