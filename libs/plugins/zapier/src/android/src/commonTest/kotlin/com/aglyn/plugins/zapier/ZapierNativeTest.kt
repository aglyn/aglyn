package com.aglyn.plugins.zapier

import com.aglyn.pluginhost.NativePluginManifestEntry
import com.aglyn.pluginhost.NativePluginRegistry
import com.aglyn.screens.ScreenSpec
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

class ZapierNativeTest {
  private val declared = mapOf(
    "screens" to listOf("zapier.connections"),
    "deepLinks" to listOf(),
  )

  @Test
  fun registersExactlyWhatItDeclares() {
    val registry = NativePluginRegistry()
    val result = registry.load(listOf(NativePluginManifestEntry("zapier", declared, ::registerZapierNative)))
    assertEquals(emptyList(), result.failed)
  }

  @Test
  fun everySpecNamesItsRoutesAndTheSitePluginSettingsZone() {
    val specs = ZapierScreenJson.files.flatMap { ScreenSpec.parseFile(it) }
    assertEquals(listOf("zapier.connections").sorted(), specs.map { it.id }.sorted())
    assertTrue(specs.any { "sitePluginSettings" in it.zones } || specs.all { it.zones.isEmpty() })
  }
}
