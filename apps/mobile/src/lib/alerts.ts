import { router } from "expo-router";
import * as SecureStore from "expo-secure-store";
import { Linking, PermissionsAndroid, Platform } from "react-native";
import { alerts, type OpenRequest } from "../../modules/moshlet-native";
import { activeSession, openHost } from "./session";
import { toast, useApp } from "./store";
import { unlock } from "./unlock";

const KEY = "moshlet.alerts";

/** Approval alerts are Android-only for now (iOS has no native module yet). */
export const alertsSupported = Platform.OS === "android";

export async function loadAlerts(): Promise<void> {
  const saved = await SecureStore.getItemAsync(KEY).catch(() => null);
  useApp.setState({ alerts: alertsSupported && saved === "on" });
}

/** The Settings switch. Turning it on asks for Android's notification permission first. */
export async function setAlerts(on: boolean): Promise<void> {
  if (on && !(await mayNotify())) {
    toast("Notifications are off for Moshlet in Android's settings");
    void Linking.openSettings();
    return;
  }
  useApp.setState({ alerts: on });
  void SecureStore.setItemAsync(KEY, on ? "on" : "off");
  activeSession()?.syncWatch();
}

async function mayNotify(): Promise<boolean> {
  if (!alertsSupported) return false;
  if (Number(Platform.Version) >= 33) {
    const result = await PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.POST_NOTIFICATIONS);
    if (result !== PermissionsAndroid.RESULTS.GRANTED) return false;
  }
  return alerts.allowed();
}

/**
 * A tapped approval notification: open that pane. With the computer open, that's the workspace on
 * screen; otherwise open the computer the way the home screen does, starting on that pane.
 */
export async function openFromAlert(r: OpenRequest): Promise<void> {
  const session = activeSession();
  if (session?.host.id === r.host) {
    session.openPane(r.pane);
    return;
  }
  const host = useApp.getState().hosts.find((h) => h.id === r.host);
  if (!host || !(await unlock(`Open ${host.name}`))) return;
  openHost({ ...host, lastPane: { ...host.lastPane, [host.session]: r.pane }, lastUsedAt: Date.now() });
  router.push("/workspace");
}
