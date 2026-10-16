import { base64Decode, type UdpTransport } from "@moshlet/core";
import { requireOptionalNativeModule, type EventSubscription } from "expo-modules-core";

interface MoshletNativeModule {
  udpOpen(host: string, port: number): number;
  udpSend(id: number, data: Uint8Array): void;
  udpClose(id: number): void;
  setLowLatencyWifi(on: boolean): void;
  addListener(event: "onDatagram", cb: (e: { id: number; data: string }) => void): EventSubscription;
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
