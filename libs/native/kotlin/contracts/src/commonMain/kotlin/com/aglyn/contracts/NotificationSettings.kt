package com.aglyn.contracts

/*
 * The console's notification settings, as its settings page reads them
 * (`libs/aglyn/src/lib/app-utils/notifications.ts`): `users/{uid}.notificationSettings`
 * holds answers per channel at four layers (the account's categories and
 * types, and each workspace's and site's categories and types), and a missing
 * answer inherits from the layer above. The settings cases replay the
 * TypeScript's answers (notification-settings-cases.generated.json).
 *
 * Values are the plain maps a Firestore read hands out, so a layer the app
 * does not know yet survives a read-modify-write untouched.
 */

/** The channels the console's settings page edits per category and type. */
enum class NotificationChannel(val wire: String, val label: String) {
  CONSOLE("console", "In the app"),
  EMAIL("email", "Email"),
  PUSH("push", "Push"),
}

/** Where an answer is stored: the account, one workspace, or one site. */
sealed interface NotificationScope {
  data object Account : NotificationScope
  data class Org(val id: String) : NotificationScope
  data class Host(val id: String) : NotificationScope
}

@Suppress("UNCHECKED_CAST")
private fun Any?.map(): Map<String, Any?>? = this as? Map<String, Any?>

/** The category layer for [scope]: `account`, `orgs[id]` or `hosts[id]`. */
fun notificationCategoryLayer(settings: Map<String, Any?>?, scope: NotificationScope): Map<String, Any?>? = when (scope) {
  NotificationScope.Account -> settings?.get("account").map()
  is NotificationScope.Org -> settings?.get("orgs").map()?.get(scope.id).map()
  is NotificationScope.Host -> settings?.get("hosts").map()?.get(scope.id).map()
}

/** The type layer for [scope]: `accountTypes`, `orgTypes[id]` or `hostTypes[id]`. */
fun notificationTypeLayer(settings: Map<String, Any?>?, scope: NotificationScope): Map<String, Any?>? = when (scope) {
  NotificationScope.Account -> settings?.get("accountTypes").map()
  is NotificationScope.Org -> settings?.get("orgTypes").map()?.get(scope.id).map()
  is NotificationScope.Host -> settings?.get("hostTypes").map()?.get(scope.id).map()
}

/** The keys (field names) a scope's layers live under, outermost first. */
fun notificationLayerPath(scope: NotificationScope, types: Boolean): List<String> = when (scope) {
  NotificationScope.Account -> listOf(if (types) "accountTypes" else "account")
  is NotificationScope.Org -> listOf(if (types) "orgTypes" else "orgs", scope.id)
  is NotificationScope.Host -> listOf(if (types) "hostTypes" else "hosts", scope.id)
}

/** A scope's own answer for a category on a channel, or null to inherit (`notificationScopePref`). */
fun notificationScopePref(settings: Map<String, Any?>?, scope: NotificationScope, category: String, channel: NotificationChannel): Boolean? =
  notificationCategoryLayer(settings, scope)?.get(category).map()?.get(channel.wire) as? Boolean

/** A scope's own answer for a type on a channel, or null to inherit (`notificationScopeTypePref`). */
fun notificationScopeTypePref(settings: Map<String, Any?>?, scope: NotificationScope, type: String, channel: NotificationChannel): Boolean? =
  notificationTypeLayer(settings, scope)?.get(type).map()?.get(channel.wire) as? Boolean

/**
 * The account card's switch for a category: its own answer, else the legacy
 * console mute, else the category's default.
 */
fun notificationCategoryValue(
  catalog: NotificationCatalog,
  settings: Map<String, Any?>?,
  legacy: Map<String, Boolean>?,
  category: String,
  channel: NotificationChannel,
): Boolean {
  notificationScopePref(settings, NotificationScope.Account, category, channel)?.let { return it }
  if (channel == NotificationChannel.CONSOLE && legacy?.get(category) == false) return false
  val defaults = catalog.categories.firstOrNull { it.id == category }?.channelDefaults ?: NotificationChannelDefaults()
  return if (channel == NotificationChannel.EMAIL) defaults.email else defaults.console
}

/**
 * What happens for one type at the account layer: its own answer, its
 * category's, the legacy console mute, then the type's default
 * (`notificationChannelEnabled` with no scope). Push is not a console
 * channel; its switch is [accountPushSwitch].
 */
fun notificationTypeValue(
  catalog: NotificationCatalog,
  settings: Map<String, Any?>?,
  legacy: Map<String, Boolean>?,
  type: String,
  channel: NotificationChannel,
): Boolean {
  val category = catalog.categoryOf(type)
  notificationScopeTypePref(settings, NotificationScope.Account, type, channel)?.let { return it }
  notificationScopePref(settings, NotificationScope.Account, category, channel)?.let { return it }
  if (channel == NotificationChannel.CONSOLE && legacy?.get(category) == false) return false
  val entry = catalog.entry(type)
  return when (channel) {
    NotificationChannel.EMAIL -> entry?.emailDefault ?: catalog.categories.firstOrNull { it.id == category }?.channelDefaults?.email ?: false
    else -> entry?.consoleDefault ?: true
  }
}

data class OverriddenScopes(val orgIds: List<String>, val hostIds: List<String>)

/** The workspaces and sites with at least one answer of their own (`notificationOverriddenScopes`). */
fun notificationOverriddenScopes(settings: Map<String, Any?>?): OverriddenScopes {
  fun answered(layer: Map<String, Any?>?) = layer.orEmpty().values.any { channels -> channels.map().orEmpty().values.any { it is Boolean } }
  fun named(categories: Map<String, Any?>?, types: Map<String, Any?>?) =
    (categories.orEmpty().keys + types.orEmpty().keys).toSortedSet()
      .filter { answered(categories?.get(it).map()) || answered(types?.get(it).map()) }
  return OverriddenScopes(
    orgIds = named(settings?.get("orgs").map(), settings?.get("orgTypes").map()),
    hostIds = named(settings?.get("hosts").map(), settings?.get("hostTypes").map()),
  )
}

/** Whether a digest is on: everything is, until switched off (`digestEnabled`). */
fun digestEnabled(prefs: Map<String, Any?>?, key: String): Boolean = prefs?.get(key) != false

/** Whether a person asked for a workspace's weekly insights (`insightDigestSubscribed`). */
fun insightDigestSubscribed(value: Map<String, Any?>?, orgId: String): Boolean = orgId.isNotEmpty() && value?.get(orgId) == true
