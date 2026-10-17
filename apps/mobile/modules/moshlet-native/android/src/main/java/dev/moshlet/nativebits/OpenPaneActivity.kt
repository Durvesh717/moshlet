package dev.moshlet.nativebits

import android.app.Activity
import android.content.Intent
import android.os.Bundle

/**
 * Where a tapped approval notification lands: it notes the pane, brings up Moshlet and closes.
 * Handing the intent to Moshlet's own activity instead loses it when Android has stopped the app,
 * since the intent arrives before the app has loaded.
 */
class OpenPaneActivity : Activity() {
  override fun onCreate(savedInstanceState: Bundle?) {
    super.onCreate(savedInstanceState)
    OpenRequests.receive(intent)
    packageManager.getLaunchIntentForPackage(packageName)?.let { startActivity(it.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)) }
    finish()
  }
}

/** The pane a tapped notification asked for, until JavaScript takes it. */
object OpenRequests {
  @Volatile private var pending: Map<String, String>? = null

  /** Set by the module while JavaScript is around. */
  @Volatile var onReceived: (() -> Unit)? = null

  fun receive(intent: Intent?) {
    val host = intent?.getStringExtra(WatchService.EXTRA_HOST) ?: return
    val pane = intent.getStringExtra(WatchService.EXTRA_PANE) ?: return
    pending = mapOf("host" to host, "pane" to pane)
    onReceived?.invoke()
  }

  fun take(): Map<String, String>? = pending.also { pending = null }
}
