package com.aglyn.plugins.loyalty

import com.aglyn.pluginhost.NativePluginManifestEntry
import com.aglyn.pluginhost.NativePluginRegistry
import com.aglyn.screens.ScreenSpec
import kotlin.test.Test
import kotlin.test.assertEquals

class LoyaltyNativeTest {
  private val declared = mapOf(
    "screens" to listOf("loyalty.rewards", "loyalty.connection", "loyalty.members", "loyalty.member", "loyalty.order"),
    "deepLinks" to listOf(),
  )

  @Test
  fun registersExactlyWhatItDeclares() {
    val registry = NativePluginRegistry()
    val result = registry.load(listOf(NativePluginManifestEntry("loyalty", declared, ::registerLoyaltyNative)))
    assertEquals(emptyList(), result.failed)
  }

  @Test
  fun everySpecIsDeclaredAndTheZonesAreTheOnesCommerceHosts() {
    val specs = LoyaltyScreenJson.files.flatMap { ScreenSpec.parseFile(it) }
    assertEquals(
      listOf("loyalty.rewards", "loyalty.connection", "loyalty.members", "loyalty.member", "loyalty.order").sorted(),
      specs.map { it.id }.sorted(),
    )
    assertEquals(setOf("commercePromotions", "orderDetail"), specs.flatMap { it.zones }.toSet())
  }
}
