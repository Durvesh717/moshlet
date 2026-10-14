import dgram from "node:dgram";
import type { UdpTransport } from "../mosh/client.ts";

/** UdpTransport over node:dgram, for Node (tests, tools). Phones use a native module instead. */
export const nodeUdp: UdpTransport = {
  open(host, port, onMessage) {
    const sock = dgram.createSocket(host.includes(":") ? "udp6" : "udp4");
    sock.on("message", (msg, from) => {
      if (from.port === port) onMessage(new Uint8Array(msg.buffer, msg.byteOffset, msg.length));
    });
    sock.on("error", () => {});
    sock.bind();
    let closed = false;
    return {
      send: (d) => {
        if (!closed) sock.send(d, port, host);
      },
      close: () => {
        if (!closed) {
          closed = true;
          sock.close();
        }
      },
    };
  },
};
