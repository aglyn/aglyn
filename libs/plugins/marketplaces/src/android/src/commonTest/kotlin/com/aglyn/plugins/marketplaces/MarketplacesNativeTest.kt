package com.aglyn.plugins.marketplaces

import com.aglyn.pluginhost.NativePluginManifestEntry
import com.aglyn.pluginhost.NativePluginRegistry
import com.aglyn.screens.ScreenSpec
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

class MarketplacesNativeTest {
  private val declared = mapOf(
    "screens" to listOf("marketplaces.service", "marketplaces.marketplace"),
    "deepLinks" to listOf(),
  )

  @Test
  fun registersExactlyWhatItDeclares() {
    val registry = NativePluginRegistry()
    val result = registry.load(listOf(NativePluginManifestEntry("marketplaces", declared, ::registerMarketplacesNative)))
    assertEquals(emptyList(), result.failed)
  }

  @Test
  fun everySpecNamesItsRoutesAndTheCommerceSettingsZone() {
    val specs = MarketplacesScreenJson.files.flatMap { ScreenSpec.parseFile(it) }
    assertEquals(listOf("marketplaces.service", "marketplaces.marketplace").sorted(), specs.map { it.id }.sorted())
    assertTrue(specs.any { "commerceSettings" in it.zones } || specs.all { it.zones.isEmpty() })
  }
}
