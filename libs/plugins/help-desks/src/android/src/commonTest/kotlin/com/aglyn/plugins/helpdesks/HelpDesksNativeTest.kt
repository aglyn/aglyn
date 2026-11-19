package com.aglyn.plugins.helpdesks

import com.aglyn.pluginhost.NativePluginManifestEntry
import com.aglyn.pluginhost.NativePluginRegistry
import com.aglyn.screens.ScreenSpec
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

class HelpDesksNativeTest {
  private val declared = mapOf(
    "screens" to listOf("help-desks.service", "help-desks.provider"),
    "widgets" to listOf("help-desks.service.card"),
    "deepLinks" to listOf(),
  )

  @Test
  fun registersExactlyWhatItDeclares() {
    val registry = NativePluginRegistry()
    val result = registry.load(listOf(NativePluginManifestEntry("help-desks", declared, ::registerHelpDesksNative)))
    assertEquals(emptyList(), result.failed)
  }

  @Test
  fun everySpecNamesItsRoutesAndTheSitePluginSettingsZone() {
    val specs = HelpDesksScreenJson.files.flatMap { ScreenSpec.parseFile(it) }
    assertEquals(listOf("help-desks.service", "help-desks.provider").sorted(), specs.map { it.id }.sorted())
    assertTrue(specs.any { "sitePluginSettings" in it.zones } || specs.all { it.zones.isEmpty() })
    assertEquals("hostSettings", specs.first { it.id == "help-desks.service" }.cardSlot, "its Setup > Integrations card")
  }
}
