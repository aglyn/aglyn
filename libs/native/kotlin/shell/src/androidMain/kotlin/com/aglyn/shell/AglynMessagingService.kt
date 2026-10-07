package com.aglyn.shell

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import com.aglyn.core.AuthState
import com.aglyn.core.FcmPushRegistrar
import com.google.firebase.messaging.FirebaseMessagingService
import com.google.firebase.messaging.RemoteMessage
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch

/** The extra a notification's tap carries: the console link it points at. */
const val EXTRA_LINK = "link"

/** The channel every Aglyn notification posts to. */
const val NOTIFICATION_CHANNEL = "aglyn"

/**
 * FCM's entry point for an app: a rotated token rewrites the device row, and a
 * message that arrives while the app is open is shown like one that arrived
 * in the background (FCM shows those itself), opening its link on a tap.
 */
abstract class AglynMessagingService : FirebaseMessagingService() {
  /** The app's shell services. */
  protected abstract val services: ShellServices

  /** The activity a tap opens. */
  protected abstract val launchActivity: Class<*>

  private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)

  override fun onNewToken(token: String) {
    val user = (services.auth.state.value as? AuthState.SignedIn)?.user ?: return
    val push = services.push as? FcmPushRegistrar ?: return
    scope.launch { push.write(user.uid, token) }
  }

  override fun onMessageReceived(message: RemoteMessage) {
    val title = message.notification?.title ?: message.data["title"] ?: return
    val body = message.notification?.body ?: message.data["body"]
    ensureChannel(this)
    val tap = Intent(this, launchActivity).apply {
      flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP
      message.data[EXTRA_LINK]?.let { putExtra(EXTRA_LINK, it) }
    }
    val pending = PendingIntent.getActivity(
      this,
      message.messageId?.hashCode() ?: 0,
      tap,
      PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
    )
    val notification = NotificationCompat.Builder(this, NOTIFICATION_CHANNEL)
      .setSmallIcon(applicationInfo.icon)
      .setContentTitle(title)
      .setContentText(body)
      .setAutoCancel(true)
      .setContentIntent(pending)
      .build()
    runCatching { NotificationManagerCompat.from(this).notify(message.messageId?.hashCode() ?: 0, notification) }
  }

  companion object {
    fun ensureChannel(context: Context) {
      val manager = context.getSystemService(NotificationManager::class.java) ?: return
      if (manager.getNotificationChannel(NOTIFICATION_CHANNEL) == null) {
        manager.createNotificationChannel(NotificationChannel(NOTIFICATION_CHANNEL, "Notifications", NotificationManager.IMPORTANCE_HIGH))
      }
    }
  }
}
