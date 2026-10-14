package com.aglyn.screens

import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

/** Exporting the store's records: each is the export sheet on a transfer resource the console declares, and nothing is requested of a route. */
class CommerceTransferSpecsTest : SpecTestBase() {
  @Test
  fun everyExportOpensTheSheetOnATransferResourceTheConsoleDeclares() {
    val model = screen(spec("commerce", "commerce.transfer"), emptyMap(), "{}")
    val actions = model.actionsShown("export").map { model.action("export", it) }
    assertEquals(
      listOf("commerce.products", "commerce.categories", "commerce.orders", "commerce.discounts", "commerce.coupons", "commerce.gift-cards", "commerce.tracking"),
      actions.map { it.export.str("resource") },
    )
    assertEquals(
      listOf("Export products", "Export product categories", "Export orders", "Export discounts", "Export coupons", "Export gift cards", "Export tracking numbers"),
      actions.map { ScreenValues.render(it.export.str("title")!!, model.context) },
    )
    assertEquals(
      listOf("products", "categories", "orders", "discounts", "coupons", "gift-cards", "tracking-numbers"),
      actions.map { ScreenValues.render(it.export.str("fileStem")!!, model.context) },
    )
    assertTrue(actions.all { it.url == null && it.body == null && it.write == null && !it.reload }, "an export makes no request of its own")
    assertTrue(actions.all { it.export.obj("scope") == null }, "the whole list unless a filter is named")
  }

  @Test
  fun theStoreHubLinksToTheExports() {
    val hub = spec("commerce", "commerce.manage")
    val data = hub.blocks.first { it.id == "data" }.raw.jsonObject["items"]!!.jsonArray.map { it.jsonObject }
    assertEquals(listOf("commerce.transfer"), data.map { (it["screen"] as JsonPrimitive).content })
    assertTrue(data.all { it is JsonObject })
  }
}
