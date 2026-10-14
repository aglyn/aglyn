package com.aglyn.plugins.accounting

import com.aglyn.pluginhost.NativePluginManifestEntry
import com.aglyn.pluginhost.NativePluginRegistry
import com.aglyn.screens.ScreenSpec
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

class AccountingNativeTest {
  private val declared = mapOf(
    "screens" to listOf("accounting.books", "accounting.attention", "accounting.activity"),
    "deepLinks" to listOf(),
  )

  @Test
  fun registersExactlyWhatItDeclares() {
    val registry = NativePluginRegistry()
    val result = registry.load(listOf(NativePluginManifestEntry("accounting", declared, ::registerAccountingNative)))
    assertEquals(emptyList(), result.failed)
  }

  @Test
  fun everySpecNamesItsRoutesAndTheCommerceSettingsZone() {
    val specs = AccountingScreenJson.files.flatMap { ScreenSpec.parseFile(it) }
    assertEquals(listOf("accounting.books", "accounting.attention", "accounting.activity").sorted(), specs.map { it.id }.sorted())
    assertTrue(specs.any { "commerceSettings" in it.zones } || specs.all { it.zones.isEmpty() })
  }
}
