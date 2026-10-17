package dev.moshlet.nativebits

import android.content.Context
import android.net.wifi.WifiManager
import android.util.Base64
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import expo.modules.kotlin.typedarray.Uint8Array
import java.io.IOException
import java.net.DatagramPacket
import java.net.DatagramSocket
import java.net.InetAddress
import java.net.InetSocketAddress
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.Executors
import java.util.concurrent.atomic.AtomicInteger
import kotlin.concurrent.thread

/**
 * The few things JavaScript can't do on Android: UDP sockets for mosh, the Wi-Fi low-latency
 * lock (without it the radio naps between packets, adding 100-400 ms), and approval alerts.
 */
class MoshletNativeModule : Module() {
  private class Sock(val socket: DatagramSocket, val peer: InetSocketAddress)

  private val sockets = ConcurrentHashMap<Int, Sock>()
  private val nextId = AtomicInteger(1)
  private val sender = Executors.newSingleThreadExecutor { r -> Thread(r, "moshlet-udp-send").apply { isDaemon = true } }
  private var wifiLock: WifiManager.WifiLock? = null

  override fun definition() = ModuleDefinition {
    Name("MoshletNative")

    Events("onDatagram", "onWatchTick", "onOpenPane")

    OnCreate {
      WatchService.onTick = { sendEvent("onWatchTick", emptyMap<String, Any>()) }
      OpenRequests.onReceived = { sendEvent("onOpenPane", emptyMap<String, Any>()) }
    }

    /** Opens a socket aimed at host:port (an IP literal); datagrams from that peer arrive as onDatagram events. */
    Function("udpOpen") { host: String, port: Int ->
      val peer = InetSocketAddress(InetAddress.getByName(host), port)
      val socket = DatagramSocket()
      socket.receiveBufferSize = 1 shl 18
      val id = nextId.getAndIncrement()
      sockets[id] = Sock(socket, peer)
      thread(name = "moshlet-udp-$id", isDaemon = true) {
        // mosh-server sends datagrams up to ~1 kB; leave room for larger MTUs.
        val buf = ByteArray(4096)
        val packet = DatagramPacket(buf, buf.size)
        while (!socket.isClosed) {
          try {
            packet.setData(buf)
            socket.receive(packet)
            if (packet.address == peer.address && packet.port == peer.port) {
              val data = Base64.encodeToString(buf, 0, packet.length, Base64.NO_WRAP)
              sendEvent("onDatagram", mapOf("id" to id, "data" to data))
            }
          } catch (_: IOException) {
            if (socket.isClosed) break
          }
        }
      }
      id
    }

    Function("udpSend") { id: Int, data: Uint8Array ->
      val sock = sockets[id] ?: return@Function
      val bytes = ByteArray(data.length)
      data.read(bytes, 0, data.length)
      sender.execute {
        try {
          sock.socket.send(DatagramPacket(bytes, bytes.size, sock.peer))
        } catch (_: IOException) {
          // Offline or switching networks; mosh retransmits.
        }
      }
    }

    Function("udpClose") { id: Int ->
      sockets.remove(id)?.socket?.close()
    }

    Function("setLowLatencyWifi") { on: Boolean ->
      val context = appContext.reactContext ?: return@Function
      if (on) {
        val lock = wifiLock ?: (context.applicationContext.getSystemService(Context.WIFI_SERVICE) as WifiManager)
          .createWifiLock(WifiManager.WIFI_MODE_FULL_LOW_LATENCY, "moshlet:terminal")
          .apply { setReferenceCounted(false) }
          .also { wifiLock = it }
        if (!lock.isHeld) lock.acquire()
      } else {
        wifiLock?.takeIf { it.isHeld }?.release()
      }
    }

    /** Keeps the app running in the background for approval alerts, with an ongoing notification saying so. */
    Function("watchStart") { title: String, text: String ->
      val context = appContext.reactContext?.applicationContext ?: return@Function
      WatchService.start(context, title, text)
    }

    Function("watchStop") {
      appContext.reactContext?.applicationContext?.let { WatchService.stop(it) }
    }

    /** An agent needs approval: a notification that opens its pane, one per key (computer and pane). */
    Function("notifyApproval") { key: String, title: String, text: String, subText: String, host: String, pane: String ->
      val context = appContext.reactContext?.applicationContext ?: return@Function
      WatchService.ensureChannels(context)
      val notification = NotificationCompat.Builder(context, WatchService.CHANNEL_APPROVALS)
        .setSmallIcon(R.drawable.moshlet_notification)
        .setColor(0xFF1F5EFF.toInt())
        .setContentTitle(title)
        .setContentText(text)
        .setSubText(subText)
        .setStyle(NotificationCompat.BigTextStyle().bigText(text))
        .setCategory(NotificationCompat.CATEGORY_MESSAGE)
        .setPriority(NotificationCompat.PRIORITY_HIGH)
        .setAutoCancel(true)
        .setContentIntent(WatchService.openApp(context, key.hashCode(), host, pane))
        .build()
      try {
        NotificationManagerCompat.from(context).notify(key, 0, notification)
      } catch (_: SecurityException) {
        // Notifications were turned off in Android's settings.
      }
    }

    Function("cancelApproval") { key: String ->
      val context = appContext.reactContext?.applicationContext ?: return@Function
      NotificationManagerCompat.from(context).cancel(key, 0)
    }

    Function("notificationsAllowed") {
      val context = appContext.reactContext?.applicationContext ?: return@Function false
      NotificationManagerCompat.from(context).areNotificationsEnabled()
    }

    /** The pane a tapped approval notification asked for, once. */
    Function("takeOpenRequest") {
      OpenRequests.take()
    }

    OnDestroy {
      WatchService.onTick = null
      OpenRequests.onReceived = null
      appContext.reactContext?.applicationContext?.let { WatchService.stop(it) }
      sockets.values.forEach { it.socket.close() }
      sockets.clear()
      wifiLock?.takeIf { it.isHeld }?.release()
    }
  }
}
