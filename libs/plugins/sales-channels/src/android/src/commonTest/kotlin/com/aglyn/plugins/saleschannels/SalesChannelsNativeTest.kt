package com.aglyn.plugins.saleschannels

import com.aglyn.pluginhost.NativePluginManifestEntry
import com.aglyn.pluginhost.NativePluginRegistry
import com.aglyn.screens.ScreenSpec
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

class SalesChannelsNativeTest {
  private val declared = mapOf(
    "screens" to listOf("sales-channels.service", "sales-channels.channel", "sales-channels.diagnostics", "sales-channels.diagnosticsChannel"),
    "deepLinks" to listOf(),
  )

  @Test
  fun registersExactlyWhatItDeclares() {
    val registry = NativePluginRegistry()
    val result = registry.load(listOf(NativePluginManifestEntry("sales-channels", declared, ::registerSalesChannelsNative)))
    assertEquals(emptyList(), result.failed)
  }

  @Test
  fun everySpecNamesItsRoutesAndTheCommerceSettingsZone() {
    val specs = SalesChannelsScreenJson.files.flatMap { ScreenSpec.parseFile(it) }
    assertEquals(listOf("sales-channels.service", "sales-channels.channel", "sales-channels.diagnostics", "sales-channels.diagnosticsChannel").sorted(), specs.map { it.id }.sorted())
    assertTrue(specs.any { "commerceSettings" in it.zones } || specs.all { it.zones.isEmpty() })
  }
}
