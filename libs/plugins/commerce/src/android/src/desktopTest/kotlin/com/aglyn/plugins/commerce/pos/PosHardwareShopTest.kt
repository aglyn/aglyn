package com.aglyn.plugins.commerce.pos

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.doubleOrNull
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import java.io.File
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue

/**
 * The hardware shop (AGL-4038): its words and rules replay the console's own, from `functionCases` in
 * libs/native/contracts/function-cases.generated.json (the Apple plugin replays the same file).
 */
class PosHardwareShopTest {
  private val functions = Json.parseToJsonElement(File("../../../../native/contracts/function-cases.generated.json").readText())
    .jsonObject.getValue("functions").jsonObject

  private fun cases(name: String) = functions.getValue(name).jsonObject.getValue("cases").jsonArray.map { it.jsonObject }
  private fun arg(case: JsonObject): JsonElement = case.getValue("args").jsonArray.firstOrNull() ?: JsonNull
  private fun text(e: JsonElement?): String? = (e as? JsonPrimitive)?.takeIf { it.isString }?.content
  private fun num(e: JsonElement?): Double? = (e as? JsonPrimitive)?.takeIf { !it.isString }?.doubleOrNull
  private fun flag(e: JsonElement?): Boolean? = (e as? JsonPrimitive)?.takeIf { !it.isString }?.booleanOrNull
  private fun lines(e: JsonElement) = (e as? JsonArray).orEmpty().map {
    PosHardwareOrderLine(text(it.jsonObject["name"]).orEmpty(), num(it.jsonObject["quantity"])?.toInt() ?: 0)
  }

  @Test
  fun moneyAndThePlanPromptAreTheConsoles() {
    for (case in cases("formatPosHardwareCents")) {
      assertEquals(text(case["result"]), formatPosHardwareCents(num(arg(case))!!.toLong()), "${case["args"]}")
    }
    val prompts = cases("posPlanPrompt")
    assertEquals(3, prompts.size)
    for (case in prompts) {
      val arrived = (arg(case).jsonObject["arrived"] as? JsonArray).orEmpty().mapNotNull { text(it) }
      assertEquals(text(case["result"]), posHardwarePlanPrompt(arrived))
    }
  }

  @Test
  fun aReturnIsOfferedWhereTheConsoleOffersOne() {
    val all = cases("posHardwareReturnOffered")
    assertTrue(all.size > 10)
    for (case in all) {
      val order = arg(case).jsonObject
      assertEquals(flag(case["result"]), posHardwareReturnOffered(text(order["status"]).orEmpty(), text(order["source"]), order["returnRequest"] != null), "$order")
    }
  }

  @Test
  fun arrivedOrdersItemsAndNotesAreTheConsoles() {
    for (case in cases("posHardwareArrivedNumbers")) {
      val orders = (arg(case) as JsonArray).map { Triple(text(it.jsonObject["number"]).orEmpty(), text(it.jsonObject["status"]).orEmpty(), text(it.jsonObject["source"])) }
      assertEquals(case.getValue("result").jsonArray.mapNotNull { text(it) }, posHardwareArrivedNumbers(orders))
    }
    for (case in cases("posHardwareOrderItems")) assertEquals(text(case["result"]), posHardwareOrderItems(lines(arg(case))))
    for (case in cases("posHardwareWaitingItems")) assertEquals(text(case["result"]), posHardwareWaitingItems(lines(arg(case))))
    for (case in cases("posHardwareWaitingNote")) {
      val input = arg(case).jsonObject
      assertEquals(
        text(case["result"]),
        posHardwareWaitingNote(text(input["storeName"]).orEmpty(), num(input["serialsTaken"])?.toInt() ?: 0, flag(input["hasLocation"]) == true),
      )
    }
    for (case in cases("posHardwareReturnTitle")) assertEquals(text(case["result"]), posHardwareReturnTitle(text(arg(case)).orEmpty()))
    for (case in cases("posHardwareReturnReasonReady")) assertEquals(flag(case["result"]), posHardwareReturnReasonReady(text(arg(case)).orEmpty()))
  }

  @Test
  fun theBasketAndCheckOutAreTheConsoles() {
    for (case in cases("posHardwareBasket")) {
      val input = arg(case).jsonObject
      val offers = input.getValue("offers").jsonArray.map { text(it.jsonObject["sku"]).orEmpty() to (num(it.jsonObject["unitCents"]) ?: 0.0).toLong() }
      val quantities = input.getValue("quantities").jsonObject.mapValues { (num(it.value) ?: 0.0).toInt() }
      val basket = posHardwareBasket(offers, quantities, num(input["shippingCents"])?.toLong(), flag(input["automaticTax"]) == true)
      val result = case.getValue("result").jsonObject
      assertEquals(
        result.getValue("lines").jsonArray.map { text(it.jsonObject["sku"]).orEmpty() to (num(it.jsonObject["quantity"]) ?: 0.0).toInt() },
        basket.lines,
      )
      assertEquals(num(result["itemsCents"])?.toLong(), basket.itemsCents)
      assertEquals(num(result["totalCents"])?.toLong(), basket.totalCents)
      assertEquals(text(result["totalLabel"]), basket.totalLabel)
    }
    val states = cases("posHardwareCheckoutState")
    assertEquals(32, states.size)
    for (case in states) {
      val i = arg(case).jsonObject
      val (reason, enabled) = posHardwareCheckoutState(
        flag(i["canBuy"]) == true, flag(i["termsAccepted"]) == true, flag(i["businessUse"]) == true, flag(i["hasLines"]) == true, flag(i["hasShipping"]) == true,
      )
      val result = case.getValue("result").jsonObject
      assertEquals(text(result["blockedReason"]), reason, "$i")
      assertEquals(flag(result["enabled"]), enabled, "$i")
    }
  }

  @Test
  fun theRouteAnswersAreRead() {
    val catalog = PosHardwareCatalog.from(
      Json.parseToJsonElement(
        """{"available":true,"offers":[{"sku":"stripe-reader-m2","name":"Pocket reader (M2)","use":"Pairs","unitCents":10010}],"shipping":[{"method":"standard","label":"Standard shipping","cents":1500}],"automaticTax":false}""",
      ),
    )
    assertTrue(catalog.available)
    assertEquals(10010L, catalog.offers.single().unitCents)
    assertEquals(PosHardwareCatalog.CLOSED, PosHardwareCatalog.from(Json.parseToJsonElement("""{"available":false}""")))
    val order = PosHardwareOrderRow.from(
      Json.parseToJsonElement(
        """{"id":"hw_1","number":"HW-1","status":"delivered","totalCents":11510,"lines":[{"name":"Pocket reader (M2)","quantity":1}],"returnRequest":{"state":"requested"},"tracking":{"number":"1Z","url":"https://example.test/t"}}""",
      ),
    )!!
    assertEquals("Delivered", order.statusLabel)
    assertEquals("Return requested", order.returnLabel)
    assertFalse(order.returnOffered)
    assertEquals("https://example.test/t", order.trackingUrl)
  }
}
