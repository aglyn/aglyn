package com.aglyn.contracts

import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.doubleOrNull
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue

/** Replays the seller panel's cases in function-cases.generated.json: the TypeScript's own answers. */
class SellerRulesCasesTest {
  private val functions = ContractJsonFormat.parseToJsonElement(ContractCaseJson.functionCases).jsonObject.getValue("functions").jsonObject

  private fun cases(name: String): List<Pair<JsonArray, JsonElement>> {
    val list = functions.getValue(name).jsonObject.getValue("cases").jsonArray
    assertTrue(list.isNotEmpty(), "no cases for $name")
    return list.map { it.jsonObject.getValue("args").jsonArray to it.jsonObject.getValue("result") }
  }

  @Test
  fun theLedgerAddsUpAsTheConsoleAddsItUp() {
    for ((args, result) in cases("summarizeSellerLedger")) {
      val sales = (args[0] as? JsonArray)?.map { plainOf(it) as Map<String, Any?> }
      val totals = summarizeSellerLedger(sales)
      val expected = result.jsonObject
      fun number(key: String) = (expected.getValue(key) as JsonPrimitive).doubleOrNull!!
      assertEquals(
        listOf(number("paidCount"), number("refundedCount"), number("sentToStripeCents"), number("buyersPaidCents"), number("salesTaxCents"), number("platformFeeCents"), number("returnedCents")),
        listOf(totals.paidCount.toDouble(), totals.refundedCount.toDouble(), totals.sentToStripeCents, totals.buyersPaidCents, totals.salesTaxCents, totals.platformFeeCents, totals.returnedCents),
        args.toString(),
      )
    }
  }

  @Test
  fun payoutsAreReadyBlockedUnverifiedOrUnknownAsTheConsoleSaysSo() {
    val all = cases("payoutReadiness")
    assertEquals(144, all.size)
    for ((args, result) in all) {
      val input = args[0].jsonObject
      fun value(key: String): Any? = input[key]?.let { if (it is JsonNull) null else plainOf(it) }
      val readiness = payoutReadiness(input.getValue("state").jsonPrimitive.content, value("chargesEnabled"), value("payoutsEnabled"), value("accountLivemode"))
      assertEquals(result.jsonPrimitive.content, readiness.wire, args.toString())
    }
  }

  @Test
  fun aHandleIsThreeToThirtyLowercaseLettersDigitsAndHyphens() {
    for (good in listOf("abc", "studio-9", "a".repeat(30), "9lives")) assertTrue(isPublisherHandle(good), good)
    for (bad in listOf("ab", "a".repeat(31), "-abc", "Studio", "has space", "under_score", "")) assertFalse(isPublisherHandle(bad), bad)
  }
}
