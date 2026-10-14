package com.aglyn.plugins.manifest

import com.aglyn.pluginhost.NativeApp
import com.aglyn.pluginhost.NativePluginRegistry
import com.aglyn.plugins.commerce.pos.COMMERCE_POS_ORDERS_SLOT
import com.aglyn.plugins.deliveryapps.POS_ORDERS_SLOT
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue

/**
 * Every plugin the apps load registers exactly what its `mobile.contributes`
 * declares in plugins.config.json: the registry refuses an undeclared id and
 * reports a declared one that never registered, so a red here names the
 * plugin and the id before an app ever starts without it.
 */
class NativePluginManifestTest {
  @Test
  fun loadsEveryPluginWithNoFailures() {
    val result = NativePluginRegistry().load(NativePluginManifest.entries)
    assertEquals(emptyList(), result.failed)
    assertEquals(NativePluginManifest.entries.map { it.id }, result.loaded)
  }

  @Test
  fun theRegistersOrdersZoneHoldsTheDeliveryQueueForThePosAppOnly() {
    // The commerce plugin hosts the zone and the delivery-apps plugin fills it; neither names the other.
    assertEquals(COMMERCE_POS_ORDERS_SLOT, POS_ORDERS_SLOT)
    val registry = NativePluginRegistry().also { it.load(NativePluginManifest.entries) }
    assertEquals(listOf("delivery-apps.pos-orders"), registry.widgets(NativeApp.POS, COMMERCE_POS_ORDERS_SLOT).map { it.id })
    assertTrue(registry.widgets(NativeApp.AGLYN, COMMERCE_POS_ORDERS_SLOT).isEmpty())
    assertFalse(registry.widgets(NativeApp.POS).any { it.id == "delivery-apps.pos-orders" }, "and it is never a Home card")
  }
}
