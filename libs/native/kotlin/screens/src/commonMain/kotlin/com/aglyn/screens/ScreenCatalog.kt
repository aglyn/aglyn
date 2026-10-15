package com.aglyn.screens

import com.aglyn.pluginhost.NativePluginManifestEntry
import com.aglyn.pluginhost.NativePluginRegistrar

/** Every spec screen the app has: core's and each plugin's. */
object ScreenCatalog {
  private val specs = linkedMapOf<String, ScreenSpec>()

  fun add(list: List<ScreenSpec>) {
    for (spec in list) specs[spec.id] = spec
  }

  fun spec(id: String): ScreenSpec? = specs[id]

  /** The plugin screens contributing to a core screen's zone, in order. */
  fun zone(name: String): List<ScreenSpec> =
    specs.values.filter { name in it.zones }.sortedWith(compareBy<ScreenSpec> { it.order }.thenBy { it.id })

  /** The screens the shell lists in one group, in order. */
  fun group(name: String): List<ScreenSpec> =
    specs.values.filter { it.group == name }.sortedWith(compareBy<ScreenSpec> { it.order }.thenBy { it.id })
}

/** Spec screens as plugin-host contributions. */
object SpecScreens {
  /** The deep-link ids a spec registers: `<screen id>.link`, `.link2`, … */
  fun linkIds(spec: ScreenSpec): List<String> = spec.links.indices.map { if (it == 0) "${spec.id}.link" else "${spec.id}.link${it + 1}" }

  /** The id of the widget a spec's `cardSlot` registers. */
  fun cardId(spec: ScreenSpec): String = "${spec.id}.card"

  /** What a set of specs contributes, in the manifest's shape. */
  fun declaration(specs: List<ScreenSpec>): Map<String, List<String>> {
    val cards = specs.filter { it.cardSlot != null }.map { cardId(it) }.sorted()
    return mapOf(
      "screens" to specs.map { it.id }.sorted(),
      "deepLinks" to specs.flatMap { linkIds(it) }.sorted(),
    ) + (if (cards.isEmpty()) emptyMap() else mapOf("widgets" to cards))
  }

  /** Registers each spec as a screen, each link as a deep link and each `cardSlot` as a widget, and catalogs them. */
  fun register(specs: List<ScreenSpec>, registrar: NativePluginRegistrar) {
    ScreenCatalog.add(specs)
    for (spec in specs) {
      registrar.screen(spec.id, spec.label, requiresSite = spec.requiresSite, icon = spec.icon) { context, params ->
        SpecScreen(spec, context, params)
      }
      spec.links.forEachIndexed { index, path -> registrar.deepLink(linkIds(spec)[index], path, spec.id) }
      spec.cardSlot?.let { slot ->
        registrar.widget(cardId(spec), spec.label, spec.order, requiresSite = spec.requiresSite, slot = slot) { context ->
          SpecCard(spec, registrar.pluginId, context)
        }
      }
    }
  }
}

/**
 * The app's own console areas (workspace, team, settings, billing, site
 * admin, your account, support and staff), declared in
 * `libs/native/screens/` and loaded like a plugin named `core`.
 */
object CoreScreens {
  const val PLUGIN_ID = "core"

  val specs: List<ScreenSpec> by lazy { CoreScreenJson.files.flatMap { ScreenSpec.parseFile(it) } }

  val manifestEntry: NativePluginManifestEntry
    get() = NativePluginManifestEntry(PLUGIN_ID, SpecScreens.declaration(specs)) { SpecScreens.register(specs, it) }
}
