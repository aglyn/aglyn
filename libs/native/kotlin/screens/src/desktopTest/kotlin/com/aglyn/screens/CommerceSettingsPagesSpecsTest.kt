package com.aglyn.screens

import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

/**
 * The console's Commerce Settings pages (the Products tab's Settings group): each is a page hub with that page's own
 * settings in the console's order, then the zone where other plugins' cards for that page land.
 */
class CommerceSettingsPagesSpecsTest : SpecTestBase() {
  private fun links(id: String): List<String> =
    spec("commerce", id).blocks.filter { it.type == "links" }.flatMap { block ->
      block.raw.jsonObject["items"]!!.jsonArray.map { (it.jsonObject["screen"] as JsonPrimitive).content }
    }

  private fun zone(id: String): String =
    spec("commerce", id).blocks.single { it.type == "zone" }.raw.jsonObject["name"]!!.let { (it as JsonPrimitive).content }

  @Test
  fun eachPageHoldsTheConsolePagesOwnSettingsThenItsZone() {
    val pages = listOf(
      Triple("commerce.settingsPayments", listOf("commerce.payments", "commerce.paymentMethods"), "commerceSettingsPayments"),
      Triple("commerce.settingsCheckout", listOf("commerce.storeSettings", "commerce.returnSettings", "commerce.quoteSettings"), "commerceSettingsCheckout"),
      Triple("commerce.settingsTaxes", listOf("commerce.tax"), "commerceSettingsTaxes"),
      Triple(
        "commerce.settingsShipping",
        listOf("commerce.shipping", "commerce.locations", "commerce.localDelivery", "commerce.suppliers", "commerce.shipstation", "commerce.shippingeasy"),
        "commerceSettingsShipping",
      ),
      Triple("commerce.settingsNotifications", listOf("commerce.notifications", "commerce.orderWebhooks"), "commerceSettingsNotifications"),
      Triple("commerce.settingsChannels", emptyList(), "commerceSettingsChannels"),
      Triple("commerce.settings", emptyList(), "commerceSettings"),
    )
    for ((id, screens, zoneName) in pages) {
      assertEquals(screens, links(id), id)
      assertEquals(zoneName, zone(id), id)
      assertEquals("zone", spec("commerce", id).blocks.last().type, "$id ends with its zone")
    }
    // Every linked screen is one the commerce plugin draws.
    pages.flatMap { it.second }.forEach { spec("commerce", it) }
  }

  @Test
  fun pagesThatAreOnlyOtherPluginsCardsSayWhenNoneRuns() {
    for (id in listOf("commerce.settingsChannels", "commerce.settings")) {
      val block = spec("commerce", id).blocks.single { it.type == "zone" }
      assertTrue(block.raw.jsonObject["empty"] != null, "$id says so when no plugin fills it")
    }
  }

  @Test
  fun theConsolePagesOpenTheirHubs() {
    assertEquals(listOf("/products/payments"), spec("commerce", "commerce.settingsPayments").links)
    assertEquals(listOf("/products/checkout"), spec("commerce", "commerce.settingsCheckout").links)
    assertEquals(listOf("/products/taxes"), spec("commerce", "commerce.settingsTaxes").links)
    assertEquals(listOf("/products/channels"), spec("commerce", "commerce.settingsChannels").links)
    assertEquals(listOf("/products/integrations"), spec("commerce", "commerce.settings").links)
    // Shipping and Notifications keep the deep links Register.kt names, retargeted to their hubs.
    assertEquals(emptyList(), spec("commerce", "commerce.settingsShipping").links)
    assertEquals(emptyList(), spec("commerce", "commerce.settingsNotifications").links)
  }

  @Test
  fun promotionsHoldReviewSettingsAndTheReviewPlatforms() {
    assertTrue("commerce.reviewSettings" in links("commerce.promotions"))
    assertEquals("commercePromotions", zone("commerce.promotions"))
    assertTrue("commercePromotions" in spec("review-platforms", "review-platforms.service").zones)
  }

  @Test
  fun theStoreHubOpensEachPage() {
    val configure = spec("commerce", "commerce.manage").blocks.first { it.id == "configure" }
    assertEquals(
      listOf(
        "commerce.settingsPayments", "commerce.settingsCheckout", "commerce.settingsTaxes", "commerce.settingsShipping",
        "commerce.settingsNotifications", "commerce.hardware", "commerce.settingsChannels", "commerce.settings",
      ),
      configure.raw.jsonObject["items"]!!.jsonArray.map { (it.jsonObject["screen"] as JsonPrimitive).content },
    )
  }
}
