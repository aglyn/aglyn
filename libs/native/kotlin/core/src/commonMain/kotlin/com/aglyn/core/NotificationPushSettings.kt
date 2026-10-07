package com.aglyn.core

import com.aglyn.contracts.AccountPushSettings
import com.aglyn.contracts.NotificationCatalog
import com.aglyn.contracts.accountPushSwitch

/*
 * The per-type push switches. They live where the console's notification
 * settings page keeps every per-type answer: `users/{uid}.notificationSettings`
 * (NOTIFICATION_SETTINGS_FIELD), the account scope's `accountTypes[type]`, here
 * its `push` channel. The console writes that map with `setDoc(…, { merge: true })`
 * as the owner, under the same rule; the app writes the one leaf it changes the
 * same way, through [FirestoreWriter.merge].
 */

/** The user document field the console's settings page writes. */
const val NOTIFICATION_SETTINGS_FIELD = "notificationSettings"

/** The legacy per-category console mute the resolver still reads. */
const val LEGACY_NOTIFICATION_PREFS_FIELD = "notificationPrefs"

fun userDocPath(uid: String) = "users/$uid"

data class PushSwitchRow(
  val type: String,
  val label: String,
  val level: String?,
  val enabled: Boolean,
  /** The account has answered push for this exact type (not inherited). */
  val ownAnswer: Boolean,
)

data class PushSwitchCategory(val id: String, val label: String, val rows: List<PushSwitchRow>)

/** The account-scope push settings in a user document's fields; empty when absent or unreadable. */
fun accountPushSettingsOf(userData: Map<String, Any?>?): AccountPushSettings {
  val raw = userData?.get(NOTIFICATION_SETTINGS_FIELD) as? Map<*, *> ?: return AccountPushSettings()
  return runCatching {
    FirestoreDecoding.decodeFromJsonElement(AccountPushSettings.serializer(), firestoreJson(raw))
  }.getOrDefault(AccountPushSettings())
}

/** The legacy category mutes (`notificationPrefs`), booleans only. */
fun legacyNotificationPrefsOf(userData: Map<String, Any?>?): Map<String, Boolean> =
  (userData?.get(LEGACY_NOTIFICATION_PREFS_FIELD) as? Map<*, *>)
    ?.entries?.mapNotNull { (key, value) -> (value as? Boolean)?.let { key.toString() to it } }?.toMap()
    .orEmpty()

/**
 * Every catalog category with a switch per type, resolved as the server's
 * fan-out resolves push at the account scope. [pending] holds answers this
 * screen has written and not yet seen come back; they win until they do.
 */
fun pushSwitchCategories(
  catalog: NotificationCatalog,
  userData: Map<String, Any?>?,
  pending: Map<String, Boolean> = emptyMap(),
): List<PushSwitchCategory> {
  val settings = accountPushSettingsOf(userData)
  val legacy = legacyNotificationPrefsOf(userData)
  return catalog.categories.filter { it.types.isNotEmpty() }.map { category ->
    PushSwitchCategory(
      id = category.id,
      label = category.label,
      rows = category.types.map { entry ->
        PushSwitchRow(
          type = entry.type,
          label = entry.label,
          level = entry.level,
          enabled = pending[entry.type]
            ?: accountPushSwitch(settings, entry.type, category.id, entry.consoleDefault, legacy),
          ownAnswer = entry.type in pending || settings.accountTypes?.get(entry.type)?.push != null,
        )
      },
    )
  }
}

/** The merge that sets the account's push answer for one type, and nothing else. */
fun accountPushWrite(type: String, enabled: Boolean): Map<String, Any?> =
  mapOf(NOTIFICATION_SETTINGS_FIELD to mapOf("accountTypes" to mapOf(type to mapOf("push" to enabled))))

/** Writes the account's push answer for [type] to the person's own user document. */
suspend fun writeAccountPush(writer: FirestoreWriter, uid: String, type: String, enabled: Boolean) =
  writer.merge(userDocPath(uid), accountPushWrite(type, enabled))

/** The pending answers the stored document now agrees with, removed. */
fun settlePending(pending: Map<String, Boolean>, userData: Map<String, Any?>?): Map<String, Boolean> {
  val stored = accountPushSettingsOf(userData).accountTypes.orEmpty()
  return pending.filterNot { (type, value) -> stored[type]?.push == value }
}
