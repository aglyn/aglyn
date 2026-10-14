package com.aglyn.plugins.fulfillmentnetworks

import com.aglyn.pluginhost.NativePluginManifestEntry
import com.aglyn.pluginhost.NativePluginRegistry
import com.aglyn.screens.ScreenSpec
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

class FulfillmentNetworksNativeTest {
  private val declared = mapOf(
    "screens" to listOf("fulfillment-networks.service", "fulfillment-networks.network"),
    "deepLinks" to listOf(),
  )

  @Test
  fun registersExactlyWhatItDeclares() {
    val registry = NativePluginRegistry()
    val result = registry.load(listOf(NativePluginManifestEntry("fulfillment-networks", declared, ::registerFulfillmentNetworksNative)))
    assertEquals(emptyList(), result.failed)
  }

  @Test
  fun everySpecNamesItsRoutesAndTheCommerceSettingsZone() {
    val specs = FulfillmentNetworksScreenJson.files.flatMap { ScreenSpec.parseFile(it) }
    assertEquals(listOf("fulfillment-networks.service", "fulfillment-networks.network").sorted(), specs.map { it.id }.sorted())
    assertTrue(specs.any { "commerceSettings" in it.zones } || specs.all { it.zones.isEmpty() })
  }
}
