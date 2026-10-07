package com.aglyn.core

import android.util.Log
import com.google.firebase.firestore.FieldValue
import com.google.firebase.firestore.SetOptions
import com.google.firebase.messaging.FirebaseMessaging
import kotlinx.coroutines.tasks.await
import kotlin.random.Random

/**
 * Registers this install for push over FCM: the registration token goes into
 * users/{uid}/devices/{installId} with the row [fcmDeviceRow] builds.
 *
 * FCM needs a real Firebase Android app. Against the emulator stack (a demo-
 * project with a placeholder app id) the token request fails; that is logged
 * once and the app carries on without push.
 */
class FcmPushRegistrar(
  private val firebase: AndroidFirebase,
  private val prefs: KeyValueStore,
  private val app: AglynAppId,
  private val appVersion: String?,
) : PushRegistrar {
  private val messaging: FirebaseMessaging? =
    runCatching { firebase.app.get(FirebaseMessaging::class.java) }.getOrNull()

  /** A stable id for this install: the device row's document id. */
  fun installId(): String = prefs.get(INSTALL_ID_KEY) ?: buildString {
    val alphabet = "abcdefghijklmnopqrstuvwxyz0123456789"
    repeat(20) { append(alphabet[Random.nextInt(alphabet.length)]) }
  }.also { prefs.set(INSTALL_ID_KEY, it) }

  override suspend fun register(uid: String): Boolean {
    val token = try {
      messaging?.token?.await()
    } catch (error: Exception) {
      Log.i(TAG, "push is off for this install: no FCM token (${error.message})")
      null
    } ?: return false
    return write(uid, token)
  }

  /** Writes the row for [token]; also called when FCM rotates the token. */
  suspend fun write(uid: String, token: String): Boolean {
    val firstKey = "$REGISTERED_KEY.$uid"
    val first = prefs.get(firstKey) == null
    val row = fcmDeviceRow(token, app, appVersion, first) ?: return false
    val fields = row.mapValues { (_, value) -> if (value === ServerTimestamp) FieldValue.serverTimestamp() else value }
    return try {
      firebase.firestore.document(deviceRowPath(uid, installId())).set(fields, SetOptions.merge()).await()
      prefs.set(firstKey, "1")
      true
    } catch (error: Exception) {
      Log.w(TAG, "could not write this install's device row", error)
      false
    }
  }

  override suspend fun unregister(uid: String) {
    runCatching { firebase.firestore.document(deviceRowPath(uid, installId())).delete().await() }
    prefs.set("$REGISTERED_KEY.$uid", null)
  }

  companion object {
    private const val TAG = "AglynPush"
    private const val INSTALL_ID_KEY = "aglyn.installId"
    private const val REGISTERED_KEY = "aglyn.push.registered"
  }
}
