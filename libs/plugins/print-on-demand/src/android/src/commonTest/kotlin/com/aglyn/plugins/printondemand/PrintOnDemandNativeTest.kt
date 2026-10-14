package com.aglyn.plugins.printondemand

import com.aglyn.pluginhost.NativePluginManifestEntry
import com.aglyn.pluginhost.NativePluginRegistry
import com.aglyn.screens.ScreenSpec
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

class PrintOnDemandNativeTest {
  private val declared = mapOf(
    "screens" to listOf("print-on-demand.service", "print-on-demand.connection", "print-on-demand.catalog", "print-on-demand.imported", "print-on-demand.orders", "print-on-demand.order"),
    "deepLinks" to listOf(),
  )

  @Test
  fun registersExactlyWhatItDeclares() {
    val registry = NativePluginRegistry()
    val result = registry.load(listOf(NativePluginManifestEntry("print-on-demand", declared, ::registerPrintOnDemandNative)))
    assertEquals(emptyList(), result.failed)
  }

  @Test
  fun everySpecNamesItsRoutesAndTheCommerceSettingsZone() {
    val specs = PrintOnDemandScreenJson.files.flatMap { ScreenSpec.parseFile(it) }
    assertEquals(listOf("print-on-demand.service", "print-on-demand.connection", "print-on-demand.catalog", "print-on-demand.imported", "print-on-demand.orders", "print-on-demand.order").sorted(), specs.map { it.id }.sorted())
    assertTrue(specs.any { "commerceSettings" in it.zones } || specs.all { it.zones.isEmpty() })
  }
}
