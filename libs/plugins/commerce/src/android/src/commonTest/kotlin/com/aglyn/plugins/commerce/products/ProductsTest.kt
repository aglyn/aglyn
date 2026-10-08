package com.aglyn.plugins.commerce.products

import com.aglyn.contracts.ProductStatus
import com.aglyn.contracts.ProductVariant
import com.aglyn.core.FilterOp
import com.aglyn.core.FirestoreDoc
import com.aglyn.core.FirestorePage
import com.aglyn.core.FirestoreQuery
import com.aglyn.core.FirestoreReader
import com.aglyn.core.Live
import kotlinx.coroutines.flow.emptyFlow
import kotlinx.coroutines.test.runTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull
import kotlin.test.assertTrue

private fun doc(id: String, vararg fields: Pair<String, Any?>) = FirestoreDoc(id, "hosts/h1/products/$id", mapOf(*fields))

class ProductsTest {
  @Test
  fun aChipIsAStatusClauseOnTheHubsQueryOfLiveProducts() {
    val all = productsQuery("h1", ProductFilter.ALL)
    assertEquals("hosts/h1/products", all.collectionPath)
    assertEquals(PRODUCTS_PAGE_SIZE, all.limit)
    assertTrue(all.filters.any { it.field == "deletedAt" && it.op == FilterOp.EQ && it.value == null }, all.filters.toString())
    val draft = productsQuery("h1", ProductFilter.DRAFT)
    assertTrue(draft.filters.any { it.field == "status" && it.value == "draft" }, draft.filters.toString())
  }

  @Test
  fun aCodeIsAWholeMatchAndTakesThePlaceOfTheSearch() {
    val byCode = productsQuery("h1", ProductFilter.ALL, search = "mug", code = "barcodes" to "0001")
    assertTrue(byCode.filters.any { it.field == "barcodes" && it.op == FilterOp.ARRAY_CONTAINS && it.value == "0001" }, byCode.filters.toString())
    assertTrue(byCode.filters.none { it.field == "searchTokens" })
  }

  @Test
  fun aRowReadsTheProductAsTheConsoleLiftsIt() {
    val row = productRow(
      doc(
        "p1",
        "name" to "Latte",
        "status" to "active",
        "type" to "physical",
        "lowStockThreshold" to 5L,
        "variants" to listOf(mapOf("id" to "s", "priceUsd" to 3.5, "inventory" to 2L), mapOf("id" to "l", "priceUsd" to 4.25, "inventory" to 1L)),
      ),
    )
    assertEquals(3.5 to 4.25, row.priceRange)
    assertEquals(3.0, row.inventory)
    assertTrue(row.lowStock)
    assertEquals("$3.50–$4.25", priceLabel(row.priceRange))
    val legacy = productRow(doc("p2", "name" to "Old Mug", "priceUsd" to 12L))
    assertEquals(ProductStatus.ACTIVE, legacy.status)
    assertEquals(1, legacy.variantCount)
    assertNull(legacy.inventory)
  }

  @Test
  fun wordsForStockAndVariants() {
    assertEquals("Not tracked", stockLabel(null))
    assertEquals("Sold out", stockLabel(0.0))
    assertEquals("4 in stock", stockLabel(4.0))
    assertEquals("Large / Oat", variantLabel(ProductVariant(options = mapOf("Size" to "Large", "Milk" to "Oat"))))
    assertEquals("Default", variantLabel(ProductVariant()))
  }

  @Test
  fun aCodeIsLookedUpByBarcodeThenSku() = runTest {
    val asked = mutableListOf<FirestoreQuery>()
    val reader = object : FirestoreReader {
      override suspend fun get(path: String): FirestoreDoc? = null
      override suspend fun page(query: FirestoreQuery): FirestorePage {
        asked += query
        val bySku = query.filters.any { it.field == "skus" }
        return FirestorePage(if (bySku) listOf(doc("p1", "name" to "Latte")) else emptyList(), null)
      }
      override fun observeDoc(path: String) = emptyFlow<Live<FirestoreDoc?>>()
      override fun observe(query: FirestoreQuery) = emptyFlow<Live<List<FirestoreDoc>>>()
    }
    assertEquals(listOf("p1"), findProductsByCode(reader, "h1", " LAT-S ").map { it.id })
    assertEquals(listOf("barcodes", "skus"), asked.map { q -> PRODUCT_CODE_FIELDS.first { f -> q.filters.any { it.field == f } } })
  }
}
