package com.aglyn.contracts

import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.doubleOrNull
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.longOrNull
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull
import kotlin.test.assertTrue

/**
 * Replays the order dialog's rules and words (tracking links, Fulfill items, disputes, refunds, tax, payment risk)
 * from function-cases.generated.json; the Apple kit's OrderDialogRulesTests replays the same cases.
 */
class OrderDialogRulesCasesTest {
  private val functions = ContractJsonFormat.parseToJsonElement(ContractCaseJson.functionCases).jsonObject.getValue("functions").jsonObject

  private fun cases(name: String): List<Pair<JsonArray, JsonElement>> =
    functions.getValue(name).jsonObject.getValue("cases").jsonArray.map {
      it.jsonObject.getValue("args").jsonArray to it.jsonObject.getValue("result")
    }.also { assertTrue(it.isNotEmpty(), name) }

  private fun order(json: JsonElement): HostOrder = ContractJsonFormat.decodeFromJsonElement(HostOrder.serializer(), json)
  private fun str(element: JsonElement?): String? = (element as? JsonPrimitive)?.takeIf { it !is JsonNull && it.isString }?.content
  private fun long(element: JsonElement?): Long? = (element as? JsonPrimitive)?.takeIf { it !is JsonNull }?.longOrNull
  private fun bool(element: JsonElement?): Boolean? = (element as? JsonPrimitive)?.takeIf { it !is JsonNull }?.booleanOrNull
  private fun double(element: JsonElement?): Double? = (element as? JsonPrimitive)?.takeIf { it !is JsonNull }?.doubleOrNull
  private fun lines(element: JsonElement): List<FulfillmentLine> =
    element.jsonArray.map { FulfillmentLine(long(it.jsonObject["lineItemId"])!!.toInt(), long(it.jsonObject["quantity"])!!) }

  @Test
  fun carriersAndTrackingLinks() {
    cases("carrierIdFor").forEach { (args, result) -> assertEquals(str(result), carrierIdFor(str(args[0])), "$args") }
    cases("carrierLabelFor").forEach { (args, result) -> assertEquals(str(result), carrierLabelFor(str(args[0])), "$args") }
    cases("trackingUrlFor").forEach { (args, result) -> assertEquals(str(result), trackingUrlFor(str(args[0]), str(args[1])), "$args") }
    cases("fulfillmentTrackingUrl").forEach { (args, result) ->
      val entry = args[0].jsonObject
      assertEquals(str(result), fulfillmentTrackingUrl(str(entry["carrier"]), str(entry["trackingNumber"]), str(entry["trackingUrl"])), "$args")
    }
    cases("fulfillmentCarrierChoice").forEach { (args, result) -> assertEquals(str(result), fulfillmentCarrierChoice(str(args[0])), "$args") }
    cases("trackingStatusLabel").forEach { (args, result) -> assertEquals(str(result), trackingStatusLabel(str(args[0])), "$args") }
  }

  @Test
  fun fulfillItems() {
    cases("describeFulfillmentLines").forEach { (args, result) -> assertEquals(str(result), describeFulfillmentLines(order(args[0]), lines(args[1]))) }
    cases("orderFulfillmentsEditable").forEach { (args, result) ->
      val status = OrderStatus.entries.firstOrNull { it.raw == str(args[0].jsonObject["status"]) }
      assertEquals(bool(result), orderFulfillmentsEditable(status), "$args")
    }
    cases("fulfillItemsStartQuantities").forEach { (args, result) ->
      assertEquals(result.jsonArray.map { long(it) }, fulfillItemsStartQuantities(order(args[0])))
    }
    cases("fulfillItemsSelection").forEach { (args, result) ->
      assertEquals(lines(result), fulfillItemsSelection(args[0].jsonArray.map { double(it)!! }), "$args")
    }
    cases("fulfillItemsIsEverything").forEach { (args, result) -> assertEquals(bool(result), fulfillItemsIsEverything(order(args[0]), lines(args[1]))) }
  }

  @Test
  fun shippingCost() {
    cases("currencyMinorDigits").forEach { (args, result) -> assertEquals(long(result)?.toInt(), currencyMinorDigits(str(args[0])), "$args") }
    cases("parseShippingCostInput").forEach { (args, result) ->
      val expected = result.jsonObject
      val parsed = parseShippingCostInput(str(args[0]).orEmpty(), str(args[1]))
      if (expected.containsKey("error")) assertEquals(ShippingCostInput.Error(str(expected["error"])!!), parsed, "$args")
      else assertEquals(ShippingCostInput.Cents(long(expected["cents"])), parsed, "$args")
    }
  }

  @Test
  fun disputes() {
    cases("describeOrderDispute").forEach { (args, result) ->
      val badge = describeOrderDispute(order(args[0]), double(args[1])!!)
      if (result is JsonNull) {
        assertNull(badge, "$args")
        return@forEach
      }
      val expected = result.jsonObject
      assertEquals(
        OrderDisputeBadge(str(expected["tone"])!!, str(expected["label"])!!, str(expected["detail"])!!, long(expected["evidenceDueByMs"]), long(expected["evidenceDaysLeft"])),
        badge,
      )
    }
    cases("orderHasOpenDispute").forEach { (args, result) -> assertEquals(bool(result), orderHasOpenDispute(order(args[0]))) }
    cases("splitOrderReversal").forEach { (args, result) ->
      val expected = result.jsonObject
      assertEquals(OrderReversalSplit(long(expected["refundedCents"])!!, long(expected["chargedBackCents"])!!), splitOrderReversal(order(args[0])))
    }
    cases("summariseOpenDisputes").forEach { (args, result) ->
      val expected = result.jsonObject
      assertEquals(
        OpenDisputeSummary(long(expected["count"])!!.toInt(), long(expected["soonestDueByMs"]), long(expected["soonestDaysLeft"]), bool(expected["overdue"])!!),
        summariseOpenDisputes(args[0].jsonArray.map(::order), double(args[1])!!),
      )
    }
  }

  @Test
  fun refunds() {
    cases("orderLineRefundCents").forEach { (args, result) ->
      assertEquals(long(result), orderLineRefundCents(order(args[0]), args[1].jsonArray.map { long(it)!!.toInt() }), "$args")
    }
    cases("orderLineRefunded").forEach { (args, result) -> assertEquals(bool(result), orderLineRefunded(order(args[0]), long(args[1])!!.toInt())) }
    cases("orderRefundPrompt").forEach { (args, result) ->
      val expected = result.jsonObject
      val ids = args.getOrNull(1)?.jsonArray?.map { long(it)!!.toInt() } ?: emptyList()
      assertEquals(RefundPrompt(str(expected["title"])!!, str(expected["text"])!!), orderRefundPrompt(order(args[0]), ids))
    }
  }

  @Test
  fun taxAndPaymentRisk() {
    cases("describeOrderTaxMode").forEach { (args, result) -> assertEquals(str(result), describeOrderTaxMode(str(args[0]))) }
    cases("describePaymentRisk").forEach { (args, result) ->
      val risk = (args[0] as? JsonObject)?.let { raw ->
        val signals = raw.getValue("signals").jsonArray.map {
          val o = it.jsonObject
          PaymentRiskSignal(
            atMs = double(o["atMs"]) ?: 0.0,
            detail = str(o["detail"]),
            kind = PaymentRiskSignalKind.entries.firstOrNull { kind -> kind.raw == str(o["kind"]) } ?: PaymentRiskSignalKind.UNKNOWN,
            outcome = str(o["outcome"]),
            stripeObjectId = str(o["stripeObjectId"]).orEmpty(),
          )
        }
        PaymentRisk(0.0, signals.lastOrNull()?.kind ?: PaymentRiskSignalKind.UNKNOWN, signals)
      }
      val expected = result as? JsonObject
      assertEquals(expected?.let { PaymentRiskChip(str(it["label"])!!, str(it["detail"])!!) }, describePaymentRisk(risk))
    }
  }
}
