package com.aglyn.plugins.manifest

import com.aglyn.pluginhost.NativePluginRegistry
import kotlin.test.Test
import kotlin.test.assertEquals

/**
 * Every plugin the apps load registers exactly what its `mobile.contributes`
 * declares in plugins.config.json: the registry refuses an undeclared id and
 * reports a declared one that never registered, so a red here names the
 * plugin and the id before an app ever starts without it.
 */
class NativePluginsTest {
  @Test
  fun loadsEveryPluginWithNoFailures() {
    val result = NativePluginRegistry().load(NativePlugins.entries)
    assertEquals(emptyList(), result.failed)
    assertEquals(NativePlugins.entries.map { it.id }, result.loaded)
  }
}
