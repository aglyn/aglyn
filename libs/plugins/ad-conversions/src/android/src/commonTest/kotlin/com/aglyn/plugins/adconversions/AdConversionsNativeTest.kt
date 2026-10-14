package com.aglyn.plugins.adconversions

import com.aglyn.pluginhost.NativePluginManifestEntry
import com.aglyn.pluginhost.NativePluginRegistry
import com.aglyn.screens.ScreenSpec
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

class AdConversionsNativeTest {
  private val declared = mapOf(
    "screens" to listOf("ad-conversions.service", "ad-conversions.provider"),
    "deepLinks" to listOf(),
  )

  @Test
  fun registersExactlyWhatItDeclares() {
    val registry = NativePluginRegistry()
    val result = registry.load(listOf(NativePluginManifestEntry("ad-conversions", declared, ::registerAdConversionsNative)))
    assertEquals(emptyList(), result.failed)
  }

  @Test
  fun everySpecNamesItsRoutesAndTheSitePluginSettingsZone() {
    val specs = AdConversionsScreenJson.files.flatMap { ScreenSpec.parseFile(it) }
    assertEquals(listOf("ad-conversions.service", "ad-conversions.provider").sorted(), specs.map { it.id }.sorted())
    assertTrue(specs.any { "sitePluginSettings" in it.zones } || specs.all { it.zones.isEmpty() })
  }
}
