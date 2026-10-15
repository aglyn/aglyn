package com.aglyn.plugins.deliveryapps

import com.aglyn.pluginhost.NativePluginManifestEntry
import com.aglyn.pluginhost.NativePluginRegistry
import com.aglyn.screens.ScreenSpec
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

class DeliveryAppsNativeTest {
  private val declared = mapOf(
    "screens" to listOf("delivery-apps.service", "delivery-apps.store", "delivery-apps.match"),
    "widgets" to listOf("delivery-apps.pos-orders"),
    "deepLinks" to listOf(),
  )

  @Test
  fun registersExactlyWhatItDeclares() {
    val registry = NativePluginRegistry()
    val result = registry.load(listOf(NativePluginManifestEntry("delivery-apps", declared, ::registerDeliveryAppsNative)))
    assertEquals(emptyList(), result.failed)
  }

  @Test
  fun everySpecNamesItsRoutesAndTheCommerceSettingsZone() {
    val specs = DeliveryAppsScreenJson.files.flatMap { ScreenSpec.parseFile(it) }
    assertEquals(listOf("delivery-apps.service", "delivery-apps.store", "delivery-apps.match").sorted(), specs.map { it.id }.sorted())
    assertTrue(specs.any { "commerceSettings" in it.zones } || specs.all { it.zones.isEmpty() })
  }
}
