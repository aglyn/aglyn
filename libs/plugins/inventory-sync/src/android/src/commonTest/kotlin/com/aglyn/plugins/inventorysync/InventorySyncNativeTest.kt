package com.aglyn.plugins.inventorysync

import com.aglyn.pluginhost.NativePluginManifestEntry
import com.aglyn.pluginhost.NativePluginRegistry
import com.aglyn.screens.ScreenSpec
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

class InventorySyncNativeTest {
  private val declared = mapOf(
    "screens" to listOf("inventory-sync.service", "inventory-sync.order"),
    "deepLinks" to listOf(),
  )

  @Test
  fun registersExactlyWhatItDeclares() {
    val registry = NativePluginRegistry()
    val result = registry.load(listOf(NativePluginManifestEntry("inventory-sync", declared, ::registerInventorySyncNative)))
    assertEquals(emptyList(), result.failed)
  }

  @Test
  fun everySpecNamesItsRoutesAndTheCommerceSettingsZone() {
    val specs = InventorySyncScreenJson.files.flatMap { ScreenSpec.parseFile(it) }
    assertEquals(listOf("inventory-sync.service", "inventory-sync.order").sorted(), specs.map { it.id }.sorted())
    assertTrue(specs.any { "commerceSettings" in it.zones } || specs.all { it.zones.isEmpty() })
  }
}
