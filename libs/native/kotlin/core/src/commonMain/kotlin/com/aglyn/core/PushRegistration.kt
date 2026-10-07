package com.aglyn.core

/*
 * The push device registry: one row per install at
 * users/{uid}/devices/{installId}, owner-only under the rules. A row names
 * its transport, so the server's fan-out sends each by its own provider.
 */

/** The subcollection under users/{uid} that holds device rows. */
const val DEVICES_COLLECTION = "devices"

/** The longest `appVersion` the rules accept. */
const val DEVICE_APP_VERSION_MAX = 32

private val FCM_TOKEN = Regex("^[A-Za-z0-9_:-]{100,4096}$")

/** True for a string the rules accept as an FCM registration token. */
fun isFcmToken(token: String?): Boolean = token != null && FCM_TOKEN.matches(token)

/** Stands for the server's write time; each platform writes its own sentinel. */
object ServerTimestamp

/**
 * The fields of an Android install's row, exactly the keys the rules accept:
 * token, transport, platform, app, appVersion (at most 32 characters),
 * lastSeen, and createdAt on the install's first write. Null for a token the
 * rules would refuse.
 */
fun fcmDeviceRow(token: String, app: AglynAppId, appVersion: String?, firstWrite: Boolean): Map<String, Any>? {
  if (!isFcmToken(token)) return null
  return buildMap {
    put("token", token)
    put("transport", "fcm")
    put("platform", "android")
    put("app", app.wire)
    appVersion?.trim()?.takeIf { it.isNotEmpty() }?.let { put("appVersion", it.take(DEVICE_APP_VERSION_MAX)) }
    put("lastSeen", ServerTimestamp)
    if (firstWrite) put("createdAt", ServerTimestamp)
  }
}

/** The path of an install's row. */
fun deviceRowPath(uid: String, installId: String) = "users/$uid/$DEVICES_COLLECTION/$installId"

/** Registers and removes this install's device row; a platform without push uses [NoPush]. */
interface PushRegistrar {
  /** Writes or refreshes the row. Never throws; false when this install cannot be pushed to. */
  suspend fun register(uid: String): Boolean

  /** Deletes the row, before the person signs out. Never throws. */
  suspend fun unregister(uid: String)
}

object NoPush : PushRegistrar {
  override suspend fun register(uid: String) = false
  override suspend fun unregister(uid: String) = Unit
}
