package com.aglyn.plugins.shipping

import com.aglyn.pluginhost.NativePluginManifestEntry
import com.aglyn.pluginhost.NativePluginRegistry
import com.aglyn.screens.ScreenSpec
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

class ShippingNativeTest {
  private val declared = mapOf(
    "screens" to listOf("shipping.service", "shipping.shipFrom", "shipping.boxes", "shipping.labels", "shipping.services", "shipping.billing", "shipping.carriers", "shipping.connectCarrier", "shipping.own", "shipping.connectOwn", "shipping.spend"),
    "deepLinks" to listOf(),
  )

  @Test
  fun registersExactlyWhatItDeclares() {
    val registry = NativePluginRegistry()
    val result = registry.load(listOf(NativePluginManifestEntry("shipping", declared, ::registerShippingNative)))
    assertEquals(emptyList(), result.failed)
  }

  @Test
  fun everySpecNamesItsRoutesAndTheCommerceSettingsZone() {
    val specs = ShippingScreenJson.files.flatMap { ScreenSpec.parseFile(it) }
    assertEquals(listOf("shipping.service", "shipping.shipFrom", "shipping.boxes", "shipping.labels", "shipping.services", "shipping.billing", "shipping.carriers", "shipping.connectCarrier", "shipping.own", "shipping.connectOwn", "shipping.spend").sorted(), specs.map { it.id }.sorted())
    assertTrue(specs.any { "commerceSettings" in it.zones } || specs.all { it.zones.isEmpty() })
  }
}
