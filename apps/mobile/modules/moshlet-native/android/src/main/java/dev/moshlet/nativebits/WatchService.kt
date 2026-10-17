package dev.moshlet.nativebits

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import android.os.PowerManager
import androidx.core.app.NotificationCompat
import androidx.core.app.ServiceCompat
import androidx.core.content.ContextCompat

/**
 * Keeps Moshlet running while it's in the background with approval alerts on, so the SSH link
 * and herdr's events keep flowing: a foreground service (with its quiet ongoing notification)
 * and a partial wake lock. JavaScript timers stop once the app is in the background, so the
 * service also ticks, and the app polls and reconnects on each tick.
 */
class WatchService : Service() {
  companion object {
    const val CHANNEL_WATCH = "watch"
    const val CHANNEL_APPROVALS = "approvals"
    private const val ONGOING_ID = 1
    private const val TICK_MS = 20_000L
    const val EXTRA_HOST = "dev.moshlet.host"
    const val EXTRA_PANE = "dev.moshlet.pane"

    /** Set by the module while JavaScript is around. */
    @Volatile var onTick: (() -> Unit)? = null

    fun start(context: Context, title: String, text: String) {
      val intent = Intent(context, WatchService::class.java).putExtra("title", title).putExtra("text", text)
      ContextCompat.startForegroundService(context, intent)
    }

    fun stop(context: Context) {
      context.stopService(Intent(context, WatchService::class.java))
    }

    fun ensureChannels(context: Context) {
      if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
      val nm = context.getSystemService(NotificationManager::class.java)
      nm.createNotificationChannel(
        NotificationChannel(CHANNEL_APPROVALS, "Approvals", NotificationManager.IMPORTANCE_HIGH).apply {
          description = "When an agent needs you to approve something"
        },
      )
      nm.createNotificationChannel(
        NotificationChannel(CHANNEL_WATCH, "Watching agents", NotificationManager.IMPORTANCE_LOW).apply {
          description = "Shown while Moshlet keeps the connection open for approval alerts"
          setShowBadge(false)
        },
      )
    }

    /** Opens Moshlet, and with a host and pane, that pane (through OpenPaneActivity). */
    fun openApp(context: Context, requestCode: Int, host: String? = null, pane: String? = null): PendingIntent? {
      val intent = if (host == null || pane == null) context.packageManager.getLaunchIntentForPackage(context.packageName) ?: return null
      else Intent(context, OpenPaneActivity::class.java).putExtra(EXTRA_HOST, host).putExtra(EXTRA_PANE, pane)
      intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
      return PendingIntent.getActivity(context, requestCode, intent, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
    }
  }

  private val handler = Handler(Looper.getMainLooper())
  private var wakeLock: PowerManager.WakeLock? = null
  private val tick = object : Runnable {
    override fun run() {
      onTick?.invoke()
      handler.postDelayed(this, TICK_MS)
    }
  }

  override fun onBind(intent: Intent?): IBinder? = null

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    ensureChannels(this)
    val notification: Notification = NotificationCompat.Builder(this, CHANNEL_WATCH)
      .setSmallIcon(R.drawable.moshlet_notification)
      .setContentTitle(intent?.getStringExtra("title") ?: "Watching your agents")
      .setContentText(intent?.getStringExtra("text") ?: "")
      .setOngoing(true)
      .setSilent(true)
      .setPriority(NotificationCompat.PRIORITY_LOW)
      .setContentIntent(openApp(this, 0))
      .build()
    val type = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE else 0
    ServiceCompat.startForeground(this, ONGOING_ID, notification, type)
    if (wakeLock == null) {
      wakeLock = (getSystemService(Context.POWER_SERVICE) as PowerManager)
        .newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "moshlet:watch")
        .apply { setReferenceCounted(false); acquire() }
      handler.postDelayed(tick, TICK_MS)
    }
    // Started again by the app when it next opens a computer, not by the system.
    return START_NOT_STICKY
  }

  override fun onDestroy() {
    handler.removeCallbacks(tick)
    wakeLock?.takeIf { it.isHeld }?.release()
    wakeLock = null
    super.onDestroy()
  }
}
