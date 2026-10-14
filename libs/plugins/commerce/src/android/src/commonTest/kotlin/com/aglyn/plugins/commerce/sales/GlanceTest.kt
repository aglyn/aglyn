package com.aglyn.plugins.commerce.sales

import com.aglyn.core.FilterOp
import com.aglyn.core.FirestoreDoc
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull

private fun product(id: String, threshold: Long?, stock: Long?, deleted: Boolean = false) = FirestoreDoc(
  id, "hosts/h1/products/$id",
  buildMap {
    put("name", "Mug $id")
    threshold?.let { put("lowStockThreshold", it) }
    put("variants", listOf(mapOf("id" to "default", "priceUsd" to 10.0) + (stock?.let { mapOf("inventory" to it) } ?: emptyMap())))
    if (deleted) put("deletedAt", 1L)
  },
)

/** The Home card's two figures: the products at or under their alert, and the five latest orders. */
class GlanceTest {
  @Test
  fun aProductIsLowAtOrUnderItsAlertWhenItTracksStockAndHasOne() {
    val docs = listOf(
      product("a", threshold = 5, stock = 5),
      product("b", threshold = 5, stock = 6),
      product("c", threshold = null, stock = 0),
      product("d", threshold = 5, stock = null),
      product("e", threshold = 2, stock = 0),
      product("f", threshold = 5, stock = 1, deleted = true),
    )
    assertEquals(2, glanceLowStock(docs), "at the alert counts, above it, no alert, untracked and deleted do not")
  }

  @Test
  fun onlyTheFirstTwoHundredFiftyProductsAreCounted() {
    val docs = (1..300).map { product("p$it", threshold = 10, stock = 1) }
    assertEquals(GLANCE_PRODUCT_CEILING, glanceLowStock(docs))
  }

  @Test
  fun theCardAsksForOneProbeProductPastItsCeilingAndTheNewestFiveOrders() {
    assertEquals(GLANCE_PRODUCT_CEILING + 1, glanceProductsQuery("h1").limit)
    val orders = glanceOrdersQuery("h1")
    assertEquals(5, orders.limit)
    assertEquals(true, orders.orderBy.single().descending)
    assertEquals("createdAtMs", orders.orderBy.single().field)
    assertNull(orders.filters.firstOrNull { it.op == FilterOp.EQ })
  }
}
