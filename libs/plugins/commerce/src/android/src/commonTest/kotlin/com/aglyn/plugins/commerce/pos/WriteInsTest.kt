package com.aglyn.plugins.commerce.pos

import com.aglyn.contracts.ModifierSelection
import com.aglyn.contracts.OrderLineItem
import com.aglyn.contracts.OrderLineModifier
import com.aglyn.contracts.ProductModifierGroup
import com.aglyn.contracts.ProductModifierOption
import com.aglyn.contracts.QuoteLineRequest
import com.aglyn.contracts.quoteLineRequestFromLine
import com.aglyn.core.FirestoreDoc
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertIs
import kotlin.test.assertNotEquals
import kotlin.test.assertNull
import kotlin.test.assertTrue

/** Mirrors `write-ins: the gear set builder` in product-modifiers.spec.ts. */
class WriteInsTest {
  private fun size(id: String, name: String, values: List<String>) = ProductModifierGroup(
    id = id, name = name, min = 1.0, max = 1.0, online = true, nameOnOrder = true,
    options = values.map { ProductModifierOption(id = "$id-$it", name = it, priceCents = 0.0) },
  )

  private val name = ProductModifierGroup(
    id = "name", name = "Name on jersey", kind = "text", min = 1.0, max = 1.0, maxLength = 14.0, online = true,
    options = listOf(ProductModifierOption(id = "name-o", name = "Name on jersey", priceCents = 0.0)),
  )
  private val number = ProductModifierGroup(
    id = "number", name = "Number", kind = "text", min = 1.0, max = 1.0, maxLength = 3.0, digitsOnly = true, online = true,
    options = listOf(ProductModifierOption(id = "number-o", name = "Number", priceCents = 500.0)),
  )
  private val groups = listOf(
    size("jersey", "Jersey size", listOf("S", "M", "L", "XL", "2XL", "3XL")),
    size("pants", "Pant size", listOf("28", "30", "32", "34", "36", "38", "40")),
    size("gloves", "Glove size", listOf("S", "M", "L", "XL", "2XL")),
    name,
    number,
  )

  private fun picks(name: String, number: String) = listOf(
    ModifierSelection("jersey", "jersey-L"),
    ModifierSelection("pants", "pants-32"),
    ModifierSelection("gloves", "gloves-M"),
    ModifierSelection("name", "name-o", name),
    ModifierSelection("number", "number-o", number),
  )

  @Test
  fun savesOneFieldPerWriteInRequiredOrNotAndAnyNumberOfSizeGroups() {
    assertNull(modifierGroupsProblem(groups))
    val two = name.copy(options = name.options + ProductModifierOption(id = "x", name = "x", priceCents = 0.0))
    assertEquals("“Name on jersey” is a write-in and holds one field", modifierGroupsProblem(listOf(two)))
    assertEquals("“Name on jersey” is a write-in: required or not, one answer", modifierGroupsProblem(listOf(name.copy(min = 2.0, max = 2.0))))
    assertEquals("“Name on jersey” takes 1 to 40 characters", modifierGroupsProblem(listOf(name.copy(maxLength = 41.0))))
    assertEquals("“Name on jersey” is a list of choices or a write-in", modifierGroupsProblem(listOf(name.copy(kind = "photo"))))
    assertNull(modifierGroupsProblem(listOf(name.copy(min = 0.0))))
  }

  @Test
  fun pricesEveryPieceAndKeepsTheNameAndNumberOnTheLine() {
    val resolved = resolveLineModifiers("Summit Race Set", groups, picks("  SMITH \n", "27"))
    assertIs<ResolvedModifiers.Ok>(resolved)
    assertEquals(500L, resolved.extraCents)
    assertEquals(listOf("L", "32", "M", "SMITH", "27"), resolved.modifiers.map { it.text ?: it.name })
    assertEquals(
      "Jersey size: L, Pant size: 32, Glove size: M, Name on jersey: SMITH, Number: 27",
      lineLabelWithModifiers(null, resolved.modifiers),
    )
  }

  @Test
  fun asksForARequiredWriteInAndRefusesAnAnswerThatDoesNotFit() {
    assertEquals(ResolvedModifiers.Refused("Fill in name on jersey for Summit Race Set."), resolveLineModifiers("Summit Race Set", groups, picks("", "27")))
    assertEquals(ResolvedModifiers.Refused("Number takes numbers only. (Summit Race Set)"), resolveLineModifiers("Summit Race Set", groups, picks("SMITH", "2a")))
    assertEquals(
      ResolvedModifiers.Refused("Name on jersey takes up to 14 characters. (Summit Race Set)"),
      resolveLineModifiers("Summit Race Set", groups, picks("A VERY LONG NAME HERE", "27")),
    )
    val optional = groups.map { if (it.id == "name") it.copy(min = 0.0) else it }
    val resolved = resolveLineModifiers("Summit Race Set", optional, picks("", "27"))
    assertIs<ResolvedModifiers.Ok>(resolved)
    assertFalse(resolved.modifiers.any { it.groupId == "name" })
  }

  @Test
  fun cleansAnAnswerAsTheServerDoes() {
    assertEquals("A B", cleanWriteIn("A\u0000B"))
    assertEquals("SMITH JR", cleanWriteIn("  SMITH\t  JR \n"))
    assertEquals("ABC", cleanWriteIn("ABCDEF", 3))
    assertEquals("", cleanWriteIn("  \n "))
    assertEquals(2, writeInLength("🏁A"))
    assertNull(writeInProblem(name, ""))
    assertEquals(14, name.writeInMaxLength())
    assertEquals(DEFAULT_WRITE_IN_LENGTH, name.copy(maxLength = null).writeInMaxLength())
  }

  @Test
  fun makesTwoRidersTwoLines() {
    assertNotEquals(modifierSelectionKey(picks("SMITH", "27")), modifierSelectionKey(picks("JONES", "27")))
    assertEquals(modifierSelectionKey(picks("SMITH", "27")), modifierSelectionKey(picks("SMITH", "27")))
  }

  @Test
  fun leavesAChoiceWithoutAGroupNameAsItAlwaysPrinted() {
    assertEquals("Large / Oat milk", lineLabelWithModifiers("Large", listOf(LineModifier("milk", "oat", "Milk", "Oat milk", 0))))
  }

  @Test
  fun anAnswerSetsOrClearsItsPickInGroupOrder() {
    val start = listOf(ModifierSelection("number", "number-o", "27"), ModifierSelection("jersey", "jersey-L"))
    val named = withWriteInAnswer(groups, start, name, "SMITH")
    assertEquals(listOf("jersey", "name", "number"), named.map { it.groupId })
    assertEquals("SMITH", writeInAnswer(named, name))
    assertEquals(listOf("jersey", "number"), withWriteInAnswer(groups, named, name, "  ").map { it.groupId })
    assertEquals("SMITH", writeInInput("SMITHSONIAN-JONES", 5))
  }

  @Test
  fun theRegisterReadsAWriteInRingsItUpAndSendsTheAnswer() {
    val data = mapOf<String, Any?>(
      "name" to "Summit Race Set",
      "variants" to listOf(mapOf("id" to "default", "priceUsd" to 250.0)),
      "modifierGroups" to listOf(
        mapOf("id" to "jersey", "name" to "Jersey size", "min" to 1L, "max" to 1L, "nameOnOrder" to true, "options" to listOf(mapOf("id" to "jersey-M", "name" to "M", "priceCents" to 0L))),
        mapOf("id" to "name", "name" to "Name on jersey", "kind" to "text", "min" to 1L, "max" to 1L, "maxLength" to 14L, "options" to listOf(mapOf("id" to "name-o", "name" to "Name on jersey", "priceCents" to 0L, "note" to "As it prints"))),
        mapOf("id" to "number", "name" to "Number", "kind" to "text", "min" to 1L, "max" to 1L, "maxLength" to 3L, "digitsOnly" to true, "options" to listOf(mapOf("id" to "number-o", "name" to "Number", "priceCents" to 500L))),
      ),
    )
    val item = posItemFrom(FirestoreDoc("p-set", "hosts/h1/products/p-set", data))
    assertEquals(3, item.modifierGroups.size)
    assertTrue(item.modifierGroups[1].isWriteIn())
    assertEquals("As it prints", item.modifierGroups[1].options[0].note)
    assertEquals(true, item.modifierGroups[2].digitsOnly)
    val chosen = listOf(ModifierSelection("jersey", "jersey-M"), ModifierSelection("name", "name-o", "SMITH"), ModifierSelection("number", "number-o", "27"))
    val pick = assertIs<PickResult.Ok>(pickOf(item, item.variants[0], chosen)).pick
    assertEquals("Jersey size: M, Name on jersey: SMITH, Number: 27", pick.variantLabel)
    assertEquals(25_500L, pick.unitCents)
    val cart = Cart.EMPTY.add(pick).add(pick.copy(modifiers = chosen.map { if (it.groupId == "name") it.copy(text = "JONES") else it }))
    assertEquals(2, cart.lines.size)
    val sent = cart.saleLines()[0].jsonObject["modifiers"]!!.jsonArray.map { it.jsonObject }
    assertEquals("SMITH", sent[1]["text"]!!.jsonPrimitive.content)
    assertNull(sent[0]["text"])
    assertEquals(cart.lines, readStoredCart(cart.encode()).lines)
  }

  @Test
  fun aQuotedLineKeepsItsAnswerToEditAgain() {
    val line = OrderLineItem(
      productId = "p-set", name = "Summit Race Set", quantity = 1.0, unitAmountCents = 25_500.0,
      modifiers = listOf(OrderLineModifier(group = "Name on jersey", groupId = "name", name = "Name on jersey", optionId = "name-o", priceCents = 0.0, text = "SMITH")),
    )
    val request = assertIs<QuoteLineRequest.Catalog>(quoteLineRequestFromLine(line))
    assertEquals(listOf(ModifierSelection("name", "name-o", "SMITH")), request.modifiers)
    assertEquals("Name on jersey: SMITH", line.modifiers!![0].lineText())
  }
}
