import { base64Decode, type UdpTransport } from "@moshlet/core";
import { requireOptionalNativeModule, type EventSubscription } from "expo-modules-core";

interface MoshletNativeModule {
  udpOpen(host: string, port: number): number;
  udpSend(id: number, data: Uint8Array): void;
  udpClose(id: number): void;
  setLowLatencyWifi(on: boolean): void;
  watchStart(title: string, text: string): void;
  watchStop(): void;
  notifyApproval(key: string, title: string, text: string, subText: string, host: string, pane: string): void;
  cancelApproval(key: string): void;
  notificationsAllowed(): boolean;
  takeOpenRequest(): OpenRequest | null;
  addListener(event: "onDatagram", cb: (e: { id: number; data: string }) => void): EventSubscription;
  addListener(event: "onWatchTick", cb: () => void): EventSubscription;
  addListener(event: "onOpenPane", cb: () => void): EventSubscription;
}

/** A tapped approval notification: the computer (its saved id) and the pane to open. */
export interface OpenRequest {
  host: string;
  pane: string;
}

const native = requireOptionalNativeModule<MoshletNativeModule>("MoshletNative");

const handlers = new Map<number, (d: Uint8Array) => void>();
native?.addListener("onDatagram", (e) => handlers.get(e.id)?.(base64Decode(e.data)));

/** mosh's UDP, through the native module. */
export const nativeUdp: UdpTransport = {
  open(host, port, onMessage) {
    if (!native) throw new Error("UDP isn't available in this build");
    const id = native.udpOpen(host, port);
    handlers.set(id, onMessage);
    return {
      send: (data) => native.udpSend(id, data),
      close: () => {
        handlers.delete(id);
        native.udpClose(id);
      },
    };
  },
};

/** Keeps Wi-Fi out of power save while a terminal is on screen (Android; a no-op elsewhere). */
export function setLowLatencyWifi(on: boolean): void {
  native?.setLowLatencyWifi(on);
}

/**
 * Approval alerts (Android; no-ops elsewhere). While watching, a foreground service keeps the app
 * running in the background and calls onTick now and then, since JavaScript timers stop there.
 */
export const alerts = {
  watch(title: string, text: string): void {
    native?.watchStart(title, text);
  },
  unwatch(): void {
    native?.watchStop();
  },
  notify(key: string, title: string, text: string, subText: string, host: string, pane: string): void {
    native?.notifyApproval(key, title, text, subText, host, pane);
  },
  cancel(key: string): void {
    native?.cancelApproval(key);
  },
  allowed(): boolean {
    return native?.notificationsAllowed() ?? false;
  },
  /** The pane a tapped notification asked for, once (see onOpen). */
  takeOpenRequest(): OpenRequest | null {
    return native?.takeOpenRequest() ?? null;
  },
  onTick(cb: () => void): EventSubscription | null {
    return native?.addListener("onWatchTick", cb) ?? null;
  },
  /** A notification was tapped: takeOpenRequest has its pane. */
  onOpen(cb: () => void): EventSubscription | null {
    return native?.addListener("onOpenPane", cb) ?? null;
  },
};
