package com.aglyn.shell

import android.app.NotificationChannel
import android.app.NotificationManager
import android.content.Context
import android.media.AudioAttributes
import android.media.MediaPlayer
import android.net.Uri
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.remember
import androidx.compose.ui.platform.LocalContext
import com.aglyn.contracts.Contracts

/** The app's raw resource for a sound (`aglyn_sound_<id>`), or null when this app does not carry it (Aglyn POS). */
internal fun soundUri(context: Context, resource: String): Uri? {
  val id = context.resources.getIdentifier(resource, "raw", context.packageName)
  return if (id == 0) null else Uri.parse("android.resource://${context.packageName}/$id")
}

/**
 * One channel per notification sound, named after it (`aglyn_sound_<id>`, "Xylophone"), at high importance with that sound.
 * A channel's sound is fixed once it exists, which is why each sound has its own and a message names the one its person
 * picked. Created at launch and before posting; an app without the files makes none.
 */
internal fun ensureSoundChannels(context: Context, manager: NotificationManager) {
  val attributes = AudioAttributes.Builder()
    .setUsage(AudioAttributes.USAGE_NOTIFICATION)
    .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
    .build()
  for (sound in Contracts.notificationSounds) {
    if (manager.getNotificationChannel(sound.android) != null) continue
    val uri = soundUri(context, sound.android) ?: continue
    manager.createNotificationChannel(
      NotificationChannel(sound.android, sound.label, NotificationManager.IMPORTANCE_HIGH).apply { setSound(uri, attributes) },
    )
  }
}

/** The channel a foreground message posts on: the one it names when this app has it, else the default channel. */
internal fun postingChannel(context: Context, named: String?): String {
  val manager = context.getSystemService(NotificationManager::class.java) ?: return NOTIFICATION_CHANNEL
  return named?.takeIf { manager.getNotificationChannel(it) != null } ?: NOTIFICATION_CHANNEL
}

@Composable
internal actual fun rememberSoundPreview(): ((resource: String) -> Unit)? {
  val context = LocalContext.current
  val player = remember { arrayOfNulls<MediaPlayer>(1) }
  DisposableEffect(Unit) { onDispose { player[0]?.release(); player[0] = null } }
  // Only where the app carries the files: Aglyn POS has none, so it offers no picker.
  if (soundUri(context, Contracts.notificationSounds.firstOrNull()?.android ?: return null) == null) return null
  return remember(context) {
    { resource: String ->
      player[0]?.release()
      player[0] = soundUri(context, resource)?.let { uri ->
        MediaPlayer.create(context, uri)?.apply {
          setOnCompletionListener { it.release(); if (player[0] === it) player[0] = null }
          start()
        }
      }
    }
  }
}
