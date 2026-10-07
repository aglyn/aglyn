package com.aglyn.contracts

import kotlinx.serialization.Serializable

/*
 * The member notification catalog (notification-catalog.generated.json):
 * every category and type a person can be notified of, with the label the
 * console's settings page shows and what the console feed does by default.
 */

@Serializable
data class NotificationLevel(val id: String, val label: String)

@Serializable
data class NotificationCatalogType(
  val type: String,
  val label: String,
  /** What the console feed does for this type when nobody has answered. */
  val consoleDefault: Boolean = true,
  val level: String? = null,
)

@Serializable
data class NotificationCatalogCategory(
  val id: String,
  val label: String,
  val types: List<NotificationCatalogType> = emptyList(),
)

@Serializable
data class NotificationCatalog(
  val levels: List<NotificationLevel> = emptyList(),
  /** In the order the console's settings page lists them. */
  val categories: List<NotificationCatalogCategory> = emptyList(),
)

/** The catalog this build carries, decoded once. */
val Notifications: NotificationCatalog by lazy {
  ContractJsonFormat.decodeFromString(NotificationCatalog.serializer(), NotificationCatalogJson)
}

/**
 * What the app's per-type push switch shows, ported from `accountPushSwitch`
 * (libs/aglyn/src/lib/app-utils/mobile-push.ts): the account's push answer
 * for the type, then for its category; otherwise what the console feed does
 * at the account scope (its console answers, the legacy category mute in
 * `notificationPrefs`, then [consoleDefault]). The function cases replay the
 * TypeScript's answers.
 */
fun accountPushSwitch(
  settings: AccountPushSettings?,
  type: String,
  category: String,
  consoleDefault: Boolean,
  legacyPrefs: Map<String, Boolean>? = null,
): Boolean {
  settings?.accountTypes?.get(type)?.push?.let { return it }
  settings?.account?.get(category)?.push?.let { return it }
  settings?.accountTypes?.get(type)?.console?.let { return it }
  settings?.account?.get(category)?.console?.let { return it }
  if (legacyPrefs?.get(category) == false) return false
  return consoleDefault
}
