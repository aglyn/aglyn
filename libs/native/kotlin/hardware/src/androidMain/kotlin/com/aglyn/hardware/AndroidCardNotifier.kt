package com.aglyn.hardware

import android.app.ActivityManager
import android.app.Notification
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build

/**
 * Posts "Card not approved" as a local notification when the app is not on screen (Apple 5.12, as Aglyn POS on iPhone
 * does). [channel] is the app's notification channel, made by [ensureChannel]; a tap opens [launchActivity], where the
 * sale is still open. Without the notification permission (Android 13+) nothing is posted.
 */
class AndroidCardNotifier(
  context: Context,
  private val channel: String,
  private val launchActivity: Class<*>,
  private val ensureChannel: (Context) -> Unit,
) : CardNotApprovedNotifier {
  private val context = context.applicationContext

  override fun notifyIfAway(note: CardNotApprovedNotification) {
    if (onScreen()) return
    if (Build.VERSION.SDK_INT >= 33 &&
      context.checkSelfPermission(android.Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED
    ) {
      return
    }
    ensureChannel(context)
    val tap = Intent(context, launchActivity).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP)
    val open = PendingIntent.getActivity(context, NOTIFICATION_ID, tap, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
    val notification = Notification.Builder(context, channel)
      .setSmallIcon(context.applicationInfo.icon)
      .setContentTitle(note.title)
      .setContentText(note.body)
      .setStyle(Notification.BigTextStyle().bigText(note.body))
      .setAutoCancel(true)
      .setContentIntent(open)
      .build()
    runCatching { context.getSystemService(NotificationManager::class.java)?.notify(NOTIFICATION_ID + (System.nanoTime() % 1000).toInt(), notification) }
  }

  /** The app's process is in the foreground: the checkout on screen already says it. */
  private fun onScreen(): Boolean {
    val info = ActivityManager.RunningAppProcessInfo()
    ActivityManager.getMyMemoryState(info)
    return info.importance <= ActivityManager.RunningAppProcessInfo.IMPORTANCE_FOREGROUND
  }

  private companion object {
    const val NOTIFICATION_ID = 0x5a1e
  }
}
