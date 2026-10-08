package com.aglyn.plugins.commerce.products

import com.aglyn.contracts.ProductStatus
import com.aglyn.core.ConsoleApiError
import com.aglyn.core.FirestoreTimestamp
import kotlinx.coroutines.test.advanceUntilIdle
import kotlinx.coroutines.test.runTest
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNull
import kotlin.test.assertTrue

private val STORED: Map<String, Any?> = mapOf(
  "name" to "Latte",
  "slug" to "latte",
  "status" to "active",
  "type" to "physical",
  "createdAt" to FirestoreTimestamp(1, 0),
  "seo" to mapOf("title" to "Best latte"),
  "variants" to listOf(mapOf("id" to "small", "priceUsd" to 3.5, "inventory" to 4L, "sku" to "LAT-S", "weightGrams" to 300L)),
)

private class Recorder : ProductWriteApi {
  val saves = mutableListOf<Triple<String, Boolean, JsonObject>>()
  val keys = mutableListOf<String>()
  var fail: Throwable? = null
  override suspend fun save(productId: String, create: Boolean, product: JsonObject, attemptKey: String) {
    keys += attemptKey
    fail?.let { throw it }
    saves += Triple(productId, create, product)
  }
  override suspend fun adjustStock(productId: String, variantId: String, delta: Long, reason: String, attemptKey: String) {
    keys += "$attemptKey $productId $variantId $delta $reason"
  }
}

class ProductWritesTest {
  @Test
  fun anEditSendsTheWholeStoredProductWithTheEditsOnTop() {
    val draft = productDraftOf("p1", STORED).let { it.copy(name = "Oat latte", variants = it.variants.map { v -> v.copy(price = "4.25", sku = "") }) }
    val json = productSaveJson(draft, STORED)
    assertEquals("Oat latte", json["name"]!!.jsonPrimitive.content)
    assertEquals("latte", json["slug"]!!.jsonPrimitive.content, "an edit keeps the slug")
    assertEquals("Best latte", json["seo"]!!.jsonObject["title"]!!.jsonPrimitive.content, "a field the app does not edit survives")
    assertFalse("createdAt" in json, "a stored timestamp is left for the route to keep")
    val variant = (json["variants"] as JsonArray).single().jsonObject
    assertEquals(4.25, variant["priceUsd"]!!.jsonPrimitive.content.toDouble())
    assertEquals(4L, variant["inventory"]!!.jsonPrimitive.content.toLong(), "an edit does not touch stock")
    assertEquals(300L, variant["weightGrams"]!!.jsonPrimitive.content.toLong())
    assertFalse("sku" in variant, "an emptied code is removed")
  }

  @Test
  fun aNewProductIsTheConsolesBlankWithItsSlugAndStartingStock() {
    val draft = ProductDraft("p9", create = true, name = "Cold Brew!", status = ProductStatus.ACTIVE, variants = listOf(VariantDraft("default", "Default", "4", stock = "12")))
    val json = productSaveJson(draft, null)
    assertEquals("cold-brew", json["slug"]!!.jsonPrimitive.content)
    assertEquals("active", json["status"]!!.jsonPrimitive.content)
    assertEquals(12L, (json["variants"] as JsonArray).single().jsonObject["inventory"]!!.jsonPrimitive.content.toLong())
    val untracked = productSaveJson(draft.copy(variants = listOf(VariantDraft("default", "Default", "4"))), null)
    assertEquals(JsonNull, (untracked["variants"] as JsonArray).single().jsonObject["inventory"])
  }

  @Test
  fun aDraftNeedsANameAndPrices() {
    assertEquals("Product name is required", checkProductDraft(ProductDraft("p", true)))
    assertEquals("Enter a price for Default", checkProductDraft(ProductDraft("p", true, name = "x")))
    assertNull(checkProductDraft(ProductDraft("p", true, name = "x", variants = listOf(VariantDraft("default", "Default", "3")))))
    assertTrue(checkProductDraft(ProductDraft("p", true, name = "x", variants = listOf(VariantDraft("default", "Default", "3", stock = "-1")))) != null)
  }

  @Test
  fun aStockChangeIsSignedUnits() {
    assertEquals(5L, stockDelta("+5"))
    assertEquals(-2L, stockDelta(" -2 "))
    assertNull(stockDelta("0"))
    assertNull(stockDelta("lots"))
  }

  @Test
  fun aRetryIsTheSameAttemptAndANewDialogANewOne() = runTest {
    var minted = 0
    val api = Recorder().apply { fail = ConsoleApiError("Stripe", 503, null) }
    val editor = ProductEditorModel(api, this) { "k${++minted}" }
    editor.edit("p1", STORED)
    editor.save()
    advanceUntilIdle()
    assertEquals("Stripe", editor.error)
    api.fail = null
    editor.save()
    advanceUntilIdle()
    assertEquals(listOf("k2", "k2"), api.keys)
    assertEquals("Latte is saved.", editor.done)
    assertNull(editor.draft)

    editor.adjust("p1", "small", "Default")
    editor.changeStock(editor.stock!!.copy(change = "+3", reason = "damage"))
    editor.applyStock()
    advanceUntilIdle()
    assertEquals("k3 p1 small 3 damage", api.keys.last())
  }
}
