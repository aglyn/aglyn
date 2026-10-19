package com.aglyn.shell

import com.aglyn.contracts.NativeNavAction
import com.aglyn.contracts.NativeNavListId
import com.aglyn.contracts.resolveEnabledPlugins
import com.aglyn.contracts.resolveHostEnabledPlugins
import com.aglyn.contracts.resolveNavList
import com.aglyn.pluginhost.NativePluginRegistry

/*
 * The shell's navigation as the nav manifest (AGL-3943) draws it: the lists one scope shows, keyed so the navigator can
 * select a row, a row's sections and the settings modes. Labels, order and icons are the manifest's, so the Kotlin and
 * Apple shells and the console use the same words.
 */

/** A section inside a row's area (Deals inside CRM), shown as the area's own tabs. */
/** One section of a row; [docs] is its help page on the docs site (path and anchor), when it has its own. */
data class NavSectionItem(val key: String, val id: String, val label: String, val screen: String, val params: Map<String, String>, val docs: String? = null)

/** One row: its key on the navigator, its words and icon, what it opens and what sits inside it. */
data class NavItem(
  val key: String,
  val rowId: String,
  val listId: NativeNavListId,
  val label: String,
  /** A Material Symbols name, as `AglynIcons.named` takes it. */
  val icon: String,
  val screen: String,
  val params: Map<String, String>,
  val description: String?,
  val sections: List<NavSectionItem>,
  val actions: List<NativeNavAction>,
  val pluginId: String?,
  val keywords: List<String>,
  /** Where the row's twin lives in the console, for the page the AI panel says it is reading. */
  val console: com.aglyn.contracts.NativeNavConsoleRef? = null,
  /** The row's help page on the docs site (path and anchor), which Help docs opens while it is on screen. */
  val docs: String? = null,
) {
  /** The help page for [key] on screen: its section's own, else the row's. */
  fun docsFor(key: String): String? = sections.firstOrNull { it.key == key }?.docs ?: docs

  /** Every navigator key that belongs to this row: its own and its sections'. */
  val keys: Set<String> get() = setOf(key) + sections.map { it.key }

  /** A settings mode's entry row (Site settings), rather than a screen. */
  val opensSettings: NativeNavListId? get() = when (screen) {
    NavKeys.SITE_SETTINGS -> NativeNavListId.SITE_SETTINGS
    NavKeys.WORKSPACE_SETTINGS -> NativeNavListId.WORKSPACE_SETTINGS
    else -> null
  }
}

data class NavGroupItem(
  val id: String,
  val label: String?,
  val foldable: Boolean,
  /** `starred`: drawn from the person's starred items, not from rows. */
  val dynamic: String?,
  val rows: List<NavItem>,
)

/** The navigator's keys for manifest destinations. */
object NavKeys {
  const val ANALYTICS_SCREEN = "shell.analytics"
  const val HOME_SCREEN = "shell.home"
  const val SITE_SETTINGS = "shell.siteSettings"
  const val WORKSPACE_SETTINGS = "shell.workspaceSettings"

  /** A screen with its params as one key: `screen:site.setup?section=seo`. */
  fun of(screen: String, params: Map<String, String>? = null): String {
    if (screen == HOME_SCREEN) return ShellNavigator.HOME
    val query = params.orEmpty().entries.sortedBy { it.key }.joinToString("&") { "${it.key}=${it.value}" }
    return ShellNavigator.screenKey(screen) + if (query.isEmpty()) "" else "?$query"
  }

  /** The screen and params a key names; null for a key that is not a screen. */
  fun parse(key: String): Pair<String, Map<String, String>>? {
    if (!key.startsWith("screen:")) return null
    val body = key.removePrefix("screen:")
    val screen = body.substringBefore('?')
    val params = body.substringAfter('?', "").split('&').filter { '=' in it }.associate { it.substringBefore('=') to it.substringAfter('=') }
    return screen to params
  }
}

/** Whether the person runs this site as the console's Admin tab requires: an owner or admin of it or its workspace. */
fun isHostAdmin(siteRole: String?, orgRole: String?): Boolean =
  siteRole in setOf("owner", "admin") || orgRole in setOf("owner", "admin")

/** The plugins on for the scope: the site's effective set inside a site, the workspace's otherwise. */
fun enabledPluginsFor(orgEnabled: List<String>?, host: Map<String, Any?>?, inSite: Boolean): List<String> {
  if (!inSite) return resolveEnabledPlugins(orgEnabled)
  fun ids(key: String) = (host?.get(key) as? List<*>)?.filterIsInstance<String>()
  return resolveHostEnabledPlugins(orgEnabled, ids("disabledPlugins"), ids("enabledPlugins"))
}

/**
 * One list as this device draws it: the manifest's resolved list, less any row whose native screen this build does not
 * have, and (in the whole-workspace scope) less any row whose screen needs a site, so no row leads to "Pick a site
 * first" (interim rule, 2026-10-18, until each area has its workspace-wide mode).
 */
fun navGroups(
  listId: NativeNavListId,
  enabledPluginIds: Collection<String>,
  hostAdmin: Boolean,
  registry: NativePluginRegistry,
  inSite: Boolean,
): List<NavGroupItem> {
  fun available(screen: String): Boolean {
    if (screen.startsWith("shell.")) return true
    val native = registry.screen(screen) ?: return false
    return inSite || !native.requiresSite
  }
  return resolveNavList(listId, enabledPluginIds, hostAdmin).groups.mapNotNull { group ->
    val rows = group.rows.filter { available(it.screen) }.map { row ->
      val sections = row.sections.orEmpty().filter { available(it.screen) }.map {
        NavSectionItem(NavKeys.of(it.screen, it.params), it.id, it.label, it.screen, it.params.orEmpty(), it.docs)
      }
      NavItem(
        key = NavKeys.of(row.screen, row.params),
        rowId = row.id,
        listId = listId,
        label = row.label,
        icon = row.icon.android,
        screen = row.screen,
        params = row.params.orEmpty(),
        description = row.description,
        sections = sections.takeIf { it.size > 1 }.orEmpty(),
        actions = row.actions.orEmpty().filter { available(it.screen) },
        pluginId = row.pluginId,
        keywords = row.keywords.orEmpty(),
        console = row.console,
        docs = row.docs,
      )
    }
    if (rows.isEmpty() && group.dynamic == null) null else NavGroupItem(group.id, group.label, group.foldable, group.dynamic, rows)
  }
}

/** The row that holds [key] (its own key or one of its sections'), if any. */
fun List<NavGroupItem>.rowFor(key: String): NavItem? = asSequence().flatMap { it.rows }.firstOrNull { key in it.keys }

/** The group holding [key]. */
fun List<NavGroupItem>.groupFor(key: String): NavGroupItem? = firstOrNull { group -> group.rows.any { key in it.keys } }

/**
 * The phone's bottom bar after Home: the scope's busiest area (Orders for a site that sells, Pages otherwise; Sites for the
 * whole workspace), then Create, then Inbox when the inbox runs, then Menu (the plan's phone section).
 */
fun phoneTabRows(groups: List<NavGroupItem>, inSite: Boolean): Pair<NavItem?, NavItem?> {
  val rows = groups.flatMap { it.rows }
  val busiest = if (inSite) rows.firstOrNull { it.rowId == "orders" } ?: rows.firstOrNull { it.rowId == "pages" } else rows.firstOrNull { it.rowId == "sites" }
  val inbox = rows.firstOrNull { it.rowId == "inbox" }
  return busiest to inbox
}

/**
 * The console path of the page on screen (`/acme/hosts/bakery/products/orders`), what the AI panel's context says it is
 * reading: the workspace (and site) prefix, then the row's console href where its twin is a plugin tab or section.
 */
fun consolePathOf(orgSlug: String?, hostSlug: String?, row: NavItem?): String {
  val base = buildString {
    orgSlug?.let { append("/").append(it) }
    if (orgSlug != null && hostSlug != null) append("/hosts/").append(hostSlug)
  }
  val ref = row?.console ?: return base
  val href = when (ref.surface) {
    com.aglyn.contracts.NativeNavConsoleSurface.HOST_PLUGIN_TAB, com.aglyn.contracts.NativeNavConsoleSurface.ORG_PLUGIN_TAB,
    com.aglyn.contracts.NativeNavConsoleSurface.HOST_PLUGIN_SECTION, com.aglyn.contracts.NativeNavConsoleSurface.ORG_PLUGIN_SECTION,
    -> ref.id
    else -> ""
  }
  return base + href
}
