package com.aglyn.plugins.manifest

import com.aglyn.pluginhost.NativePluginManifestEntry
import com.aglyn.plugins.redirects.registerRedirectsNative

/**
 * The plugins the apps load: the generated manifest, plus native modules
 * whose `mobile.android` block plugins.config.json does not carry yet. A
 * generated entry always wins, so a plugin moves to the generated list by
 * editing the config alone; the pending list then drops it.
 */
object NativePlugins {
  private val pending: List<NativePluginManifestEntry> = listOf(
    NativePluginManifestEntry(
      id = "redirects",
      contributes = mapOf(
        "screens" to listOf("redirects.list"),
        "widgets" to listOf("redirects.summary"),
        "quickActions" to listOf("redirects.open"),
        "deepLinks" to listOf("redirects.page"),
      ),
      register = ::registerRedirectsNative,
    ),
  )

  val entries: List<NativePluginManifestEntry> =
    NativePluginManifest.entries + pending.filter { entry -> NativePluginManifest.entries.none { it.id == entry.id } }
}
