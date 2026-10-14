package com.aglyn.plugins.marketingplatforms

import com.aglyn.pluginhost.NativePluginManifestEntry
import com.aglyn.pluginhost.NativePluginRegistry
import com.aglyn.screens.ScreenSpec
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

class MarketingPlatformsNativeTest {
  private val declared = mapOf(
    "screens" to listOf("marketing-platforms.service", "marketing-platforms.platform"),
    "deepLinks" to listOf(),
  )

  @Test
  fun registersExactlyWhatItDeclares() {
    val registry = NativePluginRegistry()
    val result = registry.load(listOf(NativePluginManifestEntry("marketing-platforms", declared, ::registerMarketingPlatformsNative)))
    assertEquals(emptyList(), result.failed)
  }

  @Test
  fun everySpecNamesItsRoutesAndTheCommerceSettingsZone() {
    val specs = MarketingPlatformsScreenJson.files.flatMap { ScreenSpec.parseFile(it) }
    assertEquals(listOf("marketing-platforms.service", "marketing-platforms.platform").sorted(), specs.map { it.id }.sorted())
    assertTrue(specs.any { "commerceSettings" in it.zones } || specs.all { it.zones.isEmpty() })
  }
}
