import * as LocalAuthentication from "expo-local-authentication";

const VALID_MS = 5 * 60_000;
let unlockedAt = 0;

/**
 * Asks for fingerprint, face or the device PIN before a host's token is used, at most every five
 * minutes. Devices without any lock screen skip it (there's nothing to check against).
 */
export async function unlock(reason: string): Promise<boolean> {
  if (Date.now() - unlockedAt < VALID_MS) return true;
  const level = await LocalAuthentication.getEnrolledLevelAsync();
  if (level === LocalAuthentication.SecurityLevel.NONE) return true;
  const r = await LocalAuthentication.authenticateAsync({ promptMessage: reason, disableDeviceFallback: false, cancelLabel: "Cancel" });
  if (r.success) unlockedAt = Date.now();
  return r.success;
}
