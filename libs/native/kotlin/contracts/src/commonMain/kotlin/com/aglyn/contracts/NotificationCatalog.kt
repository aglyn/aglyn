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
  /** Whether it is emailed when nobody has answered (a site's transactions are). */
  val emailDefault: Boolean = false,
  val level: String? = null,
  /** Set for a type that sends its own email: why its Email switch does not decide that. */
  val selfSentEmail: String? = null,
)

/** What a category does on each channel when nobody has answered for it. */
@Serializable
data class NotificationChannelDefaults(val console: Boolean = true, val email: Boolean = false)

/** A digest the settings page lists, under the key its sender reads in `digestPrefs`. */
@Serializable
data class NotificationDigest(val key: String, val label: String, val description: String = "")

@Serializable
data class NotificationCatalogCategory(
  val id: String,
  val label: String,
  val types: List<NotificationCatalogType> = emptyList(),
  /** What arrives in it, in the reader's words. */
  val description: String = "",
  val channelDefaults: NotificationChannelDefaults = NotificationChannelDefaults(),
)

@Serializable
data class NotificationCatalog(
  val levels: List<NotificationLevel> = emptyList(),
  /** In the order the console's settings page lists them. */
  val categories: List<NotificationCatalogCategory> = emptyList(),
  val digests: List<NotificationDigest> = emptyList(),
  val digestPrefsField: String = "digestPrefs",
  val insightDigestsField: String = "insightDigests",
) {
  fun entry(type: String?): NotificationCatalogType? = type?.let { t -> categories.firstNotNullOfOrNull { c -> c.types.firstOrNull { it.type == t } } }

  /** The category a type falls in: its prefix when that category exists, else `system` (`notificationCategory`). */
  fun categoryOf(type: String): String {
    val prefix = type.substringBefore('.')
    return if (categories.any { it.id == prefix }) prefix else "system"
  }

  /** A row's level as the console reads it: the level its emitter stamped, else its type's, else info. */
  fun level(stamped: String?, type: String?): String =
    stamped?.takeIf { s -> levels.any { it.id == s } } ?: entry(type)?.level ?: "info"
}

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
