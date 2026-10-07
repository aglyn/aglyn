package com.aglyn.plugins.commerce.pos

import com.aglyn.contracts.ModifierSelection
import com.aglyn.core.FilterOp
import com.aglyn.core.FirestoreDoc
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertIs
import kotlin.test.assertNull
import kotlin.test.assertTrue

private val LATTE: Map<String, Any?> = mapOf(
  "name" to "Latte",
  "slug" to "latte",
  "type" to "physical",
  "status" to "active",
  "deletedAt" to null,
  "categoryIds" to listOf("drinks"),
  "options" to listOf(mapOf("name" to "Size", "values" to listOf("Small", "Large"))),
  "variants" to listOf(
    mapOf("id" to "v-small", "options" to mapOf("Size" to "Small"), "priceUsd" to 3.5, "sku" to "LAT-S", "barcode" to "0001"),
    mapOf("id" to "v-large", "options" to mapOf("Size" to "Large"), "priceUsd" to 4.25, "sku" to "LAT-L", "barcode" to "0002", "inventory" to 0L),
  ),
  "modifierGroups" to listOf(
    mapOf(
      "id" to "milk",
      "name" to "Milk",
      "min" to 1L,
      "max" to 1L,
      "options" to listOf(
        mapOf("id" to "whole", "name" to "Whole", "priceCents" to 0L),
        mapOf("id" to "oat", "name" to "Oat milk", "priceCents" to 75L),
      ),
    ),
  ),
  "posQuickKey" to true,
)

private fun doc(id: String, data: Map<String, Any?>) = FirestoreDoc(id, "hosts/h1/products/$id", data)

class CatalogTest {
  @Test
  fun readsAProductAsTilesPriceIt() {
    val item = posItemFrom(doc("p-latte", LATTE))
    assertEquals("Latte", item.name)
    assertEquals(350L, item.fromCents)
    assertEquals(425L, item.toCents)
    assertEquals(listOf("drinks"), item.categoryIds)
    assertTrue(item.quickKey)
    assertEquals(
      listOf(listOf("v-small", "Small", 350L, null), listOf("v-large", "Large", 425L, 0L)),
      item.variants.map { listOf(it.id, it.label, it.unitCents, it.inventory) },
    )
    assertEquals(1, item.modifierGroups.size)
    assertTrue(item.needsSheet())
    assertTrue(item.variants[1].soldOut())
    assertFalse(posItemFrom(doc("p-bag", mapOf("name" to "Bag", "priceUsd" to 1L))).needsSheet())
  }

  @Test
  fun dropsMalformedModifierGroupsRatherThanSellingThem() {
    val broken = LATTE + ("modifierGroups" to listOf(mapOf("id" to "milk", "name" to "Milk", "min" to 2L, "max" to 1L, "options" to listOf(mapOf("id" to "a", "name" to "A", "priceCents" to 0L)))))
    assertTrue(posItemFrom(doc("p", broken)).modifierGroups.isEmpty())
  }

  @Test
  fun pricesAPickWithItsModifiersAndRefusesAMissingChoiceOrPrice() {
    val item = posItemFrom(doc("p-latte", LATTE))
    val pick = pickOf(item, item.variants[1], listOf(ModifierSelection("milk", "oat")))
    assertEquals(
      PickResult.Ok(CartPick("p-latte", "v-large", "Latte", "Large / Oat milk", listOf(ModifierSelection("milk", "oat")), 500)),
      pick,
    )
    assertEquals(PickResult.Problem("Choose milk for Latte."), pickOf(item, item.variants[1]))
    assertEquals(
      PickResult.Problem("A choice on Latte was picked twice."),
      pickOf(item, item.variants[0], listOf(ModifierSelection("milk", "oat"), ModifierSelection("milk", "oat"))),
    )
    assertEquals(
      PickResult.Problem("A choice on Latte is no longer offered. Remove it and add it again."),
      pickOf(item, item.variants[0], listOf(ModifierSelection("milk", "soy"))),
    )
    val unpriced = posItemFrom(doc("p-x", mapOf("name" to "Mystery", "variants" to listOf(mapOf("id" to "default")))))
    assertEquals(PickResult.Problem("Set a price for Mystery before selling it."), pickOf(unpriced, unpriced.variants[0]))
    val plain = posItemFrom(doc("p-bag", mapOf("name" to "Bag", "priceUsd" to 1L)))
    val bag = assertIs<PickResult.Ok>(pickOf(plain, plain.variants[0])).pick
    assertNull(bag.variantId)
    assertNull(bag.variantLabel)
    assertEquals(100L, bag.unitCents)
  }

  @Test
  fun capsAModifierGroupAtItsMaximum() {
    val extras = LATTE + (
      "modifierGroups" to listOf(
        mapOf(
          "id" to "extras",
          "name" to "Extras",
          "min" to 0L,
          "max" to 1L,
          "options" to listOf(mapOf("id" to "shot", "name" to "Shot", "priceCents" to 100L), mapOf("id" to "whip", "name" to "Whip", "priceCents" to 0L)),
        ),
      )
      )
    val item = posItemFrom(doc("p", extras))
    assertEquals(
      PickResult.Problem("Choose at most 1 for extras on Latte."),
      pickOf(item, item.variants[0], listOf(ModifierSelection("extras", "shot"), ModifierSelection("extras", "whip"))),
    )
  }

  private fun filters(args: PosGridArgs) = posGridQuery("h1", args).filters.map { Triple(it.field, it.op, it.value) }

  @Test
  fun plansTheProductsHubQueryLiveActiveAndOneNarrowing() {
    assertEquals(
      listOf(Triple("deletedAt", FilterOp.EQ, null), Triple("status", FilterOp.EQ, "active")),
      filters(PosGridArgs()),
    )
    assertTrue(Triple("categoryIds", FilterOp.ARRAY_CONTAINS, "drinks") in filters(PosGridArgs(categoryId = "drinks")))
    assertTrue(Triple("posQuickKey", FilterOp.EQ, true) in filters(PosGridArgs(quickKeys = true, categoryId = "drinks")))
    // A typed word searches the whole catalog, past any narrowing.
    val searched = filters(PosGridArgs(search = "Lat", quickKeys = true, categoryId = "drinks"))
    assertTrue(searched.none { it.first == "posQuickKey" || it.first == "categoryIds" })
    assertTrue(Triple("nameTokens", FilterOp.ARRAY_CONTAINS, "lat") in searched)
    val query = posGridQuery("h1", PosGridArgs())
    assertEquals("hosts/h1/products", query.collectionPath)
    assertEquals("nameLower", query.orderBy.single().field)
    assertEquals(POS_GRID_PAGE_SIZE, query.limit)
  }

  @Test
  fun looksAScanUpAsAWholeCodeBarcodeThenSku() {
    val query = posCodeQuery("h1", "barcodes", "0002")
    assertTrue(query.filters.any { it.field == "barcodes" && it.op == FilterOp.ARRAY_CONTAINS && it.value == "0002" })
    assertTrue(query.filters.any { it.field == "status" && it.value == "active" })
    assertEquals(1, query.limit)
    val item = posItemFrom(doc("p", LATTE))
    assertEquals("v-small", variantForCode(item, "lat-s")?.id)
    assertEquals("v-large", variantForCode(item, " 0002 ")?.id)
    assertNull(variantForCode(item, "nope"))
    assertEquals("0012345678905", scannedProductCode(" 0012345678905\u001d "))
    assertEquals("lat-s", scannedProductCode("LAT-S"))
    assertNull(scannedProductCode("   "))
    assertNull(scannedProductCode("x".repeat(65)))
  }

  @Test
  fun laysCategoriesOutALevelAtATimeOrphansAtTheTop() {
    val categories = listOf(
      posCategoryFrom(FirestoreDoc("b", "c/b", mapOf("name" to "Bakery", "order" to 2L))),
      posCategoryFrom(FirestoreDoc("d", "c/d", mapOf("name" to "Drinks", "order" to 1L))),
      posCategoryFrom(FirestoreDoc("hot", "c/hot", mapOf("name" to "Hot", "parentId" to "d"))),
      posCategoryFrom(FirestoreDoc("lost", "c/lost", mapOf("name" to "Lost", "parentId" to "gone"))),
    )
    assertEquals(listOf("d", "b", "lost"), categoryLevel(categories, null).map { it.id })
    assertEquals(listOf("hot"), categoryLevel(categories, "d").map { it.id })
  }

  @Test
  fun readsTheRegistersInNameOrder() {
    val registers = sortRegisters(
      listOf(
        posRegisterFrom(FirestoreDoc("b", "r/b", mapOf("name" to "Patio"))),
        posRegisterFrom(FirestoreDoc("a", "r/a", mapOf("name" to "Front counter", "locationId" to "loc1"))),
        posRegisterFrom(FirestoreDoc("c", "r/c", mapOf("name" to " "))),
      ),
    )
    assertEquals(listOf("Front counter", "Patio", "Register"), registers.map { it.name })
    assertEquals("loc1", registers.first().locationId)
  }
}
