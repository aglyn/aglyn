package com.aglyn.screens

import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlin.test.Test
import kotlin.test.assertEquals

/** An order's tax service record (the console's OrderTaxRecord, in the order's orderDetail zone). */
class TaxRecordSpecsTest : SpecTestBase() {
  private fun record(tx: String) = screen(
    spec("tax-engines", "tax-engines.order"), mapOf("orderId" to "o1"),
    """{"order":{"currency":"usd"},"tx":{"transaction":$tx}}""",
  )

  private fun ScreenModel.facts(): List<String> =
    block("record").raw.jsonObject["rows"]!!.jsonArray.map { it.jsonObject }
      .filter { ScreenValues.condition((it["when"] as? JsonPrimitive)?.content, context) }
      .map { ScreenValues.render((it["value"] as JsonPrimitive).content, context) }

  @Test
  fun anOrderSaysHowItStandsWithTheTaxServiceAndCanBeRecordedAgain() {
    val committed = record("""{"providerLabel":"Avalara AvaTax","status":"committed","code":"o1","taxCents":825,"refundedCents":0,"refunds":0,"fallbackReason":null,"lastError":null}""")
    assertEquals(listOf("record"), committed.shown())
    assertEquals(listOf("Recorded", "$8.25 recorded under o1"), committed.facts())
    val refunded = record("""{"providerLabel":"TaxJar","status":"committed","code":"o1","taxCents":825,"refundedCents":300,"refunds":2,"fallbackReason":"timeout","lastError":null}""")
    assertEquals("$8.25 recorded under o1; 2 refunds of $3.00 reversed", refunded.facts()[1])
    assertEquals(listOf("record", "fallbackTimeout"), refunded.shown())
    val failed = record("""{"providerLabel":"TaxJar","status":"failed","code":"o1","taxCents":825,"refundedCents":0,"refunds":0,"fallbackReason":"error","lastError":"TaxJar refused the address."}""")
    assertEquals(listOf("record", "fallbackError", "errorFailed", "retry"), failed.shown())
    assertEquals(json("""{"hostId":"h1","orderId":"o1"}"""), failed.body(failed.action("retry", "recordAgain")))
    assertEquals("/api/tax-engines/order-transaction/retry", failed.action("retry", "recordAgain").url)
    assertEquals(listOf("none"), record("null").shown())
  }
}
