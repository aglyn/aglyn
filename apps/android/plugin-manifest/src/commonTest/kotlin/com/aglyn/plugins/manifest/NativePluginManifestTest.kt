package com.aglyn.plugins.manifest

import com.aglyn.pluginhost.DeepLinks
import com.aglyn.pluginhost.NativeApp
import com.aglyn.pluginhost.NativeLinkTarget
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

  /** The store and marketplace links the server writes, through the plugins' real registrations (AGL-4215). */
  @Test
  fun theStoreAndMarketplaceLinksOpenThePageTheyName() {
    val links = NativePluginRegistry().also { it.load(NativePluginManifest.entries) }.deepLinks()
    fun screenOf(link: String) = (DeepLinks.resolve(link, links) as? NativeLinkTarget.Screen)?.let { it.screen to it.params }
    val site = mapOf("orgSlug" to "acme", "hostSlug" to "shop")
    assertEquals("commerce.order" to site + mapOf("order" to "o1", "orderId" to "o1"), screenOf("/acme/hosts/shop/products/orders?order=o1"))
    assertEquals("commerce.quote" to site + mapOf("quote" to "q1"), screenOf("/acme/hosts/shop/products/orders?quote=q1"))
    assertEquals("commerce.orders" to site, screenOf("/acme/hosts/shop/products/orders"))
    assertEquals("commerce.return" to site + mapOf("return" to "r1", "returnId" to "r1"), screenOf("/acme/hosts/shop/products/returns?return=r1"))
    assertEquals("commerce.returns" to site, screenOf("/acme/hosts/shop/products/returns"))
    assertEquals("commerce.shipping" to site, screenOf("/acme/hosts/shop/products/shipping"))
    assertEquals("commerce.notifications" to site, screenOf("/acme/hosts/shop/products/notifications"))
    assertEquals(null, screenOf("/acme/hosts/shop/products/subscriptions?subscription=s1"))
    assertEquals(null, screenOf("/acme/hosts/shop/products/pos"))
    val org = mapOf("orgSlug" to "acme")
    assertEquals("marketplace.sell" to org + mapOf("section" to "payouts"), screenOf("/acme/marketplace/payouts"))
    assertEquals("marketplace.sell" to org + mapOf("section" to "listings"), screenOf("/acme/marketplace/listings"))
    assertEquals("marketplace.browse" to org, screenOf("/acme/marketplace/browse"))
    assertEquals("marketplace.installed" to org, screenOf("/acme/marketplace/installed"))
    assertEquals("marketplace.licenses" to org, screenOf("/acme/marketplace/licences"))
    assertEquals(null, screenOf("/acme/marketplace/upload"))
    assertEquals("marketplace.listing" to org + mapOf("listingId" to "l1"), screenOf("/acme/marketplace/l1"))
    assertEquals("ai.job" to site + mapOf("jobId" to "j1"), screenOf("/acme/hosts/shop/ai-jobs/j1"))
  }
}
