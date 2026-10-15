import * as LocalAuthentication from "expo-local-authentication";

const VALID_MS = 5 * 60_000;
let unlockedAt = 0;

/**
 * Asks for fingerprint, face or the device PIN before this device's SSH key is used, at most every
 * five minutes (`force` asks regardless). Strong biometrics or the PIN only: those are what let
 * the key out of the Keystore. Devices without any lock screen skip it.
 */
export async function unlock(reason: string, force = false): Promise<boolean> {
  if (!force && Date.now() - unlockedAt < VALID_MS) return true;
  const level = await LocalAuthentication.getEnrolledLevelAsync();
  if (level === LocalAuthentication.SecurityLevel.NONE) return true;
  const r = await LocalAuthentication.authenticateAsync({
    promptMessage: reason,
    disableDeviceFallback: false,
    cancelLabel: "Cancel",
    biometricsSecurityLevel: "strong",
  });
  if (r.success) unlockedAt = Date.now();
  return r.success;
}
