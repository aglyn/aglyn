package com.aglyn.pluginhost

import androidx.compose.runtime.Composable
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow

/**
 * What a plugin's registrar is handed. Every call is checked against the
 * plugin's `mobile.contributes` declaration: an id the declaration does not
 * name is refused, so `plugins.config.json` stays the honest inventory of
 * what a plugin adds to the apps, on every platform.
 */
class NativePluginRegistrar internal constructor(
  val pluginId: String,
  private val registry: NativePluginRegistry,
  private val allowed: (ContributionKind, String) -> Boolean,
) {
  fun screen(
    id: String,
    title: String,
    requiresSite: Boolean = false,
    apps: Set<NativeApp> = setOf(NativeApp.AGLYN),
    icon: String? = null,
    layout: ScreenLayout = ScreenLayout.SINGLE,
    placement: PosPlacement? = null,
    content: @Composable (context: NativePluginContext, params: NativeParams) -> Unit,
  ) = add(NativeScreen(pluginId, id, title, requiresSite, apps, icon, layout, placement, content = content))

  /**
   * A declared screen whose native version has not landed on this platform:
   * the shell opens [path] in the console view, exactly as an unmatched link
   * would, so a declared id never leads to a blank page.
   */
  fun consoleScreen(
    id: String,
    title: String,
    path: String,
    scope: ConsoleScope = ConsoleScope.SITE,
    requiresSite: Boolean = scope == ConsoleScope.SITE,
    apps: Set<NativeApp> = setOf(NativeApp.AGLYN),
    icon: String? = null,
  ) {
    require(path.startsWith("/")) { "console screen \"$id\" path \"$path\" is a console path and starts with /" }
    add(NativeScreen(pluginId, id, title, requiresSite, apps, icon, consolePath = path, consoleScope = scope) { _, _ -> })
  }

  fun tab(id: String, title: String, icon: String, screen: String, order: Int, apps: Set<NativeApp> = setOf(NativeApp.AGLYN)) =
    add(NativeTab(pluginId, id, title, icon, screen, order, apps))

  fun widget(
    id: String,
    title: String,
    order: Int,
    size: WidgetSize = WidgetSize.FULL,
    requiresSite: Boolean = false,
    apps: Set<NativeApp> = setOf(NativeApp.AGLYN),
    content: @Composable (context: NativePluginContext) -> Unit,
  ) = add(NativeWidget(pluginId, id, title, order, size, requiresSite, apps, content))

  fun quickAction(
    id: String,
    title: String,
    icon: String,
    order: Int,
    requiresSite: Boolean = false,
    screen: String? = null,
    params: NativeParams = emptyMap(),
    consolePath: String? = null,
    apps: Set<NativeApp> = setOf(NativeApp.AGLYN),
  ) = add(NativeQuickAction(pluginId, id, title, icon, order, requiresSite, screen, params, consolePath, apps))

  fun deepLink(id: String, path: String, screen: String) = add(NativeDeepLink(pluginId, id, path, screen))

  /** Registers a contribution built elsewhere; held to the same checks. */
  fun add(item: Contribution) {
    val kind = kindOf(item)
    require(item.id.isNotEmpty() && item.pluginId.isNotEmpty()) {
      "a native ${kind.wire} registration needs an id and a pluginId"
    }
    require(item.pluginId == pluginId) {
      "plugin \"$pluginId\" registered ${kind.wire} \"${item.id}\" as \"${item.pluginId}\" — a plugin registers only its own"
    }
    require(allowed(kind, item.id)) {
      "plugin \"$pluginId\" registered ${kind.wire} \"${item.id}\", which its \"mobile.contributes.${kind.wire}\" in plugins.config.json does not declare"
    }
    registry.add(kind, item)
  }
}

data class PluginLoadFailure(val pluginId: String, val error: String)

data class PluginLoadResult(val loaded: List<String>, val failed: List<PluginLoadFailure>)

/**
 * Every contribution the loaded plugins registered. One per app process; the
 * shells read it and never name a plugin.
 */
class NativePluginRegistry {
  private val items = ContributionKind.entries.associateWith { linkedMapOf<String, Contribution>() }
  private val mutableVersion = MutableStateFlow(0)

  /** Changes whenever anything registers or unregisters. */
  val version: StateFlow<Int> = mutableVersion

  internal fun add(kind: ContributionKind, item: Contribution) {
    if (kind == ContributionKind.QUICK_ACTIONS) {
      val action = item as NativeQuickAction
      require((action.screen != null) != (action.consolePath != null)) {
        "quick action \"${action.id}\" opens a screen or a console path — exactly one"
      }
    }
    if (kind == ContributionKind.DEEP_LINKS) {
      val link = item as NativeDeepLink
      require(link.path.startsWith("/")) {
        "deep link \"${link.id}\" path \"${link.path}\" is a console path and starts with /"
      }
    }
    val map = items.getValue(kind)
    require(item.id !in map) { "native ${kind.wire} \"${item.id}\" is already registered" }
    map[item.id] = item
    mutableVersion.value += 1
  }

  /**
   * Runs each plugin's registrar inside its declaration. A plugin that fails
   * (an undeclared id, a duplicate, a declared id it never registers, or a
   * throw) is reported and everything it registered is dropped; the others
   * still load, because one broken plugin must not leave someone without the app.
   */
  fun load(manifest: List<NativePluginManifestEntry>): PluginLoadResult {
    val loaded = mutableListOf<String>()
    val failed = mutableListOf<PluginLoadFailure>()
    for (entry in manifest) {
      try {
        val registrar = NativePluginRegistrar(entry.id, this) { kind, id ->
          id in (entry.contributes[kind.wire] ?: emptyList())
        }
        entry.register(registrar)
        val gaps = undeclaredGaps(entry)
        require(gaps.isEmpty()) { "declares but never registers ${gaps.joinToString(", ")}" }
        loaded += entry.id
      } catch (error: Throwable) {
        unregister(entry.id)
        failed += PluginLoadFailure(entry.id, error.message ?: error.toString())
      }
    }
    return PluginLoadResult(loaded, failed)
  }

  /** A registrar outside the manifest's declarations, for specs and previews. */
  fun registrarFor(pluginId: String, allowed: (ContributionKind, String) -> Boolean = { _, _ -> true }) =
    NativePluginRegistrar(pluginId, this, allowed)

  private fun undeclaredGaps(entry: NativePluginManifestEntry): List<String> {
    val registered = registeredBy(entry.id)
    return ContributionKind.entries.flatMap { kind ->
      (entry.contributes[kind.wire] ?: emptyList())
        .filter { it !in registered.getValue(kind) }
        .map { "${kind.wire} \"$it\"" }
    }
  }

  fun registeredBy(pluginId: String): Map<ContributionKind, List<String>> =
    items.mapValues { (_, map) -> map.values.filter { it.pluginId == pluginId }.map { it.id }.sorted() }

  fun unregister(pluginId: String) {
    var changed = false
    for (map in items.values) changed = map.values.removeAll { it.pluginId == pluginId } || changed
    if (changed) mutableVersion.value += 1
  }

  fun screen(id: String): NativeScreen? = items.getValue(ContributionKind.SCREENS)[id] as? NativeScreen

  fun screens(app: NativeApp? = null): List<NativeScreen> = all<NativeScreen>(ContributionKind.SCREENS, app)

  fun tabs(app: NativeApp? = null): List<NativeTab> =
    all<NativeTab>(ContributionKind.TABS, app).sortedWith(compareBy({ it.order }, { it.id }))

  fun widgets(app: NativeApp? = null): List<NativeWidget> =
    all<NativeWidget>(ContributionKind.WIDGETS, app).sortedWith(compareBy({ it.order }, { it.id }))

  fun quickActions(app: NativeApp? = null): List<NativeQuickAction> =
    all<NativeQuickAction>(ContributionKind.QUICK_ACTIONS, app).sortedWith(compareBy({ it.order }, { it.id }))

  fun deepLinks(): List<NativeDeepLink> = all(ContributionKind.DEEP_LINKS, null)

  private inline fun <reified T : Contribution> all(kind: ContributionKind, app: NativeApp?): List<T> =
    items.getValue(kind).values.filterIsInstance<T>().filter { app == null || app in it.apps }

  fun clear() {
    items.values.forEach { it.clear() }
    mutableVersion.value += 1
  }
}

internal fun kindOf(item: Contribution): ContributionKind = when (item) {
  is NativeScreen -> ContributionKind.SCREENS
  is NativeTab -> ContributionKind.TABS
  is NativeWidget -> ContributionKind.WIDGETS
  is NativeQuickAction -> ContributionKind.QUICK_ACTIONS
  is NativeDeepLink -> ContributionKind.DEEP_LINKS
}
